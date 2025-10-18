import { importDB, importInto } from "dexie-export-import";
import { db, INCLUDE_TABLES, MySubClassedDexie, type Meal } from "../../db/db";
import type { StaticImportOptions } from "dexie-export-import/dist/import";

const deleteDbData = async () => {
  const tables = [db.groceryLists, db.meals, db.groceryListStates, db.recipes, db.tags, db.customIngredients, db.pendingRecipes, db.stores, db.ingredientStores];
  for (const table of tables) {
    await table.clear();
  }
};

const IMPORT_DB_FILTER = ((table, _value, _key) => {
  return INCLUDE_TABLES.includes(table);
}) satisfies StaticImportOptions['filter'];

export const handleFileImport = async (file: Blob): Promise<void> => {
  await deleteDbData();
  await importDB(file, {
    noTransaction: true,
    filter: IMPORT_DB_FILTER,
  });
};

export const getTemporaryDB = async (file: Blob): Promise<MySubClassedDexie> => {
  const tempDB = new MySubClassedDexie(true);
  await importInto(tempDB, file, {
    filter: IMPORT_DB_FILTER,
    acceptMissingTables: true,
    acceptVersionDiff: true,
    acceptNameDiff: true,
    acceptChangedPrimaryKey: true,
    clearTablesBeforeImport: true,
  });

  return tempDB;
}

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
