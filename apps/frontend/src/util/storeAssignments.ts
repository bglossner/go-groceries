import { db } from '../db/db';

export class StoreAssignmentsChangedError extends Error {}

export function saveIngredientStores(ingredientName: string, changes: ReadonlyMap<number, boolean>) {
  return db.transaction('rw', [db.stores, db.ingredientStores, db.meals, db.customIngredients], async () => {
    const storeIds = [...changes.keys()];
    const pairs = storeIds.map(storeId => [ingredientName, storeId]);
    const matchingLinks = () => db.ingredientStores.where('[ingredientName+storeId]').anyOf(pairs);
    const assigned = new Set((await matchingLinks().toArray()).map(link => link.storeId));
    const checkedIds = storeIds.filter(id => changes.get(id));
    if ((await db.stores.bulkGet(checkedIds)).some(store => !store)) {
      throw new StoreAssignmentsChangedError('A selected store no longer exists. Cancel and reopen the picker to review the available stores.');
    }
    const additions = checkedIds.filter(id => !assigned.has(id));

    if (additions.length) {
      const custom = await db.customIngredients.filter(row => row.name.toLowerCase() === ingredientName).first();
      const meal = custom ? undefined : await db.meals.filter(row =>
        row.ingredients.some(ingredient => ingredient.name.toLowerCase() === ingredientName),
      ).first();
      if (!custom && !meal) {
        throw new StoreAssignmentsChangedError('Ingredient no longer exists in the catalog. Cancel and reopen the picker to review its saved stores.');
      }
      await db.ingredientStores.bulkAdd(additions.map(storeId => ({ ingredientName, storeId })));
    }

    await matchingLinks().and(link => changes.get(link.storeId) === false).delete();
    return matchingLinks().toArray();
  });
}

export function addIngredientsToStores(ingredientNames: Iterable<string>, targetStoreIds: Iterable<number>) {
  const names = [...new Set(ingredientNames)];
  const storeIds = [...new Set(targetStoreIds)];
  return db.transaction('rw', [db.stores, db.ingredientStores, db.meals, db.customIngredients], async () => {
    if (!names.length || !storeIds.length) return { links: [], addedCount: 0 };
    if ((await db.stores.bulkGet(storeIds)).some(store => !store)) {
      throw new StoreAssignmentsChangedError('A selected store no longer exists. Cancel and reopen the picker to review the available stores.');
    }

    const missingNames = new Set(names);
    await db.customIngredients.each(row => { missingNames.delete(row.name.toLowerCase()); });
    if (missingNames.size) {
      await db.meals.each(row => {
        row.ingredients.forEach(ingredient => missingNames.delete(ingredient.name.toLowerCase()));
      });
    }
    if (missingNames.size) {
      throw new StoreAssignmentsChangedError('A selected ingredient no longer exists in the catalog. Cancel and select the ingredients again.');
    }

    const pairs = names.flatMap(ingredientName => storeIds.map(storeId => ({ ingredientName, storeId })));
    const pairKey = ({ ingredientName, storeId }: typeof pairs[number]) => JSON.stringify([ingredientName, storeId]);
    const existing = await db.ingredientStores.where('[ingredientName+storeId]')
      .anyOf(pairs.map(({ ingredientName, storeId }) => [ingredientName, storeId])).toArray();
    const assigned = new Set(existing.map(pairKey));
    const additions = pairs.filter(link => !assigned.has(pairKey(link)));
    const ids = additions.length ? await db.ingredientStores.bulkAdd(additions, { allKeys: true }) : [];
    return { links: [...existing, ...additions.map((link, index) => ({ ...link, id: ids[index] }))], addedCount: additions.length };
  });
}
