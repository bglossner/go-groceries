import { db, MySubClassedDexie, type LocalImageAsset, type Recipe, type PendingRecipe, type Meal } from '../../db/db';
import { addDateConverterHooks } from '../../db/date-converter';
import { hashBlob, isAssetRef } from '../../db/image-cache';
import type { ImageRef } from '../../shareable/image-assets';
import { SNAPSHOT_TABLES, type Snapshot, type SnapshotRows } from '../../shareable/snapshot';
import { canonicalJson, makeAsset, parseSnapshot } from './snapshot-validation';
import { getDiffOfDbs } from '../db/import';
import { photoRejectionKey, preparePhoto, type PreparedPhoto } from './image-preflight';
import { photoOwner, photoOwners, updatePhotoReferences } from './snapshot-photos';
import { diagnosticImage, photoAttribution, type ObservedImage } from './diagnostic-photos';
import { safely, type SyncRecorder } from './diagnostics';

type FreezeDiagnostics = { recorder: SyncRecorder; pass: string; observed: Map<string, ObservedImage> };

const imageRef = (image: unknown, owner: string): ImageRef => {
  if (isAssetRef(image)) return { kind: 'asset', assetId: image.assetId,
    ...(image.name === undefined ? {} : { name: image.name }),
    ...(image.lastModified === undefined ? {} : { lastModified: image.lastModified }) };
  if (typeof image === 'string') return { kind: 'externalUrl', url: image };
  if (image && typeof image === 'object' && 'type' in image && image.type === 'url' && 'url' in image && typeof image.url === 'string') {
    return { kind: 'externalUrl', url: image.url };
  }
  throw new Error(`A photo for ${owner} could not be read from its legacy image slot. Finish image recovery before syncing.`);
};

type MetadataRows = { recipes: Recipe[]; pendingRecipes: PendingRecipe[]; meals: Meal[] } & Record<string, unknown[]>;
function normalizedTables(rows: MetadataRows): SnapshotRows {
  const tables = JSON.parse(JSON.stringify(rows)) as SnapshotRows;
  const meals = new Map(rows.meals.map(meal => [meal.id, meal.name]));
  const pendingMeals = new Map(rows.meals.filter(meal => meal.pendingRecipeId).map(meal => [meal.pendingRecipeId, meal.name]));
  tables.recipes = rows.recipes.map((row: Recipe) => ({ ...row, images: row.images.map(image => imageRef(image, photoOwner('recipe', meals.get(row.mealId)))) })) as SnapshotRows['recipes'];
  tables.pendingRecipes = rows.pendingRecipes.map((row: PendingRecipe) => ({ ...row, createdAt: new Date(row.createdAt).toISOString(), images: row.images?.map(image => imageRef(image, photoOwner('draft recipe', pendingMeals.get(row.id)))) })) as SnapshotRows['pendingRecipes'];
  tables.meals = rows.meals.map((row: Meal) => ({ ...row, createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString(),
      images: row.images?.map((image) => ({
        ...(image.type === 'recipeImage' ? { kind: 'recipeImage' as const, recipeId: image.recipeId, imageIndex: image.imageIndex } : imageRef(image, photoOwner('meal', row.name))),
        ...(image.isThumbnail === undefined ? {} : { isThumbnail: image.isThumbnail }),
      })),
    })) as SnapshotRows['meals'];
  return tables;
}

export const metadataDigest = async (tables: Snapshot['data']['tables']) => {
  const ordered = Object.fromEntries(SNAPSHOT_TABLES.map(name => [name, [...(tables[name as keyof typeof tables] ?? [])].sort((a, b) =>
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
export async function freezeSnapshot(collectionId: string, snapshotId: string, diagnostics?: FreezeDiagnostics) {
  const frozen = await db.transaction('r', [...SNAPSHOT_TABLES.map(name => db.table(name)), db.imageAssets], async () => {
    const rows = Object.fromEntries(await Promise.all(SNAPSHOT_TABLES.map(async name => [name, await db.table(name).toArray()])));
    const tables = normalizedTables(rows as MetadataRows);
    const data = { schemaVersion: 16, adapterVersion: 2, tables } as const;
    const owners = photoOwners(data);
    const copies = new Map<string, LocalImageAsset>();
    for (const [assetId, names] of owners) {
      const asset = await db.imageAssets.get(assetId);
      if (!asset) throw new Error(`A photo for ${[...names].join(', ')} is missing from this device. Sync from its source before publishing.`);
      copies.set(assetId, asset);
    }
    return { data, copies, owners };
  });
  const attribution = safely(() => diagnostics && photoAttribution(frozen.data, diagnostics.pass));
  const photos = new Map<string, PreparedPhoto>();
  const warnings = new Set<string>();
  let index = 0;
  for (const [assetId, source] of frozen.copies) {
    index++;
    const names = [...frozen.owners.get(assetId)!].join(', ');
    try {
      const photo = await preparePhoto(source);
      const reason = 'reason' in photo ? photo.reason : await db.settings.get(photoRejectionKey(collectionId, photo.assetId))
        ? 'Cloud storage rejected its container or dimensions.' : undefined;
      if (reason) {
        warnings.add(`Photo skipped for ${names}. ${reason}`);
        safely(() => diagnostics?.recorder.warning('skipped', {
          reason, image: diagnosticImage(index, frozen.copies.size, 'assetId' in photo ? photo : source,
            attribution?.get(assetId), photo.observed),
        }));
      } else if ('assetId' in photo) {
        photos.set(assetId, photo);
        safely(() => { if (photo.observed) diagnostics?.observed.set(photo.assetId, photo.observed); });
      }
    } catch {
      throw new Error(`A cloud photo for ${names} could not be prepared in local storage. Retry sync.`);
    }
  }
  updatePhotoReferences(frozen.data.tables, photos);
  const unique = new Map([...photos.values()].map(photo => [photo.assetId, photo]));
  const assets = [...unique.values()].map(({ assetId, mimeType, byteLength }) =>
    makeAsset(collectionId, { sha256: assetId, mimeType, byteLength }));
  const snapshot = parseSnapshot({ format: 'go-groceries-snapshot', version: 2, collectionId, snapshotId, assets, data: frozen.data });
  return { snapshot, warnings: [...warnings] };
}

export function localTables(snapshot: Snapshot) {
  const tables = {restaurants:[],restaurantTags:[],restaurantItems:[],people:[],restaurantItemRatings:[],...structuredClone(snapshot.data.tables)} as SnapshotRows;
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
  try { return await getDiffOfDbs(db, temporary); }
  finally { await temporary.delete(); }
}
