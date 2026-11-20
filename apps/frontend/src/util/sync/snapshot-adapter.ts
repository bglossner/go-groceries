import { db, MySubClassedDexie, type LocalImageAsset, type Recipe, type PendingRecipe, type Meal } from '../../db/db';
import { addDateConverterHooks } from '../../db/date-converter';
import { hashBlob, isAssetRef, verifyCachedAsset } from '../../db/image-cache';
import { IMAGE_LIMITS, IMAGE_MIME_TYPES, type ImageRef, type ImageMimeType } from '../../shareable/image-assets';
import { SNAPSHOT_TABLES, type Snapshot, type SnapshotRows } from '../../shareable/snapshot';
import { canonicalJson, makeAsset, parseSnapshot } from './snapshot-validation';
import { getMealDiffs } from '../db/import';

const imageRef = (image: unknown): ImageRef => {
  if (isAssetRef(image)) return { kind: 'asset', assetId: image.assetId,
    ...(image.name === undefined ? {} : { name: image.name }),
    ...(image.lastModified === undefined ? {} : { lastModified: image.lastModified }) };
  if (typeof image === 'string') return { kind: 'externalUrl', url: image };
  if (image && typeof image === 'object' && 'type' in image && image.type === 'url' && 'url' in image && typeof image.url === 'string') {
    return { kind: 'externalUrl', url: image.url };
  }
  throw new Error('Unresolved image slot; original images have been retained. Finish image conversion before syncing.');
};

type MetadataRows = { recipes: Recipe[]; pendingRecipes: PendingRecipe[]; meals: Meal[] } & Record<string, unknown[]>;
function normalizedTables(rows: MetadataRows): SnapshotRows {
  const tables = JSON.parse(JSON.stringify(rows)) as SnapshotRows;
    tables.recipes = rows.recipes.map((row: Recipe) => ({ ...row, images: row.images.map(imageRef) })) as SnapshotRows['recipes'];
    tables.pendingRecipes = rows.pendingRecipes.map((row: PendingRecipe) => ({ ...row, createdAt: new Date(row.createdAt).toISOString(), images: row.images?.map(imageRef) })) as SnapshotRows['pendingRecipes'];
    tables.meals = rows.meals.map((row: Meal) => ({ ...row, createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString(),
      images: row.images?.map((image) => ({
        ...(image.type === 'recipeImage' ? { kind: 'recipeImage' as const, recipeId: image.recipeId, imageIndex: image.imageIndex } : imageRef(image)),
        ...(image.isThumbnail === undefined ? {} : { isThumbnail: image.isThumbnail }),
      })),
    })) as SnapshotRows['meals'];
  return tables;
}

export const metadataDigest = async (tables: SnapshotRows) => {
  const ordered = Object.fromEntries(SNAPSHOT_TABLES.map(name => [name, [...tables[name]].sort((a, b) =>
    typeof a.id === 'number' && typeof b.id === 'number' ? a.id - b.id : String(a.id).localeCompare(String(b.id)))]));
  return hashBlob(new Blob([canonicalJson(ordered)]));
};
export async function localMetadataDigest() {
  const tables = await db.transaction('r', SNAPSHOT_TABLES.map(name => db.table(name)), async () => {
    const rows = Object.fromEntries(await Promise.all(SNAPSHOT_TABLES.map(async name => [name, await db.table(name).toArray()])));
    return normalizedTables(rows as MetadataRows);
  });
  return metadataDigest(tables);
}

/** Freeze metadata and bytes in the same read transaction; hashing/network occur afterwards. */
export async function freezeSnapshot(collectionId: string, snapshotId: string) {
  const frozen = await db.transaction('r', [...SNAPSHOT_TABLES.map(name => db.table(name)), db.imageAssets], async () => {
    const rows = Object.fromEntries(await Promise.all(SNAPSHOT_TABLES.map(async name => [name, await db.table(name).toArray()])));
    const tables = normalizedTables(rows as MetadataRows);
    const referenced = new Set<string>();
    for (const row of [...tables.meals, ...tables.recipes, ...tables.pendingRecipes]) {
      for (const image of row.images ?? []) if (image.kind === 'asset') referenced.add(image.assetId);
    }
    const copies = new Map<string, LocalImageAsset>();
    for (const assetId of referenced) {
      const asset = await db.imageAssets.get(assetId);
      if (!asset) throw new Error('An image is not cached. Sync from its source before publishing.');
      copies.set(assetId, asset);
    }
    return { tables, copies };
  });
  const issues: string[] = [];
  for (const asset of frozen.copies.values()) {
    if (!IMAGE_MIME_TYPES.includes(asset.mimeType as ImageMimeType)) issues.push('unsupported image type');
    if (asset.byteLength < 1 || asset.byteLength > IMAGE_LIMITS.byteLength) issues.push('image exceeds the 4 MiB limit or is empty');
    await verifyCachedAsset(asset);
  }
  if (issues.length) throw new Error(`Cloud sync blocked: ${Array.from(new Set(issues)).join('; ')}. Original images are retained; no images were uploaded.`);
  const assets = [...frozen.copies.values()].map(asset => makeAsset(collectionId, {
    sha256: asset.assetId, mimeType: asset.mimeType as ImageMimeType, byteLength: asset.byteLength,
  }));
  const snapshot = parseSnapshot({ format: 'go-groceries-snapshot', version: 2, collectionId, snapshotId, assets,
    data: { schemaVersion: 15, adapterVersion: 1, tables: frozen.tables } });
  return { snapshot, copies: frozen.copies };
}

export function localTables(snapshot: Snapshot) {
  const tables = structuredClone(snapshot.data.tables);
  return {
    ...tables,
    recipes: tables.recipes.map(row => ({ ...row, images: row.images.map(image => image.kind === 'externalUrl' ? image.url : image) })),
    pendingRecipes: tables.pendingRecipes.map(row => ({ ...row, images: row.images?.map(image => image.kind === 'externalUrl' ? { type: 'url', url: image.url } : image) })),
    meals: tables.meals.map(row => ({ ...row, images: row.images?.map(image => {
      const { kind, ...rest } = image;
      return kind === 'externalUrl' ? { ...rest, type: 'url' } : kind === 'recipeImage' ? { ...rest, type: 'recipeImage' } : { ...rest, kind, type: 'asset' };
    }) })),
  };
}

/** Stage every indexed constraint before touching the live database. Cache bytes are optional here. */
export async function stageSnapshot(value: unknown) {
  const snapshot = parseSnapshot(value);
  const temporary = new MySubClassedDexie(true);
  addDateConverterHooks(temporary);
  try {
    const tables = localTables(snapshot);
    await temporary.transaction('rw', SNAPSHOT_TABLES.map(name => temporary.table(name)), async () => {
      for (const name of SNAPSHOT_TABLES) await temporary.table(name).bulkAdd(tables[name]);
    });
    return { snapshot, temporary };
  } catch (error) { await temporary.delete(); throw error; }
}
export async function snapshotDiffs(value: unknown) {
  const { temporary } = await stageSnapshot(value);
  try { return { mealDiffs: await getMealDiffs(db, temporary) }; }
  finally { await temporary.delete(); }
}
