import { db, type Sync } from '../db/db';
import { runImageMigration, verifyCachedAsset } from '../db/image-cache';
import { IMAGE_LIMITS, type ImagePrepareResponse, type ImageCompleteResponse } from '../shareable/image-assets';
import type { SnapshotHead } from '../shareable/snapshot';
import { freezeSnapshot, metadataDigest } from './sync/snapshot-adapter';
import { canonicalJson, parseSnapshot } from './sync/snapshot-validation';
import { SyncApiError, v2Post, writerPermission } from './sync/api';
import { withCloudSyncLock } from './sync/lock';
import { collectionUrl } from './sync/location';
import { acknowledgePhotoNotices, pendingPhotoIsObsolete, photoRejectionKey, type PhotoNotice } from './sync/image-preflight';
import { photoOwners } from './sync/snapshot-photos';
import { beginSyncRun, logStep, networkOutcome, safely, startAttempt, type SyncRecorder } from './sync/diagnostics';
import type { SyncTrigger } from './sync/diagnostics-model';
import { diagnosticImage, observeSmallImage, photoAttribution, type ObservedImage } from './sync/diagnostic-photos';

export type SyncProgress = (message: string) => void;
type SyncToOptions = { existingSync?: Sync; automatic: boolean; newLocation?: boolean; onProgress?: SyncProgress; onWarning?: SyncProgress; trigger?: SyncTrigger };
type PendingPublication = NonNullable<Sync['pendingPublication']> & {
  imageWarnings?: string[]; imageSkipCount?: number; photoSources?: Record<string, string[]>; needsImageRepair?: true;
};

function photoWarning(warnings: string[]) {
  return warnings.length ? `${warnings.join(' ')} Originals are kept on this device.` : '';
}

export async function syncTo(options: SyncToOptions): Promise<string> {
  const recorder = beginSyncRun(options.trigger ?? (options.newLocation ? 'setup' : 'manual'));
  let outcome: 'failed' | 'succeeded' = 'failed';
  try {
    const url = await withCloudSyncLock(() => {
      recorder?.acquired();
      return publish(options, recorder);
    });
    outcome = 'succeeded';
    return url;
  } finally {
    recorder?.finish(outcome);
  }
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

async function publish(options: SyncToOptions, recorder?: SyncRecorder, followPending = true) {
  const progress = options.onProgress ?? (() => undefined);
  const background = options.trigger === 'scheduled' || options.trigger === 'debounced';
  const permission = await logStep(recorder, 'authorize', writerPermission);
  const { sync, pendingSnapshot, obsoletePhotos, hasRemovedFields } = await logStep(recorder, 'location', async () => {
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
    const pendingSnapshot = sync.pendingPublication?.snapshot;
    const hasRemovedFields = pendingSnapshot?.data.schemaVersion === 16 &&
      pendingSnapshot.data.tables.restaurants.some(row => 'latitude' in row || 'longitude' in row);
    const obsoletePhotos = sync.pendingPublication && pendingSnapshot?.data.schemaVersion === 16 && !hasRemovedFields &&
      await pendingHasObsoletePhotos(sync.pendingPublication);
    return { sync, pendingSnapshot, obsoletePhotos, hasRemovedFields };
  });
  const collectionId = sync.collectionId!;
  let pending: PendingPublication | undefined = sync.pendingPublication;
  const resumedPending = !!pending && pendingSnapshot?.data.schemaVersion === 16 && !hasRemovedFields && !obsoletePhotos;
  const observations = new Map<string, ObservedImage>();
  let manualNotices: PhotoNotice[] = [];
  // An obsolete local frozen snapshot needs a fresh immutable ID; keep its revision condition.
  if (!pending || pendingSnapshot?.data.schemaVersion === 15 || hasRemovedFields || obsoletePhotos) {
    progress('Preparing metadata and checking local images...');
    let expectedRevision = pending ? pending.expectedRevision : sync.revision ?? null;
    if (pendingSnapshot) {
      // A legacy snapshot may already be latest if the browser lost its publish response.
      const head = await logStep(recorder, 'latest', observe =>
        v2Post<SnapshotHead>('snapshots/latest', { collectionId }, permission, true, observe).catch(error => {
          if (error instanceof SyncApiError && error.status === 404) return undefined;
          throw error;
        }));
      if (head && head.snapshotId === pendingSnapshot?.snapshotId && /^"[0-9a-f]{32}"$/.test(head.revision)) expectedRevision = head.revision;
    }
    pending = await logStep(recorder, 'freeze', async () => {
      await runImageMigration();
      const { snapshot, warnings, newWarnings, notices, skippedCount, photoSources } = await freezeSnapshot(collectionId, crypto.randomUUID(), recorder && {
        recorder, pass: permission.pass, observed: observations,
      });
      const prepared = { snapshot, expectedRevision, imageWarnings: warnings, imageSkipCount: skippedCount, photoSources };
      const writerId = sync.id!;
      const revision = sync.revision;
      await db.transaction('rw', db.syncs, async () => {
        const current = await db.syncs.get(writerId);
        if (current?.collectionId !== collectionId || current.revision !== revision ||
            current.pendingPublication?.snapshot.snapshotId !== pendingSnapshot?.snapshotId) {
          throw new Error('Sync state changed while preparing photos. Retry from the current location.');
        }
        await db.syncs.update(writerId, { pendingPublication: prepared });
      });
      if (!background) manualNotices = notices;
      else if (newWarnings.length && options.onWarning) {
        options.onWarning(photoWarning(newWarnings));
        await acknowledgePhotoNotices(notices);
      }
      return prepared;
    });
  } else if (pending.imageWarnings?.length) {
    recorder?.warning('previousSkips', { count: pending.imageSkipCount ?? pending.imageWarnings.length });
  }
  const publication = pending;
  const snapshot = await logStep(recorder, 'validate', () => {
    if (publication.snapshot.data.schemaVersion !== 16 || publication.snapshot.data.adapterVersion !== 2) {
      throw new Error('Older pending snapshot cannot be published. Import the current collection in Sync settings before retrying.');
    }
    return parseSnapshot(publication.snapshot);
  });
  const attribution = safely(() => recorder && photoAttribution(snapshot.data, permission.pass));
  let observing = false;
  const owners = photoOwners(snapshot.data);
  const requirePending = async () => {
    const current = await db.syncs.get(sync!.id!);
    if (current?.collectionId !== collectionId || current.pendingPublication?.snapshot.snapshotId !== snapshot.snapshotId) {
      throw new Error('Sync state changed during publication. Retry from the current location.');
    }
  };
  const markForRepair = async (rejectedAssetId?: string) => db.transaction('rw', db.syncs, db.settings, async () => {
    await requirePending();
    if (rejectedAssetId) {
      const sources = publication.photoSources?.[rejectedAssetId];
      await db.settings.put({ id: photoRejectionKey(collectionId, rejectedAssetId), value: sources ? JSON.stringify(sources) : 'true' });
    }
    const stale: PendingPublication = { ...publication, needsImageRepair: true };
    await db.syncs.update(sync.id!, { pendingPublication: stale });
  });
  let reused = 0;
  // Reconcile the authoritative frozen inventory on every attempt, even after remote deletion.
  for (let start = 0; start < snapshot.assets.length; start += IMAGE_LIMITS.batch) {
    const batch = snapshot.assets.slice(start, start + IMAGE_LIMITS.batch);
    progress(`Checking cloud images ${start + 1}-${start + batch.length} of ${snapshot.assets.length}...`);
    const prepared = await logStep(recorder, 'prepare', async observe => {
      const result = await v2Post<ImagePrepareResponse>('images/prepare', { collectionId,
        images: batch.map(({ sha256, mimeType, byteLength }) => ({ sha256, mimeType, byteLength })) }, permission, true, observe);
      if (!Array.isArray(result.images) || result.images.length !== batch.length) throw new Error('Invalid image preparation response');
      return result;
    }, { range: { first: start + 1, last: start + batch.length, total: snapshot.assets.length } });
    for (const [index, item] of prepared.images.entries()) {
      const expected = batch[index];
      const image = safely(() => recorder && diagnosticImage(start + index + 1, snapshot.assets.length,
        expected, attribution?.get(expected.assetId), observations.get(expected.assetId)));
      const owner = item?.status === 'upload' ? [...owners.get(expected.assetId)!].join(', ') : undefined;
      const body = await logStep(recorder, 'checkImage', async () => {
        if (canonicalJson(item.asset) !== canonicalJson(expected)) throw new Error('Cloud image descriptor mismatch');
        if (item.status === 'existing') return;
        if (item.status !== 'upload') throw new Error('Invalid image preparation status');
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
        if (image && !image.detected && !observing) safely(() => {
          const lookup = observeSmallImage(body, image);
          if (lookup) {
            observing = true;
            void lookup.then(() => { observing = false; recorder?.refresh(); }).catch(() => undefined);
          }
        });
        return body;
      }, { image });
      if (item.status === 'upload' && body) {
        progress(`Uploading new image ${start + index + 1} of ${snapshot.assets.length}...`);
        await logStep(recorder, 'upload', async observe => {
          const record = startAttempt(observe);
          // The random staging URL and completion capability remain in memory only.
          let response: Response;
          try { response = await fetch(item.transfer.url, { method: 'PUT', body, headers: item.headers,
            cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30000) }); }
          catch (error) {
            safely(() => record?.(networkOutcome(error)));
            throw new Error(`Upload interrupted for ${owner}. Retry sync to reconcile uploaded images.`);
          }
          safely(() => record?.('response', response.status));
          if (!response.ok) throw new Error(`Image staging upload failed for ${owner}. Retry sync for a fresh transfer.`);
        }, { image });
        await logStep(recorder, 'complete', async observe => {
          const completed = await v2Post<ImageCompleteResponse>('images/complete', { uploadToken: item.uploadToken }, permission, true, observe).catch(async error => {
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
        }, { image });
      } else reused++;
      await logStep(recorder, 'reconcile', () => db.transaction('rw', db.imageUploadJobs, async () => {
        const previous = await db.imageUploadJobs.get(expected.assetId);
        await db.imageUploadJobs.put({ assetId: expected.assetId, createdAt: previous?.createdAt ?? new Date().toISOString(),
          collections: { ...previous?.collections, [collectionId]: { verifiedAt: new Date().toISOString() } } });
      }), { image });
    }
  }
  if (reused) recorder?.reuse(reused);
  await logStep(recorder, 'commit', async observe => {
    await requirePending();
    progress('Committing metadata snapshot...');
    await v2Post('snapshots/commit', { snapshot }, permission, true, observe);
  });
  const head = await logStep(recorder, 'publish', async observe => {
    await requirePending();
    progress('Publishing latest snapshot...');
    const head = await v2Post<SnapshotHead>('snapshots/publish', { collectionId, snapshotId: snapshot.snapshotId,
      expectedRevision: publication.expectedRevision }, permission, true, observe);
    if (head.snapshotId !== snapshot.snapshotId || !/^"[0-9a-f]{32}"$/.test(head.revision)) throw new Error('Invalid latest revision response');
    return head;
  });
  await logStep(recorder, 'finalize', async () => {
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
  });
  // A recovered frozen revision may predate later local edits. Publish a fresh revision
  // before acknowledging the caller's queue, including after a browser restart.
  if (resumedPending && followPending) return publish(options, recorder, false);
  const warning = background ? '' : photoWarning(publication.imageWarnings ?? []);
  progress([`Synced metadata; ${snapshot.assets.length} verified cloud images. Unchanged images were reused.`, warning].filter(Boolean).join(' '));
  if (warning) {
    options.onWarning?.(warning);
    if (options.onWarning || options.onProgress) await acknowledgePhotoNotices(manualNotices);
  }
  return collectionUrl(collectionId);
}
