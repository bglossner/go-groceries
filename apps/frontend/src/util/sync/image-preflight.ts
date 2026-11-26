import Dexie from 'dexie';
import { z } from 'zod';
import { readImageDimensions, sniffImageType } from './image-container';
import { db, type LocalImageAsset } from '../../db/db';
import { hashBlob, InvalidCachedImageError, verifyCachedAsset } from '../../db/image-cache';
import { IMAGE_LIMITS, type ImageMimeType } from '../../shareable/image-assets';
import { IMAGE_OPTIONS } from '../images';
import type { ObservedImage } from './diagnostic-photos';
import { approvedSkipReason } from './diagnostics-model';

const workerRejectionReason = 'Cloud storage rejected its container or dimensions.';

// Bound the source allocation separately from the maximum size of the cloud copy.
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 64 * 1024 * 1024;
const MAX_SOURCE_EDGE = 16384;

function fitsCloud(width: number, height: number, size: number) {
  return width <= IMAGE_LIMITS.dimension && height <= IMAGE_LIMITS.dimension &&
    width * height <= IMAGE_LIMITS.pixels && size <= IMAGE_LIMITS.byteLength;
}

async function inspectPhoto(source: LocalImageAsset) {
  if (!(source.blob instanceof Blob)) return { reason: 'The cached photo is invalid.' } as const;
  if (source.blob.size > MAX_SOURCE_BYTES) return { reason: 'The photo is too large to process safely.' } as const;
  try { await verifyCachedAsset(source); }
  catch (error) {
    if (!(error instanceof InvalidCachedImageError)) throw error;
    return { reason: 'The cached photo failed its integrity check.' } as const;
  }
  const bytes = new Uint8Array(await source.blob.arrayBuffer());
  const mimeType = sniffImageType(bytes);
  if (!mimeType) return { reason: 'Only JPEG, PNG and WebP photos can sync.' } as const;
  try {
    const { width, height } = readImageDimensions(bytes, mimeType);
    if (width > MAX_SOURCE_EDGE || height > MAX_SOURCE_EDGE || width * height > MAX_SOURCE_PIXELS) {
      return { reason: 'The photo is too large to process safely.', observed: { detected: mimeType, width, height } } as const;
    }
    return {
      blob: source.mimeType === mimeType ? source.blob : source.blob.slice(0, source.blob.size, mimeType),
      mimeType,
      observed: { detected: mimeType, width, height },
      oversized: !fitsCloud(width, height, source.byteLength),
    };
  } catch { return { reason: 'The photo container is invalid or unsupported.', observed: { detected: mimeType } } as const; }
}

/** Old pending snapshots describe the bytes and label that the Worker would receive. */
export async function pendingPhotoIsObsolete(source: LocalImageAsset, expected: { mimeType: string; byteLength: number }) {
  const photo = await inspectPhoto(source);
  if (photo.reason || photo.oversized || photo.mimeType !== expected.mimeType || photo.blob.size !== expected.byteLength) return true;
  try { (await createImageBitmap(photo.blob)).close(); return false; }
  catch { return true; }
}

async function encodeCopy(bitmap: ImageBitmap, mimeType: ImageMimeType) {
  const scale = Math.min(1, IMAGE_OPTIONS.maxWidthOrHeight / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  try {
    const context = canvas.getContext('2d');
    if (!context) return;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let exceededLimit = false;
    let uncertain = false;
    for (const format of new Set([mimeType, 'image/webp', 'image/jpeg'])) {
      if (format === 'image/jpeg') {
        context.globalCompositeOperation = 'destination-over';
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, format, 0.9));
      if (!blob) { uncertain = true; continue; }
      // Canvas can return PNG when the requested encoder is unsupported.
      if (blob.type !== format) continue;
      if (blob.size > IMAGE_LIMITS.byteLength) { exceededLimit = true; continue; }
      uncertain = true;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const actual = sniffImageType(bytes);
      if (actual !== format) continue;
      try {
        const { width, height } = readImageDimensions(bytes, actual);
        if (width === canvas.width && height === canvas.height && fitsCloud(width, height, blob.size)) {
          return { blob, observed: { detected: actual, width, height } };
        }
      } catch { /* Try the next encoder if its container cannot be verified. */ }
    }
    return { exceededLimit: exceededLimit && !uncertain };
  } finally { canvas.width = canvas.height = 0; }
}

// Version the cache with the format check so earlier rejections can be retried.
export const photoRejectionKey = (collectionId: string, assetId: string) => `sync-image-rejection-v2:${collectionId}:${assetId}`;

export type PreparedPhoto = { assetId: string; mimeType: ImageMimeType; byteLength: number };

type PhotoFailure = {
  reason: string;
  remember?: boolean;
  rejectedAssetId?: string;
  reportedByWorker?: boolean;
  copy?: { asset: LocalImageAsset; mapping?: string };
};
type PhotoPreparation = (PreparedPhoto | PhotoFailure) & { observed?: ObservedImage };
type PhotoDescriptor = Pick<LocalImageAsset, 'mimeType' | 'byteLength'>;
export type PhotoNotice = { id: string; value: string; announced: string };
type SyncPhoto = (PreparedPhoto | { reason: string; notice?: PhotoNotice; descriptor?: PhotoDescriptor }) &
  { observed?: ObservedImage };

const photoCopyKey = (assetId: string) => `sync-image-copy-v1:${assetId}`;
const assetIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
const reasonSchema = z.string().refine(reason => !!approvedSkipReason(reason));
const sourceIdsSchema = z.array(assetIdSchema);
const savedProblemSchema = z.object({
  fingerprint: z.string(),
  reason: reasonSchema,
  omit: z.boolean(),
  reportedReasons: z.array(reasonSchema),
  observed: z.object({ detected: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional(),
    width: z.number().optional(), height: z.number().optional() }).optional(),
  rejectedAssetId: assetIdSchema.optional(),
  copy: z.object({ assetId: assetIdSchema, fingerprint: z.string(), mapping: z.string().optional(),
    mimeType: z.string(), byteLength: z.number() }).optional(),
});
type SavedProblem = z.infer<typeof savedProblemSchema>;

async function failureFingerprint(source: LocalImageAsset) {
  const { blob } = source;
  if (!(blob instanceof Blob)) return 'invalid-blob';
  if (blob.size > MAX_SOURCE_BYTES) return JSON.stringify(['above-source-byte-limit', blob.size, source.cachedAt]);
  // A cache repair may replace bytes under the original content address.
  return JSON.stringify([await hashBlob(blob), source.sha256, source.byteLength, source.mimeType, blob.type]);
}

function savedProblem(value: string | undefined) {
  if (!value) return;
  try {
    const checked = savedProblemSchema.safeParse(JSON.parse(value));
    if (checked.success) return checked.data;
  } catch { /* Ignore unreadable local settings. */ }
}

async function matchesDependencies(sourceId: string, problem: SavedProblem, collectionId: string) {
  if (problem.rejectedAssetId && !await db.settings.get(photoRejectionKey(collectionId, problem.rejectedAssetId))) {
    return false;
  }
  if (!problem.copy) return true;
  if ((await db.settings.get(photoCopyKey(sourceId)))?.value !== problem.copy.mapping) return false;
  const asset = await db.imageAssets.get(problem.copy.assetId);
  return asset !== undefined && await failureFingerprint(asset) === problem.copy.fingerprint;
}

function skipped(id: string, problem: SavedProblem, value: string): SyncPhoto {
  const { reason, observed, reportedReasons, copy } = problem;
  const notice = reportedReasons.includes(reason) ? undefined : { id, value,
    announced: JSON.stringify({ ...problem, reportedReasons: [...reportedReasons, reason] }) };
  return { reason, observed, notice, descriptor: problem.rejectedAssetId ? copy : undefined };
}

function workerRejectionWasReported(value: string, sourceId: string, rejectedId: string) {
  // Old records confirm rejected bytes, but only identify the uploaded asset.
  if (value === 'true') return sourceId === rejectedId;
  try {
    const ids = sourceIdsSchema.safeParse(JSON.parse(value));
    return ids.success && ids.data.includes(sourceId);
  } catch { return false; }
}

// Warning delivery is independent of whether local preflight can safely skip work.
export async function acknowledgePhotoNotices(notices: PhotoNotice[]) {
  if (!notices.length) return;
  // If this receipt cannot be saved, a notification may repeat on a later run.
  await db.transaction('rw', db.settings, async () => {
    for (const { id, value, announced } of notices) {
      if ((await db.settings.get(id))?.value === value) await db.settings.put({ id, value: announced });
    }
  }).catch(() => undefined);
}

export async function prepareSyncPhoto(source: LocalImageAsset, collectionId: string): Promise<SyncPhoto> {
  const key = `sync-image-problem-v1:${collectionId}:${source.assetId}`;
  const value = (await db.settings.get(key))?.value;
  const saved = savedProblem(value);
  const fingerprint = saved && await failureFingerprint(source);
  const samePhoto = saved && fingerprint === saved.fingerprint;
  if (samePhoto && saved.omit && await matchesDependencies(source.assetId, saved, collectionId)) {
    return skipped(key, saved, value!);
  }

  const photo = await preparePhoto(source, collectionId);
  const reportedReasons = samePhoto ? saved.reportedReasons : [];
  if (!('reason' in photo)) {
    if (samePhoto && reportedReasons.length) {
      // Keep warning history for the same bytes, even when the current issue recovers.
      if (saved.omit) await db.settings.put({ id: key, value: JSON.stringify({
        fingerprint, reason: saved.reason, omit: false, reportedReasons,
      }) });
    } else if (value !== undefined) await db.settings.delete(key);
    return photo;
  }
  if (photo.reportedByWorker && !reportedReasons.includes(photo.reason)) reportedReasons.push(photo.reason);

  const copy = photo.copy && { assetId: photo.copy.asset.assetId, mapping: photo.copy.mapping,
    fingerprint: await failureFingerprint(photo.copy.asset), mimeType: photo.observed?.detected ?? photo.copy.asset.mimeType,
    byteLength: photo.copy.asset.byteLength };
  const problem: SavedProblem = {
    fingerprint: fingerprint ?? await failureFingerprint(source),
    reason: photo.reason, observed: photo.observed, omit: !!photo.remember,
    reportedReasons,
    rejectedAssetId: photo.rejectedAssetId, copy,
  };
  const updated = JSON.stringify(problem);
  if (updated !== value) await db.settings.put({ id: key, value: updated });
  return skipped(key, problem, updated);
}

export async function preparePhoto(source: LocalImageAsset, collectionId?: string): Promise<PhotoPreparation> {
  const photo = await inspectPhoto(source);
  if (photo.reason) return { reason: photo.reason, observed: photo.observed, remember: true };
  const rejected = async (asset: LocalImageAsset, observed: ObservedImage): Promise<PhotoPreparation | undefined> => {
    const marker = collectionId && await db.settings.get(photoRejectionKey(collectionId, asset.assetId));
    if (!marker) return;
    return { reason: workerRejectionReason, observed, rejectedAssetId: asset.assetId, remember: true,
      reportedByWorker: workerRejectionWasReported(marker.value, source.assetId, asset.assetId),
      copy: asset.assetId === source.assetId ? undefined : { asset, mapping: asset.assetId } };
  };
  if (!photo.oversized) {
    const known = await rejected(source, photo.observed);
    if (known) return known;
  }
  // The local setting is versioned with the sizing/encoding recipe and is excluded from backups.
  const copyKey = photoCopyKey(source.assetId);
  const saved = photo.oversized ? await db.settings.get(copyKey) : undefined;
  if (saved) {
    const copy = await db.imageAssets.get(saved.value);
    if (copy) {
      const checked = await inspectPhoto(copy);
      if (!checked.reason && !checked.oversized) {
        return await rejected(copy, checked.observed) ??
          { assetId: copy.assetId, mimeType: checked.mimeType, byteLength: copy.byteLength, observed: checked.observed };
      }
    }
  }

  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(photo.blob); }
  // The decoder can reject readable images when the browser is under resource pressure.
  catch { return { reason: 'The photo could not be decoded.', observed: photo.observed }; }
  let copy: Awaited<ReturnType<typeof encodeCopy>>;
  try {
    if (!photo.oversized) return { assetId: source.assetId, mimeType: photo.mimeType, byteLength: source.byteLength, observed: photo.observed };
    copy = await encodeCopy(bitmap, photo.mimeType);
  } catch { /* An encoder or canvas failed. */ }
  finally { bitmap.close(); }
  if (!copy || 'exceededLimit' in copy) {
    return { reason: 'A cloud copy could not be saved within the image limits.', observed: photo.observed,
      remember: copy?.exceededLimit };
  }
  const { blob, observed } = copy;
  const assetId = await hashBlob(blob);
  const now = new Date().toISOString();
  const cached = await db.transaction('rw', db.imageAssets, db.settings, async () => {
    // A content address may already belong to another local photo. Keep its original row.
    let asset = await db.imageAssets.get(assetId);
    if (asset) {
      try { await Dexie.waitFor(verifyCachedAsset(asset)); }
      catch (error) {
        if (!(error instanceof InvalidCachedImageError)) throw error;
        return { asset, valid: false };
      }
    } else {
      asset = { assetId, sha256: assetId, blob, mimeType: blob.type, byteLength: blob.size, cachedAt: now, verifiedAt: now };
      await db.imageAssets.add(asset);
    }
    await db.settings.put({ id: copyKey, value: assetId });
    return { asset, valid: true };
  });
  if (!cached.valid) {
    return { reason: 'The cached cloud copy failed its integrity check.', observed: photo.observed,
      remember: true, copy: { asset: cached.asset, mapping: saved?.value } };
  }
  return await rejected(cached.asset, observed) ?? { assetId, mimeType: blob.type as ImageMimeType, byteLength: blob.size, observed };
}
