import Dexie from 'dexie';
import { db } from '../../db/db';
import { hashBlob, verifyCachedAsset } from '../../db/image-cache';
import { IMAGE_LIMITS, type ImageAsset, type ImageDownloadResponse } from '../../shareable/image-assets';
import type { Snapshot } from '../../shareable/snapshot';
import { canonicalJson } from './snapshot-validation';
import { v2Post, type ReadPermission } from './api';
import type { SyncProgress } from '../sync';

async function imageBlob(response: Response, asset: ImageAsset) {
  if (!response.body) throw new Error('Empty image response');
  if (response.headers.get('Content-Type')?.split(';')[0] !== asset.mimeType) throw new Error('Downloaded image type mismatch');
  const reader = response.body.getReader(); const chunks: Uint8Array<ArrayBuffer>[] = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.length; if (length > asset.byteLength) throw new Error('Downloaded image exceeds expected size');
      chunks.push(new Uint8Array(value));
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const blob = new Blob(chunks, { type: asset.mimeType });
  if (blob.size !== asset.byteLength || await hashBlob(blob) !== asset.assetId) throw new Error('Downloaded image SHA-256 mismatch');
  return blob;
}
export async function hydrateSnapshot(snapshot: Snapshot, permission: ReadPermission, onProgress?: SyncProgress) {
  let cached = 0; const missing: ImageAsset[] = [];
  for (const asset of snapshot.assets) {
    const local = await db.imageAssets.get(asset.assetId);
    try {
      if (!local || local.mimeType !== asset.mimeType || local.byteLength !== asset.byteLength) throw new Error('Missing image');
      await verifyCachedAsset(local); cached++;
    } catch { missing.push(asset); }
  }
  const failures: string[] = [];
  const sign = (assets: ImageAsset[]) => v2Post<ImageDownloadResponse>('images/download', {
    collectionId: snapshot.collectionId, snapshotId: snapshot.snapshotId, assetIds: assets.map(asset => asset.assetId),
  }, permission);
  for (let start = 0; start < missing.length; start += IMAGE_LIMITS.batch) {
    const batch = missing.slice(start, start + IMAGE_LIMITS.batch);
    let downloads: ImageDownloadResponse;
    try { downloads = await sign(batch); }
    catch (error) { failures.push(error instanceof Error ? error.message : 'Image authorization failed'); continue; }
    for (const asset of batch) {
      try {
        let transfer = downloads.images?.find(image => image.asset.assetId === asset.assetId);
        let downloaded: Blob | undefined;
        // Only renew temporary GET authorization; recipient capability failure stops at the API.
        for (let attempt = 0; attempt < 3; attempt++) {
          if (!transfer || canonicalJson(transfer.asset) !== canonicalJson(asset)) throw new Error('Cloud image descriptor mismatch');
          if (!Number.isFinite(Date.parse(transfer.expiresAt))) throw new Error('Invalid image transfer expiry');
          if (Date.parse(transfer.expiresAt) > Date.now()) {
            let response: Response;
            try { response = await fetch(transfer.url, { cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30000) }); }
            catch { throw new Error('Image download interrupted'); }
            if (response.ok) { downloaded = await imageBlob(response, asset); break; }
            if (![401, 403].includes(response.status)) throw new Error('Image download failed');
          }
          if (attempt < 2) transfer = (await sign([asset])).images[0];
        }
        if (!downloaded) throw new Error('Image links repeatedly expired. Retry sync.');
        const blob = downloaded; const now = new Date().toISOString();
        await db.transaction('rw', db.imageAssets, db.imageUploadJobs, async () => {
          await db.imageAssets.put({ assetId: asset.assetId, sha256: asset.sha256, blob,
            mimeType: asset.mimeType, byteLength: asset.byteLength, cachedAt: now, verifiedAt: now });
          await Dexie.waitFor(verifyCachedAsset((await db.imageAssets.get(asset.assetId))!));
          if (!await db.imageUploadJobs.get(asset.assetId)) await db.imageUploadJobs.put({ assetId: asset.assetId, createdAt: now });
        });
        cached++;
      } catch (error) { failures.push(error instanceof Error ? error.message : 'Image cache unavailable'); }
      onProgress?.(`Metadata imported; ${cached}/${snapshot.assets.length} images available offline...`);
    }
  }
  return { cached, total: snapshot.assets.length, failures };
}
export function hydrationMessage(result: { cached: number; total: number; failures: string[] }) {
  return result.cached === result.total ? `Sync complete. ${result.cached}/${result.total} owned images available offline. External URLs need a connection.` :
    `Metadata imported; ${result.cached}/${result.total} images available offline. Missing images show placeholders. Retry Sync DB. ${result.failures[0] ?? ''}`;
}
