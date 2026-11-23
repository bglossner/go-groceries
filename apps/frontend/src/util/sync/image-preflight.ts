import Dexie from 'dexie';
import { readImageDimensions, sniffImageType } from './image-container';
import { db, type LocalImageAsset } from '../../db/db';
import { hashBlob, verifyCachedAsset } from '../../db/image-cache';
import { IMAGE_LIMITS, type ImageMimeType } from '../../shareable/image-assets';
import { IMAGE_OPTIONS } from '../images';
import type { ObservedImage } from './diagnostic-photos';

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
  catch { return { reason: 'The cached photo failed its integrity check.' } as const; }
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
    for (const format of new Set([mimeType, 'image/webp', 'image/jpeg'])) {
      if (format === 'image/jpeg') {
        context.globalCompositeOperation = 'destination-over';
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, format, 0.9));
      if (!blob || blob.type !== format || blob.size > IMAGE_LIMITS.byteLength) continue;
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
  } finally { canvas.width = canvas.height = 0; }
}

// Version the cache with the format check so earlier rejections can be retried.
export const photoRejectionKey = (collectionId: string, assetId: string) => `sync-image-rejection-v2:${collectionId}:${assetId}`;

export type PreparedPhoto = { assetId: string; mimeType: ImageMimeType; byteLength: number };

export async function preparePhoto(source: LocalImageAsset): Promise<(PreparedPhoto | { reason: string }) & { observed?: ObservedImage }> {
  const photo = await inspectPhoto(source);
  if (photo.reason) return { reason: photo.reason, observed: photo.observed };
  // The local setting is versioned with the sizing/encoding recipe and is excluded from backups.
  const copyKey = `sync-image-copy-v1:${source.assetId}`;
  const saved = photo.oversized && await db.settings.get(copyKey);
  if (saved) {
    const copy = await db.imageAssets.get(saved.value);
    if (copy) {
      const checked = await inspectPhoto(copy);
      if (!checked.reason && !checked.oversized) {
        return { assetId: copy.assetId, mimeType: checked.mimeType, byteLength: copy.byteLength, observed: checked.observed };
      }
    }
  }

  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(photo.blob); }
  catch { return { reason: 'The photo could not be decoded.', observed: photo.observed }; }
  let copy: Awaited<ReturnType<typeof encodeCopy>>;
  try {
    if (!photo.oversized) return { assetId: source.assetId, mimeType: photo.mimeType, byteLength: source.byteLength, observed: photo.observed };
    copy = await encodeCopy(bitmap, photo.mimeType);
  } catch { /* An encoder or canvas failed. */ }
  finally { bitmap.close(); }
  if (!copy) return { reason: 'A cloud copy could not be saved within the image limits.', observed: photo.observed };
  const { blob, observed } = copy;
  const assetId = await hashBlob(blob);
  const now = new Date().toISOString();
  const cached = await db.transaction('rw', db.imageAssets, db.settings, async () => {
    // A content address may already belong to another local photo. Keep its original row.
    const existing = await db.imageAssets.get(assetId);
    if (existing) {
      try { await Dexie.waitFor(verifyCachedAsset(existing)); }
      catch { return false; }
    } else {
      await db.imageAssets.add({ assetId, sha256: assetId, blob, mimeType: blob.type,
        byteLength: blob.size, cachedAt: now, verifiedAt: now });
    }
    await db.settings.put({ id: copyKey, value: assetId });
    return true;
  });
  if (!cached) return { reason: 'The cached cloud copy failed its integrity check.', observed: photo.observed };
  return { assetId, mimeType: blob.type as ImageMimeType, byteLength: blob.size, observed };
}
