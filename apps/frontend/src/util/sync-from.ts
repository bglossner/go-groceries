import Dexie from 'dexie';
import { db, type Sync } from '../db/db';
import { getPresignedUrlExpirationInfo } from './file/s3-presigned';
import { getDiffsFromNewImport, handleFileImport, type DiffsResult } from './db/import';
import { SNAPSHOT_LIMITS, SNAPSHOT_TABLES, type Snapshot, type SnapshotHead, type SnapshotReadResponse } from '../shareable/snapshot';
import { parseSnapshot } from './sync/snapshot-validation';
import { localMetadataDigest, metadataDigest, snapshotDiffs, stageSnapshot } from './sync/snapshot-adapter';
import { boundedJson, v2Post, writerPermission, type ReadPermission } from './sync/api';
import { legacyTransfer, parseLocation, readPermission, rememberLegacyTransfer } from './sync/location';
import { hydrateSnapshot, hydrationMessage } from './sync/hydrate';
import { withCloudSyncLock } from './sync/lock';
import type { SyncProgress } from './sync';

type ImportContext = { sync: Sync; permission: ReadPermission; revision?: string; onProgress?: SyncProgress };
const contexts = new WeakMap<Blob, ImportContext>();
export async function saveSuccessfulSync(options?: { noOpSync?: boolean }) {
  const existing = await db.syncs.where('type').equals('from').first();
  if (existing?.id && !options?.noOpSync) await db.syncs.update(existing.id, { lastSyncedAt: new Date() });
}
export async function saveSyncFromLocation(url: string, alias?: string) {
  const location = parseLocation(url);
  const existing = await db.syncs.where('type').equals('from').first();
  if (existing?.url === location.url && existing.format === location.format && existing.access === location.access) {
    await db.syncs.update(existing.id!, { alias: alias ?? existing.alias });
    return;
  }
  await db.syncs.put({ ...location, id: existing?.id, type: 'from', uploadType: 'manual', createdAt: existing?.createdAt ?? new Date(),
    alias, automatic: false, importGeneration: crypto.randomUUID() });
}

async function legacyFile(sync: Sync): Promise<Blob> {
  // Old persisted signed links are consumed once and replaced with their unsigned location.
  let current = sync.url?.includes('?') ? sync.url : legacyTransfer(sync.url ?? '');
  if (sync.url?.includes('?')) {
    const parsed = parseLocation(sync.url);
    await db.syncs.update(sync.id!, { url: parsed.url }); sync = { ...sync, url: parsed.url };
  }
  const renew = async () => {
    const { pass } = await writerPermission();
    let response: Response;
    try { response = await fetch(`${import.meta.env.VITE_FILE_SYNC_BASE_URL}/file-retrieval`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pass, fileName: sync.filename, uploadedType: 'R2' }),
      cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30000),
    }); } catch { throw new Error('Legacy sync unavailable'); }
    if (!response.ok) {
      if (response.status === 403) throw new Error('Legacy retrieval pass rejected. Reopen the old shared link or set the writer pass.');
      if (response.status === 400) throw new Error('Invalid legacy sync filename. Check the old shared link.');
      if (response.status === 404) throw new Error('Legacy sync file not found in storage. Check the old shared link.');
      if (response.status >= 500) throw new Error('Legacy sync storage lookup failed. Retry later or ask the service owner to check storage access.');
      throw new Error(`Legacy retrieval failed (${response.status}). Retry sync.`);
    }
    const result = await boundedJson(response) as { url: string };
    if (typeof result.url !== 'string') throw new Error('Invalid legacy retrieval response');
    rememberLegacyTransfer(sync.url!, result.url); return result.url;
  };
  if (current) {
    try { if (getPresignedUrlExpirationInfo(current).secondsRemaining < 60) current = undefined; }
    catch { /* Plain local v1 fixture URLs are also readable. */ }
  }
  current ??= await renew();
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try { response = await fetch(current, { cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30000) }); }
    catch { throw new Error('Legacy sync download failed'); }
    if (response.ok) return response.blob();
    if (attempt === 0 && [401, 403].includes(response.status)) { current = await renew(); continue; }
    throw new Error('Legacy sync download failed. Original local data is unchanged.');
  }
  throw new Error('Legacy retrieval failed');
}

export async function syncFromDb(onProgress?: SyncProgress): Promise<{ blob: Blob; diffsResult: DiffsResult }> {
  const sync = await db.syncs.where('type').equals('from').first();
  if (!sync?.url) throw new Error('No sync from location configured.');
  onProgress?.('Fetching metadata...');
  if (sync.format !== 'v2') {
    const blob = await legacyFile(sync);
    return { blob, diffsResult: await getDiffsFromNewImport(blob) };
  }
  const permission = await readPermission(sync);
  const head = sync.access === 'share' ? undefined : await v2Post<SnapshotHead>('snapshots/latest', { collectionId: sync.collectionId }, permission);
  const snapshotId = head?.snapshotId ?? sync.snapshotId;
  const response = await v2Post<SnapshotReadResponse>('snapshots/read', { collectionId: sync.collectionId, snapshotId }, permission);
  const snapshot = parseSnapshot(response.snapshot);
  if (snapshot.collectionId !== sync.collectionId || snapshot.snapshotId !== snapshotId) throw new Error('Snapshot scope mismatch');
  const blob = new Blob([JSON.stringify(snapshot)], { type: 'application/json' });
  if (blob.size > SNAPSHOT_LIMITS.byteLength) throw new Error('Snapshot exceeds size limit');
  contexts.set(blob, { sync, permission, revision: head?.revision, onProgress });
  const diffsResult = await snapshotDiffs(snapshot);
  onProgress?.(`Metadata ready; ${snapshot.assets.length} owned images will be checked after import.`);
  return { blob, diffsResult };
}

/** Sync manifests use an atomic metadata adapter; full portable backups keep their existing importer. */
export async function importSyncFile(blob: Blob, options: { automatic?: boolean } = {}): Promise<string> {
  let value: unknown;
  try { value = JSON.parse(await blob.text()); } catch { throw new Error('Invalid sync file'); }
  if (!value || typeof value !== 'object' || !('format' in value) || value.format !== 'go-groceries-snapshot') {
    await handleFileImport(blob); await saveSuccessfulSync(); return 'Legacy sync imported, including embedded images.';
  }
  if (blob.size > SNAPSHOT_LIMITS.byteLength) throw new Error('Snapshot exceeds size limit');
  const { snapshot, temporary } = await stageSnapshot(value);
  const context = contexts.get(blob);
  const importGeneration = crypto.randomUUID();
  try {
    await withCloudSyncLock(async () => {
    const lastMetadataDigest = await metadataDigest(snapshot.data.tables);
    const tables = new Map(await Promise.all(SNAPSHOT_TABLES.map(async name => [name, await temporary.table(name).toArray()] as const)));
    await db.transaction('rw', [...SNAPSHOT_TABLES.map(name => db.table(name)), db.imageUploadJobs, db.imageMigrationJobs, db.syncs], async () => {
      if (context) {
        const current = await db.syncs.get(context.sync.id!);
        if (!current || current.url !== context.sync.url || current.importGeneration !== context.sync.importGeneration) {
          throw new Error('The sync source or imported revision changed. Fetch metadata again; current data is retained.');
        }
      }
      if (options.automatic && context) {
        const current = await db.syncs.get(context.sync.id!);
        const writer = await db.syncs.where('type').equals('to').first();
        const baseline = current?.lastMetadataDigest ?? (writer?.collectionId === snapshot.collectionId ? writer.lastMetadataDigest : undefined);
        if (!baseline || writer?.collectionId === snapshot.collectionId && writer.pendingPublication ||
            await Dexie.waitFor(localMetadataDigest()) !== baseline) {
          throw new Error('Local changes need confirmation. Import manually in Sync settings; current data is retained.');
        }
      }
      for (const name of SNAPSHOT_TABLES) { await db.table(name).clear(); await db.table(name).bulkPut(tables.get(name)!); }
      await db.imageMigrationJobs.clear();
      for (const asset of snapshot.assets) {
        if (!await db.imageUploadJobs.get(asset.assetId)) await db.imageUploadJobs.put({ assetId: asset.assetId, createdAt: new Date().toISOString() });
      }
      if (context) {
        await db.syncs.update(context.sync.id!, { snapshotId: snapshot.snapshotId, revision: context.revision,
          lastSyncedAt: new Date(), lastMetadataDigest, importGeneration, cachedImages: 0, totalImages: snapshot.assets.length });
        // An explicit latest import resolves a writer conflict; it is not an automatic overwrite retry.
        if (context.revision) {
          const writer = await db.syncs.where('type').equals('to').first();
          if (writer?.collectionId === snapshot.collectionId) await db.syncs.update(writer.id!, {
            revision: context.revision, snapshotId: snapshot.snapshotId, pendingPublication: undefined, lastMetadataDigest,
          });
        }
      }
    });
    });
  } finally { await temporary.delete(); }
  context?.onProgress?.('Metadata imported. Hydrating images...');
  let result: Awaited<ReturnType<typeof hydrateSnapshot>>;
  try {
    const permission = context?.permission ?? await writerPermission();
    result = await hydrateSnapshot(snapshot as Snapshot, permission, context?.onProgress);
  } catch {
    result = { cached: 0, total: snapshot.assets.length, failures: ['Image authorization unavailable. Reopen the source link.'] };
  }
  if (context) await db.transaction('rw', db.syncs, async () => {
    const current = await db.syncs.get(context.sync.id!);
    if (current?.snapshotId === snapshot.snapshotId && current.collectionId === snapshot.collectionId &&
        current.url === context.sync.url && current.importGeneration === importGeneration) await db.syncs.update(context.sync.id!, { cachedImages: result.cached, totalImages: result.total });
  });
  const message = hydrationMessage(result); context?.onProgress?.(message); return message;
}

export async function checkAndTriggerAutoSync(): Promise<{ blob: Blob; diffsResult: DiffsResult; outcome: 'SUCCESS'; needsConfirmation: boolean } | { outcome: 'RECENT_SYNC' | 'ERROR' } | null> {
  const sync = await db.syncs.where('type').equals('from').first();
  if (!sync?.automatic) return null;
  if (sync.lastSyncedAt && Date.now() - sync.lastSyncedAt.getTime() < 3600000) return { outcome: 'RECENT_SYNC' };
  try {
    const result = await syncFromDb();
    const writer = await db.syncs.where('type').equals('to').first();
    const baseline = sync.lastMetadataDigest ?? (writer?.collectionId === sync.collectionId ? writer?.lastMetadataDigest : undefined);
    let needsConfirmation = true;
    if (baseline && !(writer?.collectionId === sync.collectionId && writer?.pendingPublication)) {
      try { needsConfirmation = await localMetadataDigest() !== baseline; } catch { /* Retain unresolved originals. */ }
    }
    return { ...result, outcome: 'SUCCESS', needsConfirmation };
  }
  catch { return { outcome: 'ERROR' }; }
}
