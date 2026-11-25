import { expect, test } from 'vitest';
import { db } from '../src/db/db.ts';
import { addIngredientsToStores, saveIngredientStores } from '../src/util/storeAssignments.ts';
import { CustomIngredientInUse, deleteCustomIngredient } from '../src/util/customIngredients.ts';
import { cleanDatabase, meal } from './helpers.mjs';

cleanDatabase();

const name = 'red-pepper flakes';

async function seed() {
  await db.customIngredients.add({ name });
  return db.stores.bulkAdd([
    { name: 'Corner Market' }, { name: 'Fresh Mart' }, { name: 'Green Grocer' },
  ], { allKeys: true });
}

async function assignedStoreIds() {
  return (await db.ingredientStores.toArray()).map(link => link.storeId).sort((a, b) => a - b);
}

test('saves only edited pairs and keeps a second store added while the editor was open', async () => {
  const [corner, fresh, green] = await seed();
  const links = await saveIngredientStores(name, new Map([[corner, true], [fresh, true]]));
  expect(links.map(link => link.storeId)).toEqual([corner, fresh]);
  await db.ingredientStores.add({ ingredientName: name, storeId: green });
  await saveIngredientStores(name, new Map([[corner, false], [fresh, true]]));
  expect(await assignedStoreIds()).toEqual([fresh, green]);
  expect((await db.ingredientStores.toArray()).every(link => link.ingredientName === name)).toBe(true);
});

test('keeps a legacy link and a catalog link with different stored keys separate', async () => {
  const [corner, fresh] = await seed();
  const legacy = 'Red-Pepper Flakes';
  await db.ingredientStores.bulkAdd([
    { ingredientName: legacy, storeId: corner },
    { ingredientName: name, storeId: corner },
    { ingredientName: legacy, storeId: fresh },
  ]);
  await saveIngredientStores(name, new Map([[corner, false]]));
  expect(await db.ingredientStores.toArray()).toMatchObject([
    { ingredientName: legacy, storeId: corner }, { ingredientName: legacy, storeId: fresh },
  ]);
  await saveIngredientStores(legacy, new Map([[corner, false]]));
  expect(await db.ingredientStores.toArray()).toMatchObject([{ ingredientName: legacy, storeId: fresh }]);
});

test('can assign a meal ingredient and remove a saved link once its ingredient leaves the catalog', async () => {
  const [corner, fresh] = await seed();
  await db.meals.add({ ...meal(), ingredients: [{ name: 'Carrot', quantity: 1 }] });
  await saveIngredientStores('carrot', new Map([[corner, true]]));
  await db.meals.clear();
  await expect(saveIngredientStores('carrot', new Map([[fresh, true]]))).rejects.toThrow('Ingredient no longer exists');
  await saveIngredientStores('carrot', new Map([[corner, false]]));
  expect(await assignedStoreIds()).toEqual([]);
});

test('a failed pair mutation rolls back the full batch', async () => {
  const [corner, fresh, green] = await seed();
  await saveIngredientStores(name, new Map([[corner, true]]));
  const reject = (_, link) => { if (link.storeId === green) throw new Error('Fixture rejected one new store'); };
  db.ingredientStores.hook('creating', reject);
  try {
    await expect(saveIngredientStores(name, new Map([[fresh, true], [green, true], [corner, false]])))
      .rejects.toThrow('Fixture rejected one new store');
  } finally {
    db.ingredientStores.hook('creating').unsubscribe(reject);
  }
  expect(await assignedStoreIds()).toEqual([corner]);
});

test('deletes all custom rows and links for a confirmed name and preserves unrelated records', async () => {
  const [corner, fresh, green] = await seed();
  await db.customIngredients.bulkAdd([{ name: 'Red-Pepper Flakes' }, { name: 'carrot' }]);
  await db.ingredientStores.bulkAdd([
    { ingredientName: name, storeId: corner },
    { ingredientName: 'Red-Pepper Flakes', storeId: fresh },
    { ingredientName: 'carrot', storeId: green },
  ]);
  await deleteCustomIngredient(name);
  expect(await db.customIngredients.toArray()).toMatchObject([{ name: 'carrot' }]);
  expect(await db.ingredientStores.toArray()).toMatchObject([{ ingredientName: 'carrot', storeId: green }]);
  await expect(deleteCustomIngredient('carrot-only-in-a-meal')).rejects.toThrow('Custom ingredient no longer exists');
});

test('rechecks names in saved lists and meals before deleting a custom entry', async () => {
  const [corner] = await seed();
  await saveIngredientStores(name, new Map([[corner, true]]));
  const list = await db.groceryLists.add({
    name: 'Fixture list', customIngredients: [{ name: 'Red-Pepper Flakes' }], meals: [], createdAt: new Date(),
  });
  await expect(deleteCustomIngredient(name)).rejects.toBeInstanceOf(CustomIngredientInUse);
  expect(await db.groceryLists.get(list)).toMatchObject({ customIngredients: [{ name: 'Red-Pepper Flakes' }] });
  await db.groceryLists.delete(list);
  const mealId = await db.meals.add({ ...meal(), ingredients: [{ name: 'Red-Pepper Flakes' }] });
  await expect(deleteCustomIngredient(name)).rejects.toBeInstanceOf(CustomIngredientInUse);
  expect(await db.meals.get(mealId)).toMatchObject({ ingredients: [{ name: 'Red-Pepper Flakes' }] });
  expect(await assignedStoreIds()).toEqual([corner]);
  expect(await db.customIngredients.count()).toBe(1);
});

test('rolls back assignment removal if custom catalog deletion fails', async () => {
  const [corner] = await seed();
  await saveIngredientStores(name, new Map([[corner, true]]));
  const reject = () => { throw new Error('Fixture rejected catalog delete'); };
  db.customIngredients.hook('deleting', reject);
  try {
    await expect(deleteCustomIngredient(name)).rejects.toThrow('Fixture rejected catalog delete');
  } finally {
    db.customIngredients.hook('deleting').unsubscribe(reject);
  }
  expect(await assignedStoreIds()).toEqual([corner]);
  expect(await db.customIngredients.count()).toBe(1);
});

test('bulk add is idempotent and preserves existing and unticked pairs', async () => {
  const [corner, fresh, green] = await seed();
  const carrot = 'carrot';
  await db.meals.add({ ...meal(), ingredients: [{ name: 'Carrot', quantity: 1 }] });
  const originals = [
    { ingredientName: name, storeId: corner },
    { ingredientName: carrot, storeId: green },
    { ingredientName: 'Red-Pepper Flakes', storeId: fresh },
  ];
  const ids = await db.ingredientStores.bulkAdd(originals, { allKeys: true });
  const names = [name, carrot, name];
  const stores = [corner, fresh, fresh];
  const first = await addIngredientsToStores(names, stores);
  expect(first.addedCount).toBe(3);
  expect(first.links).toEqual(expect.arrayContaining([
    { ...originals[0], id: ids[0] },
    expect.objectContaining({ ingredientName: name, storeId: fresh }),
    expect.objectContaining({ ingredientName: carrot, storeId: corner }),
    expect.objectContaining({ ingredientName: carrot, storeId: fresh }),
  ]));
  const after = await db.ingredientStores.toArray();
  expect(after).toHaveLength(6);
  expect(await db.ingredientStores.bulkGet(ids)).toEqual(originals.map((link, index) => ({ ...link, id: ids[index] })));
  expect((await addIngredientsToStores(names, stores)).addedCount).toBe(0);
  expect(await db.ingredientStores.toArray()).toEqual(after);
});

test('bulk add uses one transaction and rolls back every new pair when a write fails', async () => {
  const [corner, fresh, green] = await seed();
  const carrot = 'carrot';
  await db.customIngredients.add({ name: carrot });
  const original = { ingredientName: name, storeId: corner };
  const id = await db.ingredientStores.add(original);
  const transactions = new Set();
  let accepted = 0;
  function collideWithExistingKey(_, link, transaction) {
    transactions.add(transaction);
    if (link.ingredientName === carrot && link.storeId === green) return id;
    this.onsuccess = () => { accepted++; };
  }
  db.ingredientStores.hook('creating', collideWithExistingKey);
  try {
    await expect(addIngredientsToStores([name, carrot], [fresh, green])).rejects.toThrow('ConstraintError');
  } finally {
    db.ingredientStores.hook('creating').unsubscribe(collideWithExistingKey);
  }
  expect(transactions.size).toBe(1);
  expect(accepted).toBe(3);
  expect(await db.ingredientStores.toArray()).toEqual([{ ...original, id }]);
});

test('bulk add validates live stores and exact catalog assignment keys before writing', async () => {
  const [corner, fresh] = await seed();
  await db.stores.delete(fresh);
  await expect(addIngredientsToStores([name], [corner, fresh])).rejects.toThrow('A selected store no longer exists');
  await expect(addIngredientsToStores([name, 'Red-Pepper Flakes'], [corner])).rejects.toThrow('A selected ingredient no longer exists');
  expect(await db.ingredientStores.count()).toBe(0);
});
