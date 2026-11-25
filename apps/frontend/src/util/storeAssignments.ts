import { db, type IngredientStore } from '../db/db';

type Assignment = Omit<IngredientStore, 'id'>;

export type AssignmentChange = Assignment & { id: number; assigned: boolean };

export function setStoreAssignment(
  assignment: Assignment,
  assigned: boolean,
  undo?: AssignmentChange,
) {
  return db.transaction('rw', db.stores, db.ingredientStores, async () => {
    const { ingredientName, storeId } = assignment;
    if (!(await db.stores.get(storeId))) {
      if (undo) return;
      throw new Error('Store no longer exists');
    }

    const existing = await db.ingredientStores.get({ ingredientName, storeId });
    if (assigned) {
      if (existing) return;
      const id = await db.ingredientStores.add({ ingredientName, storeId });
      return { ingredientName, storeId, id, assigned };
    }

    // Undo an addition only while the link created by that edit is still present.
    if (existing?.id === undefined || (undo && existing.id !== undo.id)) return;
    await db.ingredientStores.delete(existing.id);
    return { ingredientName, storeId, id: existing.id, assigned };
  });
}
