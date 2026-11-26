import Dexie from 'dexie';
import { db, type MySubClassedDexie, type RecipeImage, type PendingImage, type MealImage, type LocalImageAsset } from './db';
import { resolveMealRecipeImage } from './meal-images';
import type { ImageRef } from '../shareable/image-assets';

export type AssetRef = Extract<ImageRef, { kind: 'asset' }>;
export const isAssetRef = (image: unknown): image is AssetRef =>
  !!image && typeof image === 'object' && 'kind' in image && image.kind === 'asset';
export const hashBlob = async (blob: Blob): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
};
export class InvalidCachedImageError extends Error {}

export const verifyCachedAsset = async (asset: LocalImageAsset): Promise<void> => {
  if (!(asset.blob instanceof Blob) || !/^[a-f0-9]{64}$/.test(asset.assetId) ||
      asset.sha256 !== asset.assetId || asset.byteLength !== asset.blob.size ||
      asset.mimeType !== asset.blob.type || await hashBlob(asset.blob) !== asset.assetId) {
    throw new InvalidCachedImageError('Invalid cached image bytes');
  }
};

// No network, compression or legacy size rejection: migration must preserve exact bytes.
export const cacheImage = async (blob: Blob, database = db): Promise<AssetRef> => {
  const assetId = await hashBlob(blob);
  const existing = await database.imageAssets.get(assetId);
  if (existing) {
    await verifyCachedAsset(existing);
  } else {
    const now = new Date().toISOString();
    await database.imageAssets.put({
      assetId, sha256: assetId, blob: new Blob([blob], { type: blob.type }),
      mimeType: blob.type, byteLength: blob.size, cachedAt: now, verifiedAt: now,
    });
    // Read back the stored copy before any caller replaces its original.
    await verifyCachedAsset((await database.imageAssets.get(assetId))!);
  }
  await database.transaction('rw', database.imageUploadJobs, async () => {
    if (!await database.imageUploadJobs.get(assetId)) {
      await database.imageUploadJobs.put({ assetId, createdAt: existing?.cachedAt ?? new Date().toISOString() });
    }
  });
  return { kind: 'asset', assetId, ...(blob instanceof File ? { name: blob.name, lastModified: blob.lastModified } : {}) };
};

export const decodeDataImage = async (value: string): Promise<Blob> => {
  if (!/^data:image\//i.test(value)) throw new Error('Invalid inline image');
  // Native data-URL parsing preserves percent-encoded bytes and raw UTF-8 text.
  // This cannot make a network request: only the data:image/ scheme is accepted.
  const response = await fetch(value);
  return response.blob();
};
const decodeBase64Image = async (value: string): Promise<Blob> => {
  if (/^data:/i.test(value)) return decodeDataImage(value);
  // Legacy generation accepted bare base64 with no declared MIME type.
  return new Blob([Uint8Array.from(atob(value), char => char.charCodeAt(0))]);
};

export const normalizeRecipeImage = async (image: RecipeImage | PendingImage, database = db): Promise<RecipeImage> => {
  if (isAssetRef(image)) return image;
  if (image instanceof Blob) return cacheImage(image, database);
  if (typeof image === 'string') {
    if (/^data:/i.test(image)) return cacheImage(await decodeDataImage(image), database);
    if (/^blob:/i.test(image)) throw new Error('Unrecoverable temporary image URL');
    return image;
  }
  if (image.type === 'url') return normalizeRecipeImage(image.url, database);
  if (image.type === 'file') return cacheImage(image.file, database);
  if (image.type === 'blob') return cacheImage(image.blob, database);
  return cacheImage(await decodeBase64Image(image.base64), database);
};
export const normalizeRecipeImages = async (images: (RecipeImage | PendingImage)[] | undefined, database = db): Promise<RecipeImage[]> =>
  Promise.all((images ?? []).map(image => normalizeRecipeImage(image, database)));
export const normalizePendingImages = async (images: PendingImage[] | undefined, database = db): Promise<PendingImage[]> =>
  (await normalizeRecipeImages(images, database)).map(image => typeof image === 'string' ? { type: 'url', url: image } : image as AssetRef);

export const normalizeMealImage = async (image: MealImage, database = db): Promise<MealImage> => {
  if (image.type === 'recipeImage' || image.type === 'asset') return image;
  const result = await normalizeRecipeImage(image.type === 'file' ? image.file : image.url, database);
  return typeof result === 'string' ? { ...image, type: 'url', url: result } :
    { ...(result as AssetRef), type: 'asset', isThumbnail: image.isThumbnail };
};

// Compare complete slot values, including bytes, so an edit during hashing cannot be overwritten.
const fingerprint = async (value: unknown): Promise<string> => {
  if (value instanceof Blob) return JSON.stringify({ hash: await hashBlob(value), type: value.type,
    ...(value instanceof File ? { name: value.name, lastModified: value.lastModified } : {}) });
  if (Array.isArray(value)) return JSON.stringify(await Promise.all(value.map(fingerprint)));
  if (value && typeof value === 'object') return JSON.stringify(await Promise.all(
    Object.entries(value).map(async ([key, item]) => [key, await fingerprint(item)])));
  return JSON.stringify(value);
};

// Store fixed categories only: error messages can contain private URLs or filenames.
const conversionFailureCode = (error: unknown): string => {
  if (!(error instanceof Error)) return 'unknown';
  if (error.name === 'QuotaExceededError') return 'storage_quota_exceeded';
  if (error.name === 'InvalidCharacterError') return 'invalid_base64';
  if (error.message === 'Invalid inline image') return 'invalid_inline_image';
  if (error.message === 'Unrecoverable temporary image URL') return 'temporary_image_url';
  if (error.message === 'Invalid cached image bytes') return 'invalid_cached_asset';
  if (error.name === 'TypeError') return 'invalid_image_data';
  return 'unknown';
};

const activeMigrations = new WeakMap<MySubClassedDexie, Promise<MigrationResult>>();
export type MigrationResult = { rows: number; converted: number; blocked: number; interrupted: boolean };
export const runImageMigration = (database = db, options: { maxRows?: number; signal?: AbortSignal } = {}): Promise<MigrationResult> => {
  const active = activeMigrations.get(database);
  if (active) return active;
  const work = migrate(database, options).finally(() => activeMigrations.delete(database));
  activeMigrations.set(database, work);
  return work;
};
async function migrate(database: MySubClassedDexie, options: { maxRows?: number; signal?: AbortSignal }): Promise<MigrationResult> {
  const result: MigrationResult = { rows: 0, converted: 0, blocked: 0, interrupted: false };
  const savedScan = await database.imageMigrationJobs.get('scan');
  let scan = savedScan;
  // Retire obsolete legacy diagnostics under the same store locks used by meal edits.
  // Restart only for live blocked rows already passed, so bounded scans keep progressing.
  const revisit = await database.transaction('rw', database.meals, database.imageMigrationJobs, async () => {
    const legacyJobs = await database.imageMigrationJobs.filter(job => job.id.startsWith('meals:') &&
      job.issues.some(issue => /^slot \d+: ambiguous recipe image reference$/.test(issue))).toArray();
    let passedLiveRow = false;
    for (const job of legacyJobs) {
      const mealId = Number(job.id.slice(6));
      const meal = await database.meals.get(mealId);
      if (!meal || meal.images === undefined) await database.imageMigrationJobs.delete(job.id);
      else if (!Array.isArray(meal.images)) await database.imageMigrationJobs.put({
        ...job, issues: ['invalid_image_list'], updatedAt: new Date().toISOString(),
      });
      else if (savedScan && ((savedScan.tableIndex ?? 0) > 0 ||
          (typeof savedScan.cursor === 'number' && mealId <= savedScan.cursor))) passedLiveRow = true;
    }
    return passedLiveRow;
  });
  if (revisit) scan = undefined;
  const checkpoint = async (tableIndex: number, cursor?: number | string) => database.imageMigrationJobs.put({
    id: 'scan', tableIndex, cursor, issues: [], updatedAt: new Date().toISOString(),
  });
  await checkpoint(scan?.tableIndex ?? 0, scan?.cursor);
  const tableNames = ['meals', 'recipes', 'pendingRecipes'] as const;
  for (const [tableIndex, tableName] of tableNames.entries()) {
    if (tableIndex < (scan?.tableIndex ?? 0)) continue;
    const table = database.table(tableName);
    let cursor: number | string | undefined = tableIndex === scan?.tableIndex ? scan.cursor : undefined;
    while (true) {
      const batch = await (cursor === undefined ? table.orderBy(':id') : table.where(':id').above(cursor)).limit(16).toArray();
      if (!batch.length) break;
      for (const row of batch) {
        cursor = row.id;
        if (options.signal?.aborted || result.rows >= (options.maxRows ?? Infinity)) {
          result.interrupted = true; return result;
        }
        result.rows++;
        if (!Array.isArray(row.images)) {
          await database.transaction('rw', table, database.imageMigrationJobs, async () => {
            const current = await table.get(row.id);
            const id = `${tableName}:${row.id}`;
            if (!current || current.images === undefined) await database.imageMigrationJobs.delete(id);
            else {
              result.blocked++;
              await database.imageMigrationJobs.put({ id, issues: [Array.isArray(current.images) ? 'row_changed_retry' : 'invalid_image_list'],
                updatedAt: new Date().toISOString() });
            }
            await checkpoint(tableIndex, row.id);
          });
          continue;
        }
        const before = await fingerprint(row.images);
        const issues: string[] = [];
        const images: (RecipeImage | MealImage | PendingImage)[] = [];
        const newAssetIds = new Set<string>();
        for (const [index, image] of row.images.entries()) {
          try {
            // Resolve recipe references only after re-reading ownership in the write transaction.
            if (tableName === 'meals') images.push(await normalizeMealImage(image, database));
            else if (tableName === 'pendingRecipes') images.push((await normalizePendingImages([image], database))[0]);
            else images.push(await normalizeRecipeImage(image, database));
            const normalized = images[images.length - 1];
            if (!isAssetRef(image) && isAssetRef(normalized)) newAssetIds.add(normalized.assetId);
          } catch (error) {
            images.push(image); issues.push(`slot ${index}: conversion_failed:${conversionFailureCode(error)}`);
          }
        }
        await database.transaction('rw', table, database.recipes, database.imageAssets, database.imageMigrationJobs, async () => {
          const current = await table.get(row.id);
          if (!current) { await database.imageMigrationJobs.delete(`${tableName}:${row.id}`); await checkpoint(tableIndex, row.id); return; }
          if (await Dexie.waitFor(fingerprint(current.images)) !== before) {
            await database.imageMigrationJobs.put({ id: `${tableName}:${row.id}`, issues: ['row_changed_retry'], updatedAt: new Date().toISOString() });
            await checkpoint(tableIndex, row.id); return;
          }
          if (tableName === 'meals') {
            const owned = await database.recipes.where('mealId').equals(row.id).toArray();
            for (const [index, image] of images.entries()) {
              if (!image || typeof image !== 'object' || image instanceof Blob || !('type' in image) || image.type !== 'recipeImage') continue;
              const resolved = resolveMealRecipeImage(row.id, image, owned);
              if (resolved.status === 'blocked') issues.push(`slot ${index}: ${resolved.issue}`);
              else if (image.recipeId === row.id && image.recipeId !== resolved.recipe.id) {
                images[index] = { ...image, recipeId: resolved.recipe.id! };
              }
            }
          }
          const changed = before !== await Dexie.waitFor(fingerprint(images));
          // Verify the cache in the same transaction as replacing the source slot.
          for (const image of images) {
            if (isAssetRef(image) && newAssetIds.has(image.assetId)) {
              const asset = await database.imageAssets.get(image.assetId);
              if (!asset) throw new Error('Missing verified image copy');
              await Dexie.waitFor(verifyCachedAsset(asset));
            }
          }
          if (changed) { await table.update(row.id, { images }); result.converted++; }
          const id = `${tableName}:${row.id}`;
          if (issues.length) { result.blocked++; await database.imageMigrationJobs.put({ id, issues, updatedAt: new Date().toISOString() }); }
          else await database.imageMigrationJobs.delete(id);
          await checkpoint(tableIndex, row.id);
        });
      }
    }
    await checkpoint(tableIndex + 1);
  }
  await database.imageMigrationJobs.delete('scan');
  return result;
}

// Metadata reachability is authoritative; the upload inventory may also retain historical jobs.
export const getReferencedAssetIds = async (database = db): Promise<Set<string>> => {
  const ids = new Set<string>();
  for (const name of ['meals', 'recipes', 'pendingRecipes', 'restaurantItems', 'restaurants']) {
    for (const row of await database.table(name).toArray()) {
      for (const image of (name === 'restaurants' ? row.menuImages : row.images) ?? []) if (isAssetRef(image)) ids.add(image.assetId);
    }
  }
  return ids;
};
