import { beforeEach, expect, test, vi } from 'vitest';
import { db } from '../src/db/db.ts';
import { cacheImage, hashBlob } from '../src/db/image-cache.ts';
import { getExportBlob } from '../src/util/db/export.ts';
import { syncTo } from '../src/util/sync.ts';
import { checkAndTriggerAutoSyncTo } from '../src/util/sync-to.ts';
import { photoRejectionKey } from '../src/util/sync/image-preflight.ts';
import { syncFromDb, saveSyncFromLocation, importSyncFile, checkAndTriggerAutoSync } from '../src/util/sync-from.ts';
import { hydrateSnapshot } from '../src/util/sync/hydrate.ts';
import { freezeSnapshot, localMetadataDigest } from '../src/util/sync/snapshot-adapter.ts';
import { parseLocation, readPermission, consumeIncomingLocation } from '../src/util/sync/location.ts';
import { boundedJson, v2Post } from '../src/util/sync/api.ts';
import { createShareLink } from '../src/util/sync/share.ts';
import { createApp } from '../../go-groceries-images-meal-resolver/src/index.ts';
import { createStorage } from '../../../test/memory-storage.mjs';
import { cleanDatabase, meal, image, png } from './helpers.mjs';
cleanDatabase();
let storage, fetchMock, rejectContainer;
beforeEach(async () => {
  rejectContainer = false;
  storage = createStorage(); const app = createApp({client:()=>storage.client,sign:storage.sign,now:Date.now});
  fetchMock = vi.fn(async (input,options = {}) => {
    const url = new URL(String(input));
    if (url.origin !== 'http://127.0.0.1:18927') throw new Error('Unexpected test URL');
    if (url.pathname.startsWith('/objects/')) return storage.objectFetch(url,options);
    storage.events.push({action:'API',key:url.pathname});
    if (url.pathname === '/v2/snapshots/publish' && storage.controls.failPublish > 0) {storage.controls.failPublish--;return new Response('',{status:400});}
    if (url.pathname === '/v2/images/complete' && rejectContainer) {
      rejectContainer = false;
      return Response.json({ error: 'Invalid image container or dimensions' }, { status: 400 });
    }
    return app.fetch(new Request(url,options),storage.env);
  });
  vi.stubGlobal('fetch',fetchMock);
  await db.settings.put({id:'youtubeApiPass',value:storage.env.PASS});
});
async function seed() {
  const ref = await cacheImage(image());
  await db.meals.put({...meal(),images:[{...ref,type:'asset',isThumbnail:true}]});
  await db.recipes.put({id:20,mealId:1,images:[ref,ref],url:'',notes:'Recipe'});
  return ref;
}
const published = () => [...storage.objects.entries()].filter(([key]) => key.includes('/snapshots/')).map(([,object]) => JSON.parse(new TextDecoder().decode(object.bytes))).at(-1);
test('v2 publishes verified unique images before metadata and latest, then deduplicates repeat sync', async () => {
  await seed(); await syncTo({automatic:false});
  const actions = storage.events.filter(e => e.action === 'API' || e.action === 'SIGNED_PUT').map(e => e.key);
  expect(actions[0]).toBe('/v2/images/prepare');
  expect(actions.indexOf('/v2/images/complete')).toBeLessThan(actions.indexOf('/v2/snapshots/commit'));
  expect(actions.indexOf('/v2/snapshots/commit')).toBeLessThan(actions.indexOf('/v2/snapshots/publish'));
  expect(storage.events.filter(e => e.action === 'SIGNED_PUT')).toHaveLength(1);
  const snapshot = published(); expect(snapshot.assets).toHaveLength(1); expect(JSON.stringify(snapshot)).not.toContain('test-writer-pass');
  expect(JSON.stringify(snapshot)).not.toContain('ticket=');
  await syncTo({automatic:false}); expect(storage.events.filter(e => e.action === 'SIGNED_PUT')).toHaveLength(1);
  expect((await db.syncs.where('type').equals('to').first()).pendingPublication).toBeUndefined();
});
test('failure before latest preserves pending snapshot for recovery and does not publish an incomplete head', async () => {
  await seed(); storage.controls.failPublish = 1;
  await expect(syncTo({automatic:false})).rejects.toThrow('400');
  const pending = (await db.syncs.where('type').equals('to').first()).pendingPublication;
  expect(pending).toBeDefined(); expect([...storage.objects.keys()].some(k => k.endsWith('/latest.json'))).toBe(false);
  await db.meals.update(1,{name:'Later edit'}); await syncTo({automatic:false});
  expect(published().data.tables.meals[0].name).toBe('Later edit');
  expect(storage.events.filter(e => e.action === 'SIGNED_PUT')).toHaveLength(1);
});
test('writer sync down stages diffs, atomically replaces metadata and hydrates bytes', async () => {
  const ref = await seed(); const url = await syncTo({automatic:false});
  await db.meals.clear(); await db.recipes.clear(); await db.imageAssets.clear();
  await saveSyncFromLocation(url); const incoming = await syncFromDb();
  expect(incoming.diffsResult.mealDiffs.toAdd.map(m => m.name)).toEqual(['Soup']);
  expect(await db.meals.count()).toBe(0);
  expect(await importSyncFile(incoming.blob)).toContain('1/1');
  expect((await db.meals.get(1)).name).toBe('Soup'); expect(await db.imageAssets.get(ref.assetId)).toBeDefined();
});
test('hydration renews expired GET links and then serves cached bytes without network', async () => {
  const ref = await seed(); await syncTo({automatic:false}); const snapshot = published();
  await db.imageAssets.clear(); storage.controls.expireGet = 1;
  expect(await hydrateSnapshot(snapshot,{pass:storage.env.PASS})).toEqual({cached:1,total:1,failures:[]});
  expect(storage.events.filter(e => e.action === 'API' && e.key === '/v2/images/download')).toHaveLength(2);
  expect(await db.imageAssets.get(ref.assetId)).toBeDefined();
  fetchMock.mockClear(); expect((await hydrateSnapshot(snapshot,{pass:storage.env.PASS})).cached).toBe(1); expect(fetchMock).not.toHaveBeenCalled();
});
test('corrupt hydration is rejected, retains metadata, and can be retried', async () => {
  const ref = await seed(); await syncTo({automatic:false}); const snapshot = published(); await db.imageAssets.clear();
  storage.controls.corruptGet = 1;
  const failed = await hydrateSnapshot(snapshot,{pass:storage.env.PASS});
  expect(failed.cached).toBe(0); expect(failed.failures[0]).toContain('SHA-256'); expect(await db.imageAssets.get(ref.assetId)).toBeUndefined();
  expect((await db.meals.get(1)).name).toBe('Soup');
  expect((await hydrateSnapshot(snapshot,{pass:storage.env.PASS})).cached).toBe(1);
});
test('read-only share imports without pass, does not query latest, and stores no bearer token', async () => {
  await seed(); await syncTo({automatic:false}); const writer = await db.syncs.where('type').equals('to').first();
  const url = await createShareLink(writer);
  await db.settings.clear(); await db.meals.clear(); await db.recipes.clear(); await db.imageAssets.clear();
  await saveSyncFromLocation(url); const sync = await db.syncs.where('type').equals('from').first();
  expect(sync.url).not.toContain('share='); expect(await readPermission(sync)).toHaveProperty('shareToken');
  storage.events.length = 0;
  const incoming = await syncFromDb(); expect(await importSyncFile(incoming.blob)).toContain('1/1');
  expect(storage.events.some(e => e.key === '/v2/snapshots/latest')).toBe(false);
  for (const [,options] of fetchMock.mock.calls.slice(-2)) if (options.method === 'POST') expect(options.body).not.toContain('pass');
  await expect(syncTo({automatic:false})).rejects.toThrow('writer pass');
});
test('share expiry shows authorization error and preserves local data', async () => {
  await seed(); await syncTo({automatic:false}); const writer = await db.syncs.where('type').equals('to').first();
  await saveSyncFromLocation(await createShareLink(writer)); storage.env.PASS = 'rotated-pass';
  await expect(syncFromDb()).rejects.toThrow('authorization expired'); expect((await db.meals.get(1)).name).toBe('Soup');
});
test('changed sync source refuses stale staged metadata', async () => {
  await seed(); const url = await syncTo({automatic:false}); await saveSyncFromLocation(url);
  const incoming = await syncFromDb(); const source = await db.syncs.where('type').equals('from').first();
  await db.syncs.update(source.id,{importGeneration:crypto.randomUUID()}); await db.meals.update(1,{name:'Retained local'});
  await expect(importSyncFile(incoming.blob)).rejects.toThrow('changed'); expect((await db.meals.get(1)).name).toBe('Retained local');
});
test.each([[400,'Invalid legacy sync filename'],[403,'Legacy retrieval pass rejected'],[404,'not found in storage'],[502,'storage lookup failed']])('legacy retrieval %s has actionable errors without changing data', async (status,message) => {
  await seed(); await saveSyncFromLocation('http://127.0.0.1:18927/legacy-'+status+'.json?X-Amz-Date=20200101T000000Z&X-Amz-Expires=300&X-Amz-Signature=synthetic');
  vi.stubGlobal('fetch',vi.fn(async () => new Response('',{status})));
  await expect(syncFromDb()).rejects.toThrow(message); expect((await db.meals.get(1)).name).toBe('Soup');
});
test('missing location, unavailable share session and malformed locations explain recovery', async () => {
  await expect(syncFromDb()).rejects.toThrow('No sync from location');
  const collectionId = crypto.randomUUID(), snapshotId = crypto.randomUUID();
  await expect(readPermission({access:'share',collectionId,snapshotId})).rejects.toThrow('Reopen the original shared link');
  for (const url of ['javascript:alert(1)','https://user:pass@localhost/old.json','https://localhost/%2fprivate','http://localhost/#collection=bad']) expect(() => parseLocation(url)).toThrow();
});
test('incoming share fragment is removed from DOM history and retained only in memory', () => {
  const collectionId = crypto.randomUUID(),snapshotId = crypto.randomUUID();
  window.history.replaceState(null,'','/settings#collection='+collectionId+'&snapshot='+snapshotId+'&share=synthetic-token');
  expect(consumeIncomingLocation()).toContain('share=synthetic-token'); expect(window.location.hash).toBe('');
});
test('bounded JSON rejects excessive bytes and malformed UTF-8/JSON', async () => {
  await expect(boundedJson(new Response('12345'),4)).rejects.toThrow('size limit');
  await expect(boundedJson(new Response('{'))).rejects.toThrow('Invalid sync JSON');
  await expect(boundedJson(new Response(Uint8Array.from([255])))).rejects.toThrow('Invalid sync JSON');
});
test('cloud conflict is not retried and temporary server errors are retried', async () => {
  const conflict = vi.fn(async () => new Response('',{status:409})); vi.stubGlobal('fetch',conflict);
  await expect(v2Post('snapshots/latest',{}, {pass:'fake'})).rejects.toThrow('Cloud sync conflict'); expect(conflict).toHaveBeenCalledTimes(1);
  const transient = vi.fn().mockResolvedValueOnce(new Response('',{status:503})).mockResolvedValueOnce(new Response('{}'));
  vi.stubGlobal('fetch',transient); expect(await v2Post('snapshots/latest',{}, {pass:'fake'})).toEqual({}); expect(transient).toHaveBeenCalledTimes(2);
});
test('unsupported local images are skipped, name the affected meal, and retain originals', async () => {
  const ref = await cacheImage(new Blob(['GIF89a'],{type:'image/gif'})); await db.meals.put(meal());
  await db.recipes.put({id:1,mealId:1,images:[ref],url:'',notes:''});
  const frozen = await freezeSnapshot(crypto.randomUUID(),crypto.randomUUID());
  expect(frozen.snapshot.assets).toEqual([]);
  expect(frozen.warnings).toEqual(['Photo skipped for recipe “Soup”. Only JPEG, PNG and WebP photos can sync.']);
  expect(await db.imageAssets.get(ref.assetId)).toBeDefined(); expect(fetchMock).not.toHaveBeenCalled();
});

test('a new Worker container rejection names the photo and stays omitted across a failed repair attempt', async () => {
  const ref = await seed();
  rejectContainer = true;
  await expect(syncTo({ automatic: false })).rejects.toThrow('container or dimensions of a photo for meal “Soup”');
  const before = (await db.syncs.where('type').equals('to').first()).pendingPublication;
  storage.controls.failPublish = 1;
  await expect(syncTo({ automatic: false })).rejects.toThrow('400');
  const repaired = (await db.syncs.where('type').equals('to').first()).pendingPublication;
  expect(repaired.snapshot.snapshotId).not.toBe(before.snapshot.snapshotId);
  expect(repaired.expectedRevision).toBe(before.expectedRevision);
  const onWarning = vi.fn();
  await syncTo({ automatic: false, onWarning });
  expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('Cloud storage rejected its container or dimensions.'));
  expect(published().assets).toEqual([]);
  expect((await db.meals.get(1)).images[0].assetId).toBe(ref.assetId);
  await syncTo({ automatic: false });
  expect(published().assets).toEqual([]);
  expect(storage.events.filter(e => e.action === 'SIGNED_PUT')).toHaveLength(1);
});

test('scheduled sync logs known Worker rejections and never decodes or uploads the rejected photo again', async () => {
  const ref = await seed();
  const onWarning = vi.fn();
  rejectContainer = true;
  await expect(syncTo({ automatic: true, trigger: 'debounced', onWarning })).rejects.toThrow('container or dimensions');
  const decode = vi.spyOn(globalThis, 'createImageBitmap');
  try {
    await expect(checkAndTriggerAutoSyncTo(onWarning)).resolves.toEqual({ type: 'SUCCESS' });
    await db.syncs.where('type').equals('to').modify({ lastSyncedAt: new Date(0) });
    await expect(checkAndTriggerAutoSyncTo(onWarning)).resolves.toEqual({ type: 'SUCCESS' });
    expect(onWarning).not.toHaveBeenCalled();
    expect(decode).not.toHaveBeenCalled();
    expect(storage.events.filter(event => event.action === 'SIGNED_PUT')).toHaveLength(1);
    expect(published().assets).toEqual([]);
    expect(await db.imageAssets.get(ref.assetId)).toBeDefined();
  } finally { decode.mockRestore(); }
});

test('same-size bytes repaired under the original asset ID are retried after an integrity skip', async () => {
  const ref = await seed();
  const original = await db.imageAssets.get(ref.assetId);
  const invalid = new Blob([new Uint8Array(original.byteLength)], { type: original.mimeType });
  await db.imageAssets.update(ref.assetId, { blob: invalid });
  const onWarning = vi.fn();
  const options = { automatic: true, trigger: 'debounced', onWarning };
  await syncTo(options);
  expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('failed its integrity check'));
  await syncTo(options);
  expect(onWarning).toHaveBeenCalledTimes(1);
  expect(published().assets).toEqual([]);

  await db.imageAssets.put(original);
  await syncTo(options);
  expect(published().assets.map(asset => asset.assetId)).toEqual([ref.assetId]);
  expect(await db.settings.filter(setting => setting.id.startsWith('sync-image-problem-')).count()).toBe(0);
});

test('a prepared warning is still new after a failed freeze write and a run without a notification callback', async () => {
  const ref = await cacheImage(new Blob(['wrong format'], { type: 'image/png' }));
  await db.meals.put({ ...meal(), images: [{ ...ref, type: 'asset' }] });
  const onWarning = vi.fn();
  const update = vi.spyOn(db.syncs, 'update').mockRejectedValueOnce(new Error('Test writer write failure'));
  try {
    await expect(syncTo({ automatic: true, trigger: 'debounced', onWarning })).rejects.toThrow('Test writer write failure');
    expect(onWarning).not.toHaveBeenCalled();
  } finally { update.mockRestore(); }

  await syncTo({ automatic: true, trigger: 'debounced' });
  await db.syncs.where('type').equals('to').modify({ lastSyncedAt: new Date(0) });
  await expect(checkAndTriggerAutoSyncTo(onWarning)).resolves.toEqual({ type: 'SUCCESS_WITH_WARNING' });
  expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('Only JPEG, PNG and WebP photos can sync.'));
  await db.syncs.where('type').equals('to').modify({ lastSyncedAt: new Date(0) });
  await expect(checkAndTriggerAutoSyncTo(onWarning)).resolves.toEqual({ type: 'SUCCESS' });
  expect(onWarning).toHaveBeenCalledTimes(1);
  const onProgress = vi.fn();
  await syncTo({ automatic: true, trigger: 'manual', onProgress });
  expect(onProgress.mock.lastCall[0]).toContain('Only JPEG, PNG and WebP photos can sync.');
});

test('an ambiguous browser decode failure warns once, then sync retries the original bytes', async () => {
  const ref = await seed();
  const error = new DOMException('Test could not read decoded image', 'InvalidStateError');
  const decode = vi.spyOn(globalThis, 'createImageBitmap').mockRejectedValueOnce(error).mockRejectedValueOnce(error);
  try {
    const onWarning = vi.fn();
    const options = { automatic: true, trigger: 'debounced', onWarning };
    await syncTo(options);
    await syncTo(options);
    expect(decode).toHaveBeenCalledTimes(2);
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(published().assets).toEqual([]);
    await syncTo(options);
    expect(decode).toHaveBeenCalledTimes(3);
    expect(published().assets.map(asset => asset.assetId)).toEqual([ref.assetId]);
    decode.mockRejectedValueOnce(error);
    await syncTo(options);
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(published().assets).toEqual([]);
  } finally { decode.mockRestore(); }
});

test('a corrupt derived copy stays omitted until that cached row is repaired', async () => {
  const bytes = Uint8Array.from(png);
  new DataView(bytes.buffer).setUint32(16, 9000);
  const source = await cacheImage(new Blob([bytes], { type: 'image/png' }));
  await db.meals.put({ ...meal(), images: [{ ...source, type: 'asset' }] });
  const blob = image();
  const assetId = await hashBlob(blob);
  const now = new Date().toISOString();
  const valid = { assetId, sha256: assetId, mimeType: blob.type, byteLength: blob.size, blob,
    cachedAt: now, verifiedAt: now };
  await db.imageAssets.add({ ...valid, blob: new Blob([new Uint8Array(blob.size)], { type: blob.type }) });
  const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() });
  const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(blob));
  try {
    const onWarning = vi.fn();
    const options = { automatic: true, trigger: 'debounced', onWarning };
    await syncTo(options);
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('cached cloud copy failed its integrity check'));
    await syncTo(options);
    expect(encode).toHaveBeenCalledTimes(1);
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(published().assets).toEqual([]);

    await db.imageAssets.put(valid);
    await syncTo(options);
    expect(published().assets.map(asset => asset.assetId)).toEqual([assetId]);
    expect((await db.meals.get(1)).images[0].assetId).toBe(source.assetId);
    expect(await db.imageAssets.get(source.assetId)).toBeDefined();
  } finally { context.mockRestore(); encode.mockRestore(); }
});

test.each([false, true])('an original sharing a rejected cloud copy warns once (legacy marker: %s)', async legacy => {
  const photos = [];
  for (const width of [9000, 9001]) {
    const bytes = Uint8Array.from(png);
    new DataView(bytes.buffer).setUint32(16, width);
    photos.push(await cacheImage(new Blob([bytes], { type: 'image/png' })));
  }
  await db.meals.put({ ...meal(), images: [{ ...photos[0], type: 'asset' }] });
  const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() });
  const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(image()));
  try {
    const onWarning = vi.fn();
    const options = { automatic: true, trigger: 'debounced', onWarning };
    rejectContainer = true;
    await expect(syncTo(options)).rejects.toThrow('container or dimensions of a photo for meal “Soup”');
    if (legacy) {
      const { collectionId } = await db.syncs.where('type').equals('to').first();
      await db.settings.put({ id: photoRejectionKey(collectionId, await hashBlob(image())), value: 'true' });
    } else {
      await syncTo(options);
      expect(onWarning).not.toHaveBeenCalled();
    }
    await db.meals.update(1, { name: 'New soup', images: [{ ...photos[1], type: 'asset' }] });
    await syncTo(options);
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('Photo skipped for meal “New soup”.'));
    await syncTo(options);
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(encode).toHaveBeenCalledTimes(2);
    expect(storage.events.filter(event => event.action === 'SIGNED_PUT')).toHaveLength(1);
    expect(published().assets).toEqual([]);
  } finally { context.mockRestore(); encode.mockRestore(); }
});

test.each(['network', 'timeout', 429, 503])('a transient photo completion failure (%s) can retry without quarantine', async failure => {
  const ref = await seed();
  const transport = fetchMock.getMockImplementation();
  const isComplete = input => new URL(String(input)).pathname.endsWith('/images/complete');
  fetchMock.mockImplementation(async (input, options) => {
    if (!isComplete(input)) return transport(input, options);
    if (failure === 'network') throw new TypeError('Test network interruption');
    if (failure === 'timeout') throw new DOMException('Test timeout', 'TimeoutError');
    return Response.json({ error: 'Invalid image container or dimensions' }, { status: failure });
  });
  const onWarning = vi.fn();
  const options = { automatic: true, trigger: 'debounced', onWarning };
  await expect(syncTo(options)).rejects.toThrow('Cloud sync');
  expect(fetchMock.mock.calls.filter(([input]) => isComplete(input))).toHaveLength(3);
  expect(await db.settings.filter(setting => setting.id.startsWith('sync-image-')).count()).toBe(0);

  fetchMock.mockImplementation(transport);
  await syncTo(options);
  expect(published().assets.map(asset => asset.assetId)).toEqual([ref.assetId]);
  expect(onWarning).not.toHaveBeenCalled();
});

test('a photo rejected by the previous format check can sync in its existing collection', async () => {
  await syncTo({ automatic: false });
  const { collectionId } = await db.syncs.where('type').equals('to').first();
  const ref = await seed();
  await db.settings.put({ id: `sync-image-rejection-v1:${collectionId}:${ref.assetId}`, value: 'true' });

  await syncTo({ automatic: false });

  expect(published().collectionId).toBe(collectionId);
  expect(published().assets.map(asset => asset.assetId)).toEqual([ref.assetId]);
});

test('a missing frozen photo can recover once the live meal removes its reference', async () => {
  const ref = await seed();
  fetchMock.mockImplementationOnce(async () => new Response(null, { status: 400 }));
  await expect(syncTo({ automatic: false })).rejects.toThrow('400');
  const stale = (await db.syncs.where('type').equals('to').first()).pendingPublication;
  await db.meals.update(1, { images: [], name: 'Updated soup' });
  await db.recipes.update(20, { images: [] });
  await db.imageAssets.delete(ref.assetId);
  await expect(syncTo({ automatic: false })).rejects.toThrow(/A photo for meal “Soup”.*is missing/);
  await syncTo({ automatic: false });
  expect(published().snapshotId).not.toBe(stale.snapshot.snapshotId);
  expect(published().data.tables.meals[0].name).toBe('Updated soup');
});

test('automatic import of the writer collection protects original photo references and warning labels are redacted', async () => {
  const ref = await cacheImage(new Blob(['GIF89a'], { type: 'image/gif' }));
  await db.meals.put({ ...meal(1, 'Garden soup //private.example/path token=short /settings?shareToken=mini-secret mailto:private@localhost 123456'), images: [{ ...ref, type: 'asset' }] });
  const onWarning = vi.fn();
  const url = await syncTo({ automatic: false, onWarning });
  expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('for meal “Garden soup”'));
  expect(onWarning.mock.lastCall[0]).not.toMatch(/private\.example|short|settings|mini-secret|mailto|123456/);
  await saveSyncFromLocation(url);
  const source = await db.syncs.where('type').equals('from').first();
  await db.syncs.update(source.id, { automatic: true, lastMetadataDigest: await localMetadataDigest() });
  const result = await checkAndTriggerAutoSync();
  expect(result).toMatchObject({ outcome: 'SUCCESS', needsConfirmation: true });
  await expect(importSyncFile(result.blob, { automatic: true })).rejects.toThrow('Local changes need confirmation');
  expect((await db.meals.get(1)).images[0].assetId).toBe(ref.assetId);
});

test('v1 sync import uses the portable importer and retains embedded bytes', async () => {
  const ref = await seed(); const backup = await getExportBlob();await db.meals.clear();await db.recipes.clear();await db.imageAssets.clear();
  expect(await importSyncFile(backup)).toContain('Legacy sync imported');
  expect((await db.meals.get(1)).name).toBe('Soup');expect(await db.imageAssets.get(ref.assetId)).toBeDefined();
});

test('schema15 pending first publication upgrades to16 without a head or lost local bytes', async()=>{
 await seed();const collectionId=crypto.randomUUID();const frozen=await freezeSnapshot(collectionId,crypto.randomUUID());const old=structuredClone(frozen.snapshot);old.data={schemaVersion:15,adapterVersion:1,tables:Object.fromEntries(Object.entries(old.data.tables).filter(([name])=>!['restaurants','restaurantTags','restaurantItems','people','restaurantItemRatings'].includes(name)))};
 await db.syncs.add({type:'to',format:'v2',collectionId,filename:collectionId,uploadType:'manual',createdAt:new Date(),automatic:false,pendingPublication:{snapshot:old,expectedRevision:null}});
 const before=await db.meals.toArray();await syncTo({automatic:false});expect(published().data.schemaVersion).toBe(16);expect(await db.meals.toArray()).toEqual(before);expect(await db.imageAssets.count()).toBe(1);await syncTo({automatic:false});expect(published().data.schemaVersion).toBe(16);
});
test('full snapshot share disclosure can cancel before capability creation', async()=>{
 const time='2020-01-01T00:00:00.000Z';await db.restaurants.add({name:'Private notebook',tags:[],notes:'<img src=x onerror=alert(1)>',isPinned:false,countryKey:'',regionKey:'',cityKey:'',createdAt:time,updatedAt:time});await syncTo({automatic:false});const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
 try{const writer=await db.syncs.where('type').equals('to').first();await expect(createShareLink(writer)).rejects.toThrow('cancelled');expect(confirm.mock.calls[0][0]).toContain('hidden advanced values');expect(storage.events.filter(e=>e.key==='/v2/snapshots/share')).toHaveLength(0);}finally{confirm.mockRestore();}
});

test('automatic schema16 removal requires confirmation and preserves live metadata',async()=>{
 const time='2020-01-01T00:00:00.000Z';await db.restaurants.add({name:'Keep local notebook',tags:[],notes:'',isPinned:false,countryKey:'',regionKey:'',cityKey:'',createdAt:time,updatedAt:time});const {snapshot}=await freezeSnapshot(crypto.randomUUID(),crypto.randomUUID());snapshot.data.tables.restaurants=[];const blob=new Blob([JSON.stringify(snapshot)]);await expect(importSyncFile(blob,{automatic:true})).rejects.toThrow('remove restaurant');expect(await db.restaurants.count()).toBe(1);
});


test.each([false, true])('coordinate-bearing schema16 pending publication refreshes without changing revision condition (head %s)', async (hasHead) => {
  await seed();
  const time = '2020-01-01T00:00:00.000Z';
  const rid = await db.restaurants.add({ name: 'Pending kitchen', tags: [], notes: '', isPinned: false,
    countryKey: '', regionKey: '', cityKey: '', googleMapsUrl: 'https://maps.google.com/?q=London', createdAt: time, updatedAt: time });
  if (hasHead) await syncTo({ automatic: false });
  let writer = await db.syncs.where('type').equals('to').first();
  const collectionId = writer?.collectionId ?? crypto.randomUUID();
  const { snapshot } = await freezeSnapshot(collectionId, crypto.randomUUID());
  Object.assign(snapshot.data.tables.restaurants[0], { latitude: 0, longitude: 0 });
  const expectedRevision = writer?.revision ?? null;
  await db.syncs.put({ ...writer, type: 'to', format: 'v2', collectionId, filename: collectionId,
    uploadType: 'manual', createdAt: new Date(), automatic: false, pendingPublication: { snapshot, expectedRevision } });
  await db.restaurants.update(rid, { notes: 'Later local edit' });
  fetchMock.mockClear();
  await syncTo({ automatic: false });
  const repaired = published();
  expect(repaired.snapshotId).not.toBe(snapshot.snapshotId);
  expect(repaired.data.tables.restaurants[0].notes).toBe('Later local edit');
  expect(repaired.data.tables.restaurants[0].googleMapsUrl).toBe('https://maps.google.com/?q=London');
  expect(repaired.data.tables.restaurants[0]).not.toHaveProperty('latitude');
  expect(repaired.data.tables.restaurants[0]).not.toHaveProperty('longitude');
  const publishes = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/v2/snapshots/publish'));
  expect(JSON.parse(publishes[0][1].body).expectedRevision).toBe(expectedRevision);
  writer = await db.syncs.where('type').equals('to').first();
  expect(writer.pendingPublication).toBeUndefined();
  expect(await db.imageAssets.count()).toBe(1);
});


test('obsolete pending replacement reconciles an earlier successful publish with a lost response', async () => {
  await seed();
  await syncTo({ automatic: false });
  const writer = await db.syncs.where('type').equals('to').first();
  const snapshot = published();
  snapshot.data.tables.restaurants.push({ latitude: 0 });
  await db.syncs.update(writer.id, { revision: undefined, snapshotId: undefined,
    pendingPublication: { snapshot, expectedRevision: null } });
  await db.meals.update(1, { name: 'Edited after publish' });
  fetchMock.mockClear();
  await syncTo({ automatic: false });
  expect(published().snapshotId).not.toBe(snapshot.snapshotId);
  expect(published().data.tables.meals[0].name).toBe('Edited after publish');
  const publishCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/v2/snapshots/publish'));
  expect(JSON.parse(publishCall[1].body).expectedRevision).toBe(writer.revision);
});

test('a writer pass pasted into a title and arbitrary Worker errors are absent from actual Sync To diagnostics', async () => {
  const { clearSyncLog, readSyncLog } = await import('../src/util/sync/diagnostics.ts');
  const { syncReport } = await import('../src/util/sync/diagnostics-model.ts');
  await clearSyncLog();
  await seed();
  const pass = 'ΑΒΓΔΕΖΣ';
  storage.env.PASS = pass;
  await db.settings.put({ id: 'youtubeApiPass', value: pass });
  await db.meals.update(1, { name: `Soup ${pass}pie` });
  let signedUrl, token;
  const realFetch = fetchMock.getMockImplementation();
  fetchMock.mockImplementation((input, options) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith('/objects/')) signedUrl = url.href;
    if (url.pathname.endsWith('/images/complete')) {
      token = JSON.parse(options.body).uploadToken;
      return Promise.resolve(Response.json({ error: token }, { status: 400 }));
    }
    return realFetch(input, options);
  });
  await expect(syncTo({ automatic: false })).rejects.toThrow('could not verify');
  await vi.waitFor(() => expect(Object.keys(localStorage).filter(key => key.includes(':sync-log:v1:run:'))).toHaveLength(1));
  const [run] = readSyncLog().runs;
  expect(run.outcome).toBe('failed');
  const report = syncReport(run, true);
  expect(report).toContain('Request failed with HTTP 400.');
  const stored = Object.keys(localStorage).filter(key => key.includes(':sync-log:v1:run:')).map(key => localStorage.getItem(key)).join('');
  for (const sensitive of [pass, signedUrl, token]) {
    expect(sensitive).toBeTruthy();
    expect(stored).not.toContain(sensitive);
    expect(report).not.toContain(sensitive);
  }
  await clearSyncLog();
});
