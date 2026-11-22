import { db, type Sync } from '../db/db';
import { runImageMigration, verifyCachedAsset } from '../db/image-cache';
import { IMAGE_LIMITS, type ImagePrepareResponse, type ImageCompleteResponse } from '../shareable/image-assets';
import type { SnapshotHead } from '../shareable/snapshot';
import { freezeSnapshot, metadataDigest } from './sync/snapshot-adapter';
import { canonicalJson, parseSnapshot } from './sync/snapshot-validation';
import { SyncApiError, v2Post, writerPermission } from './sync/api';
import { withCloudSyncLock } from './sync/lock';
import { collectionUrl } from './sync/location';
import { pendingPhotoIsObsolete, photoRejectionKey } from './sync/image-preflight';
import { photoOwners } from './sync/snapshot-photos';

export type SyncProgress = (message: string) => void;
type SyncToOptions = { existingSync?: Sync; automatic: boolean; newLocation?: boolean; onProgress?: SyncProgress; onWarning?: SyncProgress };
type PendingPublication = NonNullable<Sync['pendingPublication']> & { imageWarnings?: string[]; needsImageRepair?: true };

export function syncTo(options: SyncToOptions): Promise<string> {
  return withCloudSyncLock(() => publish(options));
}

async function pendingHasObsoletePhotos(pending: PendingPublication) {
  if (pending.needsImageRepair) return true;
  if (pending.imageWarnings) return false;
  for (const expected of pending.snapshot.assets) {
    const source = await db.imageAssets.get(expected.assetId);
    // A pending publication can still reuse a verified cloud image missing locally.
    if (source && await pendingPhotoIsObsolete(source, expected)) return true;
  }
  return false;
}

async function publish(options: SyncToOptions, followPending = true) {
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
  let pending: PendingPublication | undefined = sync.pendingPublication;
  const pendingSnapshot = pending?.snapshot;
  const hasRemovedFields = pendingSnapshot?.data.schemaVersion === 16 &&
    pendingSnapshot.data.tables.restaurants.some(row => 'latitude' in row || 'longitude' in row);
  const obsoletePhotos = pending && pendingSnapshot?.data.schemaVersion === 16 && !hasRemovedFields && await pendingHasObsoletePhotos(pending);
  const resumedPending = !!pending && pendingSnapshot?.data.schemaVersion === 16 && !hasRemovedFields && !obsoletePhotos;
  // An obsolete local frozen snapshot needs a fresh immutable ID; keep its revision condition.
  if (!pending || pendingSnapshot?.data.schemaVersion === 15 || hasRemovedFields || obsoletePhotos) {
    progress('Preparing metadata and checking local images...');
    let expectedRevision = pending ? pending.expectedRevision : sync.revision ?? null;
    if (pendingSnapshot) {
      // A legacy snapshot may already be latest if the browser lost its publish response.
      const head = await v2Post<SnapshotHead>('snapshots/latest', { collectionId }, permission).catch(error => {
        if (error instanceof SyncApiError && error.status === 404) return undefined;
        throw error;
      });
      if (head && head.snapshotId === pendingSnapshot?.snapshotId && /^"[0-9a-f]{32}"$/.test(head.revision)) expectedRevision = head.revision;
    }
    await runImageMigration();
    const { snapshot, warnings } = await freezeSnapshot(collectionId, crypto.randomUUID());
    pending = { snapshot, expectedRevision, imageWarnings: warnings };
    const writerId = sync.id!;
    const revision = sync.revision;
    await db.transaction('rw', db.syncs, async () => {
      const current = await db.syncs.get(writerId);
      if (current?.collectionId !== collectionId || current.revision !== revision ||
          current.pendingPublication?.snapshot.snapshotId !== pendingSnapshot?.snapshotId) {
        throw new Error('Sync state changed while preparing photos. Retry from the current location.');
      }
      await db.syncs.update(writerId, { pendingPublication: pending });
    });
  }
  if (pending.snapshot.data.schemaVersion !== 16 || pending.snapshot.data.adapterVersion !== 2) throw new Error('Older pending snapshot cannot be published. Import the current collection in Sync settings before retrying.');
  const publication = pending;
  const snapshot = parseSnapshot(publication.snapshot);
  const owners = photoOwners(snapshot.data);
  const requirePending = async () => {
    const current = await db.syncs.get(sync!.id!);
    if (current?.collectionId !== collectionId || current.pendingPublication?.snapshot.snapshotId !== snapshot.snapshotId) {
      throw new Error('Sync state changed during publication. Retry from the current location.');
    }
  };
  const markForRepair = async (rejectedAssetId?: string) => db.transaction('rw', db.syncs, db.settings, async () => {
    await requirePending();
    if (rejectedAssetId) await db.settings.put({ id: photoRejectionKey(collectionId, rejectedAssetId), value: 'true' });
    const stale: PendingPublication = { ...publication, needsImageRepair: true };
    await db.syncs.update(sync.id!, { pendingPublication: stale });
  });
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
        const owner = [...owners.get(expected.assetId)!].join(', ');
        const local = await db.imageAssets.get(expected.assetId);
        if (!local) {
          await markForRepair();
          throw new Error(`A photo for ${owner} is missing from this device. Sync from its source or remove its reference before retrying.`);
        }
        try { await verifyCachedAsset(local); }
        catch {
          await markForRepair();
          throw new Error(`A photo for ${owner} failed its local integrity check. Restore it or retry sync to repair the publication.`);
        }
        if (local.byteLength !== expected.byteLength) throw new Error(`A photo for ${owner} does not match the saved size. Restore it before retrying.`);
        const body = local.mimeType === expected.mimeType ? local.blob : local.blob.slice(0, local.byteLength, expected.mimeType);
        progress(`Uploading new image ${start + index + 1} of ${snapshot.assets.length}...`);
        // The random staging URL and completion capability remain in memory only.
        let response: Response;
        try { response = await fetch(item.transfer.url, { method: 'PUT', body, headers: item.headers,
          cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30000) }); }
        catch { throw new Error(`Upload interrupted for ${owner}. Retry sync to reconcile uploaded images.`); }
        if (!response.ok) throw new Error(`Image staging upload failed for ${owner}. Retry sync for a fresh transfer.`);
        const completed = await v2Post<ImageCompleteResponse>('images/complete', { uploadToken: item.uploadToken }, permission).catch(async error => {
          if (error instanceof SyncApiError && error.imageRejection === 'container') {
            await markForRepair(expected.assetId);
            throw new Error(`Cloud storage rejected the container or dimensions of a photo for ${owner}. Retry sync to continue without it.`);
          }
          if (error instanceof SyncApiError && error.status === 400) {
            throw new Error(`Cloud storage could not verify a photo for ${owner}. Retry sync.`);
          }
          throw error;
        });
        if (canonicalJson(completed.asset) !== canonicalJson(expected)) throw new Error('Verified image descriptor mismatch');
      } else if (item.status !== 'existing') throw new Error('Invalid image preparation status');
      await db.transaction('rw', db.imageUploadJobs, async () => {
        const previous = await db.imageUploadJobs.get(expected.assetId);
        await db.imageUploadJobs.put({ assetId: expected.assetId, createdAt: previous?.createdAt ?? new Date().toISOString(),
          collections: { ...previous?.collections, [collectionId]: { verifiedAt: new Date().toISOString() } } });
      });
    }
  }
  await requirePending();
  progress('Committing metadata snapshot...');
  await v2Post('snapshots/commit', { snapshot }, permission);
  await requirePending();
  progress('Publishing latest snapshot...');
  const head = await v2Post<SnapshotHead>('snapshots/publish', { collectionId, snapshotId: snapshot.snapshotId,
    expectedRevision: publication.expectedRevision }, permission);
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
  const warnings = publication.imageWarnings ?? [];
  const warning = warnings.length ? `${warnings.join(' ')} Originals are kept on this device.` : '';
  progress([`Synced metadata; ${snapshot.assets.length} verified cloud images. Unchanged images were reused.`, warning].filter(Boolean).join(' '));
  if (warning) options.onWarning?.(warning);
  return collectionUrl(collectionId);
}
