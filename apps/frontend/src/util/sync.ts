import { db, type Sync } from '../db/db';
import { runImageMigration, verifyCachedAsset } from '../db/image-cache';
import { IMAGE_LIMITS, type ImagePrepareResponse, type ImageCompleteResponse } from '../shareable/image-assets';
import type { SnapshotHead } from '../shareable/snapshot';
import { freezeSnapshot, metadataDigest } from './sync/snapshot-adapter';
import { canonicalJson, parseSnapshot } from './sync/snapshot-validation';
import { v2Post, writerPermission } from './sync/api';
import { withCloudSyncLock } from './sync/lock';
import { collectionUrl } from './sync/location';

export type SyncProgress = (message: string) => void;
export function syncTo(options: { existingSync?: Sync; automatic: boolean; newLocation?: boolean; onProgress?: SyncProgress }): Promise<string> {
  return withCloudSyncLock(() => publish(options));
}
async function publish(options: { existingSync?: Sync; automatic: boolean; newLocation?: boolean; onProgress?: SyncProgress }, followPending = true) {
  const progress = options.onProgress ?? (() => undefined);
  const permission = await writerPermission();
  let sync = options.existingSync?.id ? await db.syncs.get(options.existingSync.id) : await db.syncs.where('type').equals('to').first();
  const previousId = sync?.id;
  if (options.newLocation && sync?.format !== 'v2') sync = undefined;
  if (sync && sync.format !== 'v2') throw new Error('The old sync location is unchanged. Confirm a new v2 cloud location in Sync settings.');
  if (!sync) {
    const collectionId = crypto.randomUUID();
    const id = await db.syncs.put({ id: previousId, type: 'to', format: 'v2', collectionId, filename: collectionId,
      uploadType: 'manual', createdAt: new Date(), automatic: options.automatic, url: collectionUrl(collectionId), access: 'writer' });
    sync = (await db.syncs.get(id))!;
  }
  const collectionId = sync.collectionId!;
  const resumedPending = !!sync.pendingPublication;
  const pendingSnapshot = sync.pendingPublication?.snapshot;
  const hasRemovedFields = pendingSnapshot?.data.schemaVersion === 16 &&
    pendingSnapshot.data.tables.restaurants.some(row => 'latitude' in row || 'longitude' in row);
  // An obsolete local frozen snapshot needs a fresh immutable ID; keep its revision condition.
  if (!sync.pendingPublication || pendingSnapshot?.data.schemaVersion === 15 || hasRemovedFields) {
    progress('Preparing metadata and checking local images...');
    await runImageMigration();
    const { snapshot } = await freezeSnapshot(collectionId, crypto.randomUUID());
    const pendingPublication = { snapshot, expectedRevision: sync.pendingPublication ? sync.pendingPublication.expectedRevision : sync.revision ?? null };
    await db.syncs.update(sync.id!, { pendingPublication });
    sync = { ...sync, pendingPublication };
  }
  const pending = sync.pendingPublication!;
  if (pending.snapshot.data.schemaVersion !== 16 || pending.snapshot.data.adapterVersion !== 2) throw new Error('Older pending snapshot cannot be published. Import the current collection in Sync settings before retrying.');
  const snapshot = parseSnapshot(pending.snapshot);
  // Reconcile the authoritative frozen inventory on every attempt, even after remote deletion.
  for (let start = 0; start < snapshot.assets.length; start += IMAGE_LIMITS.batch) {
    const batch = snapshot.assets.slice(start, start + IMAGE_LIMITS.batch);
    progress(`Checking cloud images ${start + 1}-${start + batch.length} of ${snapshot.assets.length}...`);
    const prepared = await v2Post<ImagePrepareResponse>('images/prepare', { collectionId,
      images: batch.map(({ sha256, mimeType, byteLength }) => ({ sha256, mimeType, byteLength })) }, permission);
    if (!Array.isArray(prepared.images) || prepared.images.length !== batch.length) throw new Error('Invalid image preparation response');
    for (const [index, item] of prepared.images.entries()) {
      const expected = batch[index];
      if (canonicalJson(item.asset) !== canonicalJson(expected)) throw new Error('Cloud image descriptor mismatch');
      if (item.status === 'upload') {
        const local = await db.imageAssets.get(expected.assetId);
        if (!local) throw new Error('A pending image is no longer cached. Sync from its source before retrying.');
        await verifyCachedAsset(local);
        if (local.byteLength !== expected.byteLength || local.mimeType !== expected.mimeType) throw new Error('Cached image descriptor mismatch');
        progress(`Uploading new image ${start + index + 1} of ${snapshot.assets.length}...`);
        // The random staging URL and completion capability remain in memory only.
        let response: Response;
        try { response = await fetch(item.transfer.url, { method: 'PUT', body: local.blob, headers: item.headers,
          cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30000) }); }
        catch { throw new Error('Image upload interrupted. Retry sync to reconcile uploaded images.'); }
        if (!response.ok) throw new Error('Image staging upload failed. Retry sync for a fresh transfer.');
        const completed = await v2Post<ImageCompleteResponse>('images/complete', { uploadToken: item.uploadToken }, permission);
        if (canonicalJson(completed.asset) !== canonicalJson(expected)) throw new Error('Verified image descriptor mismatch');
      } else if (item.status !== 'existing') throw new Error('Invalid image preparation status');
      await db.transaction('rw', db.imageUploadJobs, async () => {
        const previous = await db.imageUploadJobs.get(expected.assetId);
        await db.imageUploadJobs.put({ assetId: expected.assetId, createdAt: previous?.createdAt ?? new Date().toISOString(),
          collections: { ...previous?.collections, [collectionId]: { verifiedAt: new Date().toISOString() } } });
      });
    }
  }
  const requirePending = async () => {
    const current = await db.syncs.get(sync!.id!);
    if (current?.collectionId !== collectionId || current.pendingPublication?.snapshot.snapshotId !== snapshot.snapshotId) {
      throw new Error('Sync state changed during publication. Retry from the current location.');
    }
  };
  await requirePending();
  progress('Committing metadata snapshot...');
  await v2Post('snapshots/commit', { snapshot }, permission);
  await requirePending();
  progress('Publishing latest snapshot...');
  const head = await v2Post<SnapshotHead>('snapshots/publish', { collectionId, snapshotId: snapshot.snapshotId,
    expectedRevision: pending.expectedRevision }, permission);
  if (head.snapshotId !== snapshot.snapshotId || !/^"[0-9a-f]{32}"$/.test(head.revision)) throw new Error('Invalid latest revision response');
  const lastMetadataDigest = await metadataDigest(snapshot.data.tables);
  await db.transaction('rw', db.syncs, async () => {
    await requirePending();
    await db.syncs.update(sync!.id!, { snapshotId: snapshot.snapshotId, revision: head.revision, pendingPublication: undefined,
      lastSyncedAt: new Date(), lastMetadataDigest, cachedImages: snapshot.assets.length, totalImages: snapshot.assets.length });
    // A writer-following read staged before this head advance is now obsolete.
    // Fixed read-only shares keep their immutable snapshot authorization.
    await db.syncs.where('type').equals('from').filter(source => source.format === 'v2' &&
      source.access === 'writer' && source.collectionId === collectionId).modify({ importGeneration: crypto.randomUUID() });
  });
  // A recovered frozen revision may predate later local edits. Publish a fresh revision
  // before acknowledging the caller's queue, including after a browser restart.
  if (resumedPending && followPending) return publish(options, false);
  progress(`Synced metadata; ${snapshot.assets.length} verified cloud images. Unchanged images were reused.`);
  return collectionUrl(collectionId);
}
