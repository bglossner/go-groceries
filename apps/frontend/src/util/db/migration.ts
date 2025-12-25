import { db } from '../../db/db';

export const forceDateMigration = async () => {
  const toIsoString = <T extends NullableDateLike>(date: T): T extends null | undefined ? undefined : string => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (date === null || date === undefined) return undefined as any;
    // Avoid re-converting if it's already a string
    if (typeof date === 'string') {
      // Basic check if it's already an ISO string
      if (!isNaN(Date.parse(date))) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return new Date(date).toISOString() as any;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return date as any;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new Date(date).toISOString() as any;
  };

  await db.transaction('rw', db.meals, db.groceryLists, db.pendingRecipes, db.syncs, async () => {
    await db.meals.toCollection().modify(meal => {
      meal.createdAt = toIsoString(meal.createdAt) as unknown as Date;
      meal.updatedAt = toIsoString(meal.updatedAt) as unknown as Date;
    });

    await db.groceryLists.toCollection().modify(list => {
      list.createdAt = toIsoString(list.createdAt) as unknown as Date;
    });

    await db.pendingRecipes.toCollection().modify(recipe => {
      recipe.createdAt = toIsoString(recipe.createdAt) as unknown as Date;
    });

    await db.syncs.toCollection().modify(sync => {
      sync.createdAt = toIsoString(sync.createdAt) as unknown as Date;
      sync.lastSyncedAt = toIsoString(sync.lastSyncedAt) as unknown as Date;
      sync.expiresAt = toIsoString(sync.expiresAt) as unknown as Date;
    });
  });
};
