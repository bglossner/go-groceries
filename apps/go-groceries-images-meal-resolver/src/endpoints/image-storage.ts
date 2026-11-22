import { z } from 'zod';
import { IMAGE_LIMITS, IMAGE_MIME_TYPES } from '@go-groceries/frontend/image-assets';
import { SNAPSHOT_LIMITS } from '@go-groceries/frontend/snapshot';
import type { ImageAsset, ImagePrepareResponse, ImagePrepareRequest, ImageDownloadRequest } from '@go-groceries/frontend/image-assets';
import type { Snapshot } from '@go-groceries/frontend/snapshot';
import type { AppType } from '..';
import { AppContext, ErrorWrapper } from '../types';
import { canonicalJson, digest, headKey, makeAsset, parseSnapshot, snapshotKey, stagingKey, uploadInput, uuid } from '../image-storage/validation';
import { ObjectStorage, defaultDependencies, hasStatus, readBounded, sha256 } from '../image-storage/storage';
import type { StorageDependencies } from '../image-storage/storage';
import { signCapability, verifyCapability } from '../image-storage/capability';
import { validateImage } from '../image-storage/image-format';

const pass = z.string().max(1024);
const scope = z.object({ collectionId: uuid, snapshotId: uuid });
const readScope = scope.extend({ pass: pass.optional() }).strict();
const prepare = z.object({ pass, collectionId: uuid, images: z.array(uploadInput).min(1).max(IMAGE_LIMITS.batch) }).strict();
const complete = z.object({ pass, uploadToken: z.string().max(2048) }).strict();
const download = z.object({ pass: pass.optional(), collectionId: uuid, snapshotId: uuid.optional(),
  assetIds: z.array(digest).min(1).max(IMAGE_LIMITS.batch) }).strict();
const commit = z.object({ pass, snapshot: z.unknown() }).strict();
const publish = scope.extend({ pass, expectedRevision: z.string().regex(/^"[0-9a-f]{32}"$/).nullable() }).strict();
const latest = z.object({ pass, collectionId: uuid }).strict();
const share = scope.extend({ pass, expiresIn: z.number().int().min(1).max(SNAPSHOT_LIMITS.shareSeconds) }).strict();
const notFound = () => new ErrorWrapper({ message: 'Object not found', statusCode: 404 });
const conflict = () => new ErrorWrapper({ message: 'Immutable object or latest revision conflict', statusCode: 409 });

function requireWriter(c: AppContext, supplied: string | undefined) {
  if (!c.env.PASS) throw new ErrorWrapper({ message: 'Shared pass is not configured', statusCode: 503 });
  if (!supplied || supplied !== c.env.PASS) throw new ErrorWrapper({ message: 'Invalid pass provided', statusCode: 403 });
}
async function authorizeRead(c: AppContext, body: { pass?: string; collectionId: string; snapshotId?: string }, deps: StorageDependencies) {
  if (!c.env.PASS) requireWriter(c, body.pass);
  if (body.pass && body.pass === c.env.PASS) return null;
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ') || !body.snapshotId) throw new ErrorWrapper({ message: 'Read authorization required', statusCode: 403 });
  const token = await verifyCapability(header.slice(7), c.env, deps.now());
  if (token.kind !== 'share' || token.collectionId !== body.collectionId || token.snapshotId !== body.snapshotId) {
    throw new ErrorWrapper({ message: 'Capability does not authorize this snapshot', statusCode: 403 });
  }
  return token;
}
async function loadSnapshot(storage: ObjectStorage, collectionId: string, snapshotId: string): Promise<Snapshot> {
  const bytes = await storage.get(snapshotKey(collectionId, snapshotId), SNAPSHOT_LIMITS.byteLength);
  if (!bytes) throw notFound();
  const snapshot = parseSnapshot(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)));
  if (snapshot.collectionId !== collectionId || snapshot.snapshotId !== snapshotId) throw conflict();
  return snapshot;
}

async function rejectDowngrade(storage: ObjectStorage, snapshot: Snapshot, current?: {bytes:Uint8Array}) {
  if (snapshot.data.schemaVersion !== 15) return;
  const head = current ?? await storage.getWithRevision(headKey(snapshot.collectionId),256);
  if (!head) return;
  const pointer = z.object({snapshotId:uuid}).strict().parse(JSON.parse(new TextDecoder().decode(head.bytes)));
  const latest = await loadSnapshot(storage,snapshot.collectionId,pointer.snapshotId);
  if (latest.data.schemaVersion === 16) throw new ErrorWrapper({message:'Collection requires schema 16 / adapter 2. Update all writer clients.',statusCode:409});
}

export function imageStorageEndpoints(app: AppType, deps: StorageDependencies = defaultDependencies) {
  function post(path: string, action: (c: AppContext, body: unknown, storage: ObjectStorage) => Promise<Response>) {
    app.post('/v2/' + path, async c => {
      c.header('Cache-Control', 'private, no-store');
      c.header('Referrer-Policy', 'no-referrer');
      try {
        if (!c.req.raw.body) throw new ErrorWrapper({ message: 'JSON body required', statusCode: 400 });
        const bytes = await readBounded(c.req.raw.body, SNAPSHOT_LIMITS.byteLength + 4096);
        let body: unknown;
        try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)); }
        catch { throw new ErrorWrapper({ message: 'Invalid JSON body', statusCode: 400 }); }
        return await action(c, body, new ObjectStorage(c, deps));
      } catch (error) {
        if (error instanceof z.ZodError) return c.json({ error: 'Invalid v2 request or metadata' }, 400);
        if (error instanceof ErrorWrapper) return c.json({ error: error.message }, error.statusCode);
        // Do not log credentials, signed URLs, tokens, or SDK request details.
        return c.json({ error: 'Storage operation failed' }, 502);
      }
    });
  }

  post('images/prepare', async (c, value, storage) => {
    const body = prepare.parse(value) as ImagePrepareRequest;
    requireWriter(c, body.pass);
    const images: ImagePrepareResponse['images'] = [];
    for (const image of body.images) {
      const asset = makeAsset(body.collectionId, image);
      if (await storage.verifiedAsset(asset)) { images.push({ status: 'existing', asset }); continue; }
      const uploadId = crypto.randomUUID();
      const uploadToken = await signCapability({ kind: 'upload', collectionId: body.collectionId, uploadId,
        image, expiresAt: Math.floor(deps.now() / 1000) + IMAGE_LIMITS.completionSeconds }, c.env);
      images.push({ status: 'upload', asset, uploadToken,
        transfer: await storage.sign(stagingKey(body.collectionId, uploadId), 'PUT', IMAGE_LIMITS.transferSeconds, image.mimeType),
        headers: { 'Content-Type': image.mimeType } });
    }
    return c.json({ images } satisfies ImagePrepareResponse);
  });

  post('images/complete', async (c, value, storage) => {
    const body = complete.parse(value);
    requireWriter(c, body.pass);
    const token = await verifyCapability(body.uploadToken, c.env, deps.now());
    if (token.kind !== 'upload') throw new ErrorWrapper({ message: 'Upload capability required', statusCode: 403 });
    const asset = makeAsset(token.collectionId, token.image);
    const key = stagingKey(token.collectionId, token.uploadId);
    if (!await storage.verifiedAsset(asset)) {
      const bytes = await storage.get(key, IMAGE_LIMITS.byteLength);
      if (!bytes) throw notFound();
      if (bytes.length !== asset.byteLength || await sha256(bytes) !== asset.sha256) {
        throw new ErrorWrapper({ message: 'Uploaded size or SHA-256 does not match', statusCode: 400 });
      }
      validateImage(bytes, asset.mimeType);
      try {
        await storage.put(asset.location.key, bytes, { ContentType: asset.mimeType,
          Metadata: { 'verified-sha256': asset.sha256 }, IfNoneMatch: '*' });
      } catch (error) {
        if (!hasStatus(error, 412)) throw error;
        if (!await storage.verifiedAsset(asset)) throw conflict();
      }
    }
    await storage.removeStaging(key);
    return c.json({ asset });
  });

  post('images/download', async (c, value, storage) => {
    const body = download.parse(value) as ImageDownloadRequest;
    const token = await authorizeRead(c, body, deps);
    // Membership is checked before any asset HEAD/signing, including for guessed hashes.
    const snapshot = body.snapshotId ? await loadSnapshot(storage, body.collectionId, body.snapshotId) : null;
    const members = snapshot ? new Map(snapshot.assets.map(asset => [asset.assetId, asset])) : null;
    if (members && body.assetIds.some(assetId => !members.has(assetId))) {
      throw new ErrorWrapper({ message: 'Asset is not in this snapshot', statusCode: 403 });
    }
    const images = [];
    for (const assetId of body.assetIds) {
      let asset: ImageAsset;
      if (members) {
        asset = members.get(assetId)!;
        if (!await storage.verifiedAsset(asset)) throw notFound();
      } else {
        const key = makeAsset(body.collectionId, { sha256: assetId, mimeType: 'image/png', byteLength: 1 }).location.key;
        const head = await storage.head(key);
        if (!head) throw notFound();
        if (head.Metadata?.['verified-sha256'] !== assetId || !IMAGE_MIME_TYPES.includes(head.ContentType as ImageAsset['mimeType']) ||
            !head.ContentLength || head.ContentLength > IMAGE_LIMITS.byteLength) throw conflict();
        asset = makeAsset(body.collectionId, { sha256: assetId, mimeType: head.ContentType as ImageAsset['mimeType'], byteLength: head.ContentLength });
      }
      const seconds = token ? Math.min(IMAGE_LIMITS.transferSeconds, token.expiresAt - Math.ceil(deps.now() / 1000)) : IMAGE_LIMITS.transferSeconds;
      if (seconds < 1) throw new ErrorWrapper({ message: 'Read capability expired', statusCode: 403 });
      images.push({ asset, ...await storage.sign(asset.location.key, 'GET', seconds) });
    }
    return c.json({ images });
  });

  post('snapshots/commit', async (c, value, storage) => {
    const body = commit.parse(value);
    requireWriter(c, body.pass);
    const snapshot = parseSnapshot(body.snapshot);
    await rejectDowngrade(storage,snapshot);
    const serialized = canonicalJson(snapshot);
    const bytes = new TextEncoder().encode(serialized);
    if (bytes.length > SNAPSHOT_LIMITS.byteLength) throw new ErrorWrapper({ message: 'Snapshot exceeds size limit', statusCode: 413 });
    if (!await storage.verifiedAssets(snapshot.collectionId, snapshot.assets)) throw notFound();
    const key = snapshotKey(snapshot.collectionId, snapshot.snapshotId);
    try {
      await storage.put(key, bytes, { ContentType: 'application/json', IfNoneMatch: '*' });
    } catch (error) {
      if (!hasStatus(error, 412)) throw error;
      const existing = await storage.get(key, SNAPSHOT_LIMITS.byteLength);
      if (!existing || new TextDecoder().decode(existing) !== serialized) throw conflict();
    }
    return c.json({ collectionId: snapshot.collectionId, snapshotId: snapshot.snapshotId, key });
  });

  post('snapshots/publish', async (c, value, storage) => {
    const body = publish.parse(value);
    requireWriter(c, body.pass);
    // An immutable snapshot can survive a publication conflict and be retried safely.
    const snapshot = await loadSnapshot(storage, body.collectionId, body.snapshotId);
    const key = headKey(body.collectionId);
    const bytes = new TextEncoder().encode(JSON.stringify({ snapshotId: body.snapshotId }));
    // Reconcile a successful earlier attempt before trying its stale revision again.
    const current = await storage.getWithRevision(key, 256);
    await rejectDowngrade(storage,snapshot,current ?? undefined);
    if (current && current.revision && JSON.parse(new TextDecoder().decode(current.bytes)).snapshotId === body.snapshotId) {
      return c.json({ snapshotId: body.snapshotId, revision: current.revision });
    }
    if ((current?.revision ?? null) !== body.expectedRevision) throw conflict();
    try {
      const result = await storage.put(key, bytes, { ContentType: 'application/json',
        ...(body.expectedRevision === null ? { IfNoneMatch: '*' } : { IfMatch: body.expectedRevision }) });
      if (!result.ETag) throw new Error('Missing revision');
      return c.json({ snapshotId: body.snapshotId, revision: result.ETag });
    } catch (error) { if (hasStatus(error, 412)) throw conflict(); throw error; }
  });

  post('snapshots/latest', async (c, value, storage) => {
    const body = latest.parse(value);
    requireWriter(c, body.pass);
    const current = await storage.getWithRevision(headKey(body.collectionId), 256);
    if (!current?.revision) throw notFound();
    const pointer = z.object({ snapshotId: uuid }).strict().parse(JSON.parse(new TextDecoder().decode(current.bytes)));
    return c.json({ snapshotId: pointer.snapshotId, revision: current.revision });
  });

  post('snapshots/read', async (c, value, storage) => {
    const body = readScope.parse(value) as { pass?: string; collectionId: string; snapshotId: string };
    await authorizeRead(c, body, deps);
    return c.json({ snapshot: await loadSnapshot(storage, body.collectionId, body.snapshotId) });
  });

  post('snapshots/share', async (c, value, storage) => {
    const body = share.parse(value);
    requireWriter(c, body.pass);
    await loadSnapshot(storage, body.collectionId, body.snapshotId);
    const expiresAt = Math.floor(deps.now() / 1000) + body.expiresIn;
    const shareToken = await signCapability({ kind: 'share', collectionId: body.collectionId, snapshotId: body.snapshotId, expiresAt }, c.env);
    return c.json({ collectionId: body.collectionId, snapshotId: body.snapshotId, shareToken, expiresAt: new Date(expiresAt * 1000).toISOString() });
  });
}
