import Dexie from 'dexie';
import { importInto, peakImportFile } from 'dexie-export-import';
import { z } from 'zod';
import { db, INCLUDE_TABLES, MySubClassedDexie, type Meal } from '../../db/db';
import { getReferencedAssetIds, isAssetRef, runImageMigration, verifyCachedAsset } from '../../db/image-cache';

const id = z.number().int().positive();
const date = z.union([z.date(), z.string(), z.number()]).refine(value => Number.isFinite(new Date(value).getTime()));
const ingredient = z.object({ name: z.string(), quantity: z.number().optional() });
const assetRef = z.object({ kind: z.literal('asset'), assetId: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().optional(), lastModified: z.number().finite().optional() });
const recipeImage = z.union([assetRef, z.instanceof(Blob), z.string()]);
const pendingImage = z.union([assetRef,
  z.object({ type: z.literal('url'), url: z.string() }),
  z.object({ type: z.literal('file'), file: z.instanceof(Blob) }),
  z.object({ type: z.literal('blob'), blob: z.instanceof(Blob) }),
  z.object({ type: z.literal('base64'), base64: z.string() }),
]);
const mealImage = z.union([
  assetRef.extend({ type: z.literal('asset'), isThumbnail: z.boolean().optional() }),
  z.object({ type: z.literal('url'), url: z.string(), isThumbnail: z.boolean().optional() }),
  z.object({ type: z.literal('file'), file: z.instanceof(Blob), isThumbnail: z.boolean().optional() }),
  z.object({ type: z.literal('recipeImage'), recipeId: id, imageIndex: z.number().int().nonnegative(), isThumbnail: z.boolean().optional() }),
]);
const rowSchemas: Record<string, z.ZodType> = {
  meals: z.object({ id, name: z.string(), ingredients: z.array(ingredient), tags: z.array(id).optional(),
    recipe: z.string().optional(), pendingRecipeId: z.string().optional(), createdAt: date, updatedAt: date, images: z.array(mealImage).optional() }),
  recipes: z.object({ id, mealId: id, images: z.array(recipeImage), url: z.string(), notes: z.string() }),
  pendingRecipes: z.object({ id: z.string(), content: z.string().optional(), sourceUrl: z.string(), createdAt: date, images: z.array(pendingImage).optional() }),
  groceryLists: z.object({ id, name: z.string(), meals: z.array(id), customIngredients: z.array(ingredient).optional(), createdAt: date }),
  groceryListStates: z.object({ id, groceryListId: id, checkedIngredients: z.array(z.string()) }),
  tags: z.object({ id, name: z.string() }),
  customIngredients: z.object({ id, name: z.string(), usageCount: z.number().optional() }),
  stores: z.object({ id, name: z.string(), color: z.string().optional() }),
  ingredientStores: z.object({ id, ingredientName: z.string(), storeId: id }),
  imageAssets: z.object({ assetId: z.string().regex(/^[a-f0-9]{64}$/), sha256: z.string(), blob: z.instanceof(Blob),
    mimeType: z.string(), byteLength: z.number().int().nonnegative(), cachedAt: date, verifiedAt: date }),
};

export const validatePortableDatabase = async (database: MySubClassedDexie): Promise<void> => {
  for (const tableName of INCLUDE_TABLES) {
    for (const row of await database.table(tableName).toArray()) {
      if (!rowSchemas[tableName].safeParse(row).success) throw new Error(`Invalid backup row in ${tableName}`);
    }
  }
  // Keep only external hashing work inside waitFor. Wrapping database reads as well
  // loses their transaction context and can deadlock behind a queued migration write.
  for (const asset of await database.imageAssets.toArray()) await Dexie.waitFor(verifyCachedAsset(asset));
  for (const tableName of ['meals', 'recipes', 'pendingRecipes']) {
    for (const row of await database.table(tableName).toArray()) {
      for (const image of row.images ?? []) {
        const url = typeof image === 'string' ? image : image?.type === 'url' ? image.url : undefined;
        if (typeof url === 'string' && /^blob:/i.test(url)) throw new Error('Backup contains an unrecoverable temporary image URL');
        if (isAssetRef(image) && !await database.imageAssets.get(image.assetId)) {
          throw new Error('Backup is missing image bytes');
        }
      }
    }
  }
};

export const getTemporaryDB = async (file: Blob): Promise<MySubClassedDexie> => {
  const metadata = await peakImportFile(file);
  if (metadata.formatName !== 'dexie' || metadata.formatVersion !== 1 ||
      ![12, 14, 15].includes(metadata.data.databaseVersion)) throw new Error('Unsupported backup version');
  const tempDB = new MySubClassedDexie(true);
  try {
    const expected = metadata.data.databaseVersion === 15 ? INCLUDE_TABLES : INCLUDE_TABLES.filter(name => name !== 'imageAssets');
    if (expected.some(name => !metadata.data.tables.some(table => table.name === name))) throw new Error('Incomplete backup tables');
    const seenIds = new Map<string, Set<unknown>>();
    await importInto(tempDB, file, {
      filter: table => INCLUDE_TABLES.includes(table),
      transform: (table, value, key) => {
        if (!rowSchemas[table].safeParse(value).success) throw new Error(`Invalid backup row in ${table}`);
        const rowId = table === 'imageAssets' ? value.assetId : value.id;
        const seen = seenIds.get(table) ?? new Set<unknown>();
        if (seen.has(rowId)) throw new Error(`Duplicate backup ID in ${table}`);
        seen.add(rowId); seenIds.set(table, seen);
        return { value, key };
      },
      acceptMissingTables: true,
      acceptVersionDiff: true, acceptNameDiff: true, clearTablesBeforeImport: true,
    });
    await validatePortableDatabase(tempDB);
    await runImageMigration(tempDB);
    await validatePortableDatabase(tempDB);
    for (const assetId of await getReferencedAssetIds(tempDB)) {
      const asset = (await tempDB.imageAssets.get(assetId))!;
      await tempDB.imageUploadJobs.put({ assetId, createdAt: asset.cachedAt });
    }
    return tempDB;
  } catch (error) {
    await tempDB.delete();
    throw error;
  }
};

// The source and target stores participate in one IndexedDB transaction: any error rolls back.
export const handleFileImport = async (file: Blob): Promise<void> => {
  const temporary = await getTemporaryDB(file);
  try {
    const stagedRows = new Map(await Promise.all(INCLUDE_TABLES.map(async name => [name, await temporary.table(name).toArray()] as const)));
    const migrationJobs = await temporary.imageMigrationJobs.toArray();
    const uploadJobs = await temporary.imageUploadJobs.toArray();
    const tables = INCLUDE_TABLES.map(name => db.table(name));
    await db.transaction('rw', [...tables, db.imageMigrationJobs, db.imageUploadJobs], async () => {
      for (const name of INCLUDE_TABLES) {
        const rows = stagedRows.get(name)!;
        // Keep verified cached copies from prior snapshots; never GC on replacement.
        if (name !== 'imageAssets') await db.table(name).clear();
        await db.table(name).bulkPut(rows);
      }
      await db.imageMigrationJobs.clear();
      await db.imageMigrationJobs.bulkPut(migrationJobs);
      for (const job of uploadJobs) {
        const previous = await db.imageUploadJobs.get(job.assetId);
        await db.imageUploadJobs.put({ ...previous, ...job, collections: previous?.collections });
      }
    });
  } finally { await temporary.delete(); }
};

export const getMealDiffs = async (oldDb: MySubClassedDexie, newDb: MySubClassedDexie): Promise<{ toAdd: Meal[], toRemove: Meal[] }> => {
  const oldDbMeals = await oldDb.meals.toArray();
  const newDbMeals = await newDb.meals.toArray();

  const oldMealNames = new Set(oldDbMeals.map(meal => meal.name));
  const newMealNames = new Set(newDbMeals.map(meal => meal.name));

  const toAdd: Meal[] = [];
  const toRemove: Meal[] = [];

  // Meals in newDb that are not in oldDb (added)
  for (const newMeal of newDbMeals) {
    if (!oldMealNames.has(newMeal.name)) {
      toAdd.push(newMeal);
    }
  }

  // Meals in oldDb that are not in newDb (removed)
  for (const oldMeal of oldDbMeals) {
    if (!newMealNames.has(oldMeal.name)) {
      toRemove.push(oldMeal);
    }
  }

  return { toAdd, toRemove };
};

export const getDiffOfDbs = async (oldDb: MySubClassedDexie, newDb: MySubClassedDexie) => {
  return {
    mealDiffs: await getMealDiffs(oldDb, newDb),
  };
};

export type DiffsResult = Awaited<ReturnType<typeof getDiffsFromNewImport>>;

export const getDiffsFromNewImport = async (file: Blob) => {
  const newDb = await getTemporaryDB(file);
  const oldDb = db;
  const diffs = await getDiffOfDbs(oldDb, newDb);
  newDb.close({
    disableAutoOpen: true,
  });
  await newDb.delete({
    disableAutoOpen: true,
  });

  return diffs;
}
