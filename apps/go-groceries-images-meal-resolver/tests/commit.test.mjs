import { expect, test, vi } from 'vitest';
import { SNAPSHOT_TABLES } from '@go-groceries/frontend/snapshot';
import { createStorage } from '../../../test/memory-storage.mjs';
import { createApp } from '../src/index.ts';

const collectionId = '11111111-1111-4111-8111-111111111111';
const snapshotId = '22222222-2222-4222-8222-222222222222';
const prefix = `collections/${collectionId}/images/sha256/`;
const snapshotKey = `collections/${collectionId}/snapshots/${snapshotId}.json`;
const include = ['httpMetadata', 'customMetadata'];

function assetAt(index) {
  const sha256 = index.toString(16).padStart(64, '0');
  return {
    assetId: sha256, sha256, mimeType: 'image/png', byteLength: 1,
    location: { provider: 'r2', key: prefix + sha256 },
  };
}

function fixture() {
  const { env, objects, client, sign } = createStorage();
  // Model the Workers Free budget at the SDK boundary. The harness blocks real network I/O.
  const send = vi.fn(async command => {
    if (send.mock.calls.length > 50) throw new Error('External subrequest budget exhausted');
    return client.send(command);
  });
  const app = createApp({ client: () => ({ send }), sign, now: Date.now });
  const list = vi.fn(env.IMAGES_BUCKET.list);

  function seed(index, overrides) {
    const asset = assetAt(index);
    objects.set(asset.location.key, {
      bytes: Uint8Array.of(1), type: asset.mimeType, metadata: { 'verified-sha256': asset.sha256 }, ...overrides,
    });
    return asset;
  }

  async function commit(assets) {
    const tables = Object.fromEntries(SNAPSHOT_TABLES.map(table => [table, []]));
    tables.recipes = assets.map((asset, index) => ({
      id: index + 1, mealId: index + 1,
      images: [{ kind: 'asset', assetId: asset.assetId }], url: '', notes: '',
    }));
    const snapshot = {
      format: 'go-groceries-snapshot', version: 2, collectionId, snapshotId, assets,
      data: { schemaVersion: 16, adapterVersion: 2, tables },
    };
    return app.fetch(new Request('https://worker.example/v2/snapshots/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pass: env.PASS, snapshot }),
    }), { ...env, IMAGES_BUCKET: { list } });
  }

  return { commit, seed, list, send, objects };
}

test('commits 60 assets within the Workers Free external subrequest budget', async () => {
  const { commit, seed, list, send, objects } = fixture();
  const assets = Array.from({ length: 60 }, (_, index) => seed(index));
  const response = await commit(assets);

  expect({ status: response.status, externalCalls: send.mock.calls.length }).toEqual({ status: 200, externalCalls: 1 });
  expect(await response.json()).toEqual({ collectionId, snapshotId, key: snapshotKey });
  expect(list.mock.calls).toEqual([[{ prefix, cursor: undefined, include }]]);
  expect(objects.has(snapshotKey)).toBe(true);
});

test('paginates a collection with more than 1,000 photos and reuses earlier results', async () => {
  const { commit, seed, list, send } = fixture();
  for (let index = 0; index <= 1000; index++) seed(index);
  const response = await commit([assetAt(1000), assetAt(0)]);

  expect(response.status).toBe(200);
  expect(list.mock.calls).toEqual([
    [{ prefix, cursor: undefined, include }],
    [{ prefix, cursor: '1000', include }],
  ]);
  expect(send).toHaveBeenCalledTimes(1);
});

test('rejects an asset missing at its exact key', async () => {
  const { commit, seed, objects } = fixture();
  const asset = seed(0);
  objects.set(asset.location.key + '/other', objects.get(asset.location.key));
  objects.delete(asset.location.key);

  const response = await commit([asset]);
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'Object not found' });
  expect(objects.has(snapshotKey)).toBe(false);
});

test.each([
  ['verification hash', { metadata: { 'verified-sha256': 'f'.repeat(64) } }],
  ['size', { bytes: Uint8Array.of(1, 2) }],
  ['content type', { type: 'image/jpeg' }],
])('rejects a mismatch in %s', async (_field, overrides) => {
  const { commit, seed, objects } = fixture();
  const response = await commit([seed(0, overrides)]);

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'Asset descriptor conflicts with stored object' });
  expect(objects.has(snapshotKey)).toBe(false);
});

test('reports descriptor errors in manifest order even when keys sort differently', async () => {
  const { commit, seed } = fixture();
  const response = await commit([seed(1, { type: 'image/jpeg' }), assetAt(0)]);

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'Asset descriptor conflicts with stored object' });
});

test.each([
  [0, 404, 'Object not found'],
  [1, 409, 'Asset descriptor conflicts with stored object'],
])('stops at the first invalid asset (%i) before fetching a later page', async (index, status, error) => {
  const { commit, seed, list, objects } = fixture();
  seed(1, { type: 'image/jpeg' });
  const later = seed(2);
  const originalList = list.getMockImplementation();
  list.mockImplementationOnce(options => originalList({ ...options, limit: 1 }))
    .mockRejectedValue(new Error('Unexpected second listing page'));

  const response = await commit([assetAt(index), later]);
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error });
  expect(list).toHaveBeenCalledTimes(1);
  expect(objects.has(snapshotKey)).toBe(false);
});

test('a listing failure returns a generic storage error without writing the snapshot', async () => {
  const { commit, seed, list, objects } = fixture();
  list.mockRejectedValue(new Error('Private storage details'));
  const response = await commit([seed(0)]);

  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: 'Storage operation failed' });
  expect(objects.has(snapshotKey)).toBe(false);
});

test('an empty snapshot skips the R2 listing', async () => {
  const { commit, list, send } = fixture();
  const response = await commit([]);

  expect(response.status).toBe(200);
  expect(list).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledTimes(1);
});
