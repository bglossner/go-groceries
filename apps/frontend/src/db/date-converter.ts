import type { MySubClassedDexie } from "./db";

const toIsoString = (date: number | string | Date | null | undefined): Date => {
  if (!date) return date as unknown as Date;
  return (new Date(date).toISOString()) as unknown as Date;
}

export const addDateConverterHooks = (db: MySubClassedDexie) => {
  // Reading hooks (convert from ISO string to Date)
  db.meals.hook('reading', (meal) => {
    if (meal.createdAt && !(meal.createdAt instanceof Date)) {
      meal.createdAt = new Date(meal.createdAt);
    }
    if (meal.updatedAt && !(meal.updatedAt instanceof Date)) {
      meal.updatedAt = new Date(meal.updatedAt);
    }
    return meal;
  });

  db.groceryLists.hook('reading', (list) => {
    if (list.createdAt && !(list.createdAt instanceof Date)) {
      list.createdAt = new Date(list.createdAt);
    }
    return list;
  });

  db.pendingRecipes.hook('reading', (recipe) => {
    if (recipe.createdAt && !(recipe.createdAt instanceof Date)) {
      recipe.createdAt = new Date(recipe.createdAt);
    }
    return recipe;
  });

  db.syncs.hook('reading', (sync) => {
    if (sync.createdAt && !(sync.createdAt instanceof Date)) {
      sync.createdAt = new Date(sync.createdAt);
    }
    if (sync.lastSyncedAt && !(sync.lastSyncedAt instanceof Date)) {
      sync.lastSyncedAt = new Date(sync.lastSyncedAt);
    }
    if (sync.expiresAt && !(sync.expiresAt instanceof Date)) {
      sync.expiresAt = new Date(sync.expiresAt);
    }
    return sync;
  });

  // Writing hooks (convert from Date to ISO string)
  db.meals.hook('creating', (_primKey, obj, _transaction) => {
    obj.createdAt = toIsoString(obj.createdAt);
    obj.updatedAt = toIsoString(obj.updatedAt);
  });
  db.meals.hook('updating', (modifications, _primKey, _obj, _transaction) => {
    const mods = modifications as Partial<typeof _obj>;
    if (Object.prototype.hasOwnProperty.call(mods, 'createdAt')) {
      mods.createdAt = toIsoString(mods.createdAt);
    }
    if (Object.prototype.hasOwnProperty.call(mods, 'updatedAt')) {
      mods.updatedAt = toIsoString(mods.updatedAt);
    }
  });

  db.groceryLists.hook('creating', (_primKey, obj, _transaction) => {
    obj.createdAt = toIsoString(obj.createdAt);
  });
  db.groceryLists.hook('updating', (modifications, _primKey, _obj, _transaction) => {
    const mods = modifications as Partial<typeof _obj>;
    if (Object.prototype.hasOwnProperty.call(mods, 'createdAt')) {
      mods.createdAt = toIsoString(mods.createdAt);
    }
  });

  db.pendingRecipes.hook('creating', (_primKey, obj, _transaction) => {
    obj.createdAt = toIsoString(obj.createdAt);
  });
  db.pendingRecipes.hook('updating', (modifications, _primKey, _obj, _transaction) => {
    const mods = modifications as Partial<typeof _obj>;
    if (Object.prototype.hasOwnProperty.call(mods, 'createdAt')) {
      mods.createdAt = toIsoString(mods.createdAt);
    }
  });

  db.syncs.hook('creating', (_primKey, obj, _transaction) => {
    obj.createdAt = toIsoString(obj.createdAt);
    obj.lastSyncedAt = toIsoString(obj.lastSyncedAt);
    obj.expiresAt = toIsoString(obj.expiresAt);
  });
  db.syncs.hook('updating', (modifications, _primKey, _obj, _transaction) => {
    const mods = modifications as Partial<typeof _obj>;
    if (Object.prototype.hasOwnProperty.call(mods, 'createdAt')) {
      mods.createdAt = toIsoString(mods.createdAt);
    }
    if (Object.prototype.hasOwnProperty.call(mods, 'lastSyncedAt')) {
      mods.lastSyncedAt = toIsoString(mods.lastSyncedAt);
    }
    if (Object.prototype.hasOwnProperty.call(mods, 'expiresAt')) {
      mods.expiresAt = toIsoString(mods.expiresAt);
    }
  });
};
