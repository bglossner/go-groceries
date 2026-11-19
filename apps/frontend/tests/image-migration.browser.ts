// Run /tests/image-migration.html on a local frontend Vite server.
// All writes use temporary database names; the application database is never changed.
import Dexie from 'dexie';
import { MySubClassedDexie, type Meal, type MealImage, type Recipe } from '../src/db/db';
import { runImageMigration } from '../src/db/image-cache';
import { mealThumbnail } from '../src/db/meal-images';

const output = document.querySelector('#result')!;
const lines: string[] = [];
const check = (name: string, passed: boolean) => {
  lines.push(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  output.textContent = lines.join('\n');
  if (!passed) throw new Error(name);
};
const date = new Date('2020-01-01T00:00:00.000Z');
const descriptor = (recipeId: number, imageIndex = 0): MealImage =>
  ({ type: 'recipeImage', recipeId, imageIndex, isThumbnail: true });
const meal = (id: number, recipeId = id, imageIndex = 0): Meal =>
  ({ id, name: 'Synthetic control', ingredients: [], createdAt: date, updatedAt: date, images: [descriptor(recipeId, imageIndex)] });
const recipe = (id: number, mealId: number): Recipe =>
  ({ id, mealId, images: ['https://example.invalid/synthetic.png'], url: '', notes: '' });
const database = new MySubClassedDexie(true);

// Pause immediately before the real write transaction, allowing a second connection's
// edit to commit after migration read its source row. No migration internals are mocked.
const editBeforeCommit = (edit: () => Promise<unknown>) => {
  const original = database.transaction.bind(database);
  let done = false;
  // Dexie's transaction has variadic overloads; preserve them for the test barrier.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  database.transaction = (async (...args: any[]) => {
    if (!done && args[0] === 'rw' && args.slice(1).flat().some(table => table?.name === 'meals') &&
        args.slice(1).flat().some(table => table?.name === 'imageMigrationJobs') &&
        args.slice(1).flat().some(table => table?.name === 'imageAssets')) {
      done = true;
      await edit();
    }
    return original(...args as Parameters<typeof original>);
  }) as typeof database.transaction;
  return () => { database.transaction = original; };
};

try {
  await database.open();
  const meals = [meal(10), meal(11), meal(12), meal(13), meal(14, 777), meal(15, 15, 4),
    meal(16, 107), meal(17, 17, 0.5), meal(18, 108)];
  const recipes = [recipe(100, 10), recipe(101, 11), recipe(11, 999), recipe(103, 13), recipe(104, 13),
    recipe(105, 14), recipe(777, 999), recipe(106, 15), recipe(107, 16), recipe(110, 17),
    recipe(108, 18), recipe(109, 18), { ...recipe(200, 999), images: ['data:text/plain,private-content', 'blob:private-token'] }];
  await database.meals.bulkPut(meals);
  await database.recipes.bulkPut(recipes);
  await database.pendingRecipes.put({ id: 'synthetic-pending', sourceUrl: '', createdAt: date,
    images: [{ type: 'base64', base64: '%%%private-content' }] });
  await database.imageMigrationJobs.bulkPut(meals.map(m => ({ id: `meals:${m.id}`,
    issues: ['slot 0: ambiguous recipe image reference'], updatedAt: date.toISOString() })));
  await database.imageMigrationJobs.put({ id: 'scan', tableIndex: 3, issues: [], updatedAt: date.toISOString() });
  check('Read path resolves only the unique legacy owner', !!mealThumbnail(meals[0], recipes) &&
    !mealThumbnail(meals[3], recipes) && !mealThumbnail(meals[5], recipes));
  const migrated = await runImageMigration(database);
  const repaired = (await database.meals.get(10))!;
  check('Previously blocked meal repaired behind terminal checkpoint',
    repaired.images![0].type === 'recipeImage' && repaired.images![0].recipeId === 100 &&
    !await database.imageMigrationJobs.get('meals:10'));
  const collision = (await database.meals.get(11))!.images![0];
  check('Sentinel collision never attaches a foreign recipe', collision.type === 'recipeImage' && collision.recipeId === 101);
  for (const [id, code] of [[12, 'no_owning_recipe'], [13, 'multiple_owning_recipes'],
    [14, 'recipe_id_meal_id_mismatch'], [15, 'image_index_out_of_range'], [17, 'image_index_out_of_range'],
    [18, 'multiple_owning_recipes']] as const) {
    check(`Ambiguous control ${code} retained unchanged`,
      JSON.stringify((await database.meals.get(id))!.images) === JSON.stringify(meals.find(m => m.id === id)!.images) &&
      (await database.imageMigrationJobs.get(`meals:${id}`))!.issues.includes(`slot 0: ${code}`));
  }
  check('Explicit correct reference unchanged', JSON.stringify((await database.meals.get(16))!.images) === JSON.stringify(meals[6].images));
  check('Conversion failures have safe fixed categories',
    JSON.stringify((await database.imageMigrationJobs.get('recipes:200'))!.issues) ===
      JSON.stringify(['slot 0: conversion_failed:invalid_inline_image', 'slot 1: conversion_failed:temporary_image_url']) &&
    (await database.imageMigrationJobs.get('pendingRecipes:synthetic-pending'))!.issues[0] === 'slot 0: conversion_failed:invalid_base64' &&
    !JSON.stringify(await database.imageMigrationJobs.toArray()).includes('private'));
  check('Repeated migration is idempotent', (await runImageMigration(database)).converted === 0 && migrated.converted === 2);

  await database.meals.clear(); await database.recipes.clear(); await database.pendingRecipes.clear(); await database.imageMigrationJobs.clear();
  await database.meals.put(meal(20)); await database.recipes.put(recipe(120, 20));
  const peer = new Dexie(database.name); await peer.open();
  let restore = editBeforeCommit(() => peer.table('meals').update(20, { images: [descriptor(999, 0)] }));
  try { await runImageMigration(database); } finally { restore(); }
  lines.push('RACE STATE ' + JSON.stringify({ images: (await database.meals.get(20))!.images, issues: (await database.imageMigrationJobs.get('meals:20'))?.issues }));
  check('Concurrent meal edit survives fingerprint guard',
    JSON.stringify((await database.meals.get(20))!.images) === JSON.stringify([descriptor(999)]) &&
    (await database.imageMigrationJobs.get('meals:20'))!.issues[0] === 'row_changed_retry');
  await database.meals.put(meal(20)); await database.imageMigrationJobs.clear();
  restore = editBeforeCommit(() => peer.table('recipes').put(recipe(121, 20)));
  try { await runImageMigration(database); } finally { restore(); }
  check('Concurrent new owner prevents repair inside transaction',
    JSON.stringify((await database.meals.get(20))!.images) === JSON.stringify([descriptor(20)]) &&
    (await database.imageMigrationJobs.get('meals:20'))!.issues[0] === 'slot 0: multiple_owning_recipes');
  peer.close();
  await database.recipes.delete(121); await database.imageMigrationJobs.clear();
  await database.meals.put(meal(21)); await database.recipes.put(recipe(122, 21));
  await database.meals.put({ ...meal(19), images: undefined });
  await database.meals.put({ ...meal(17), images: 'synthetic malformed' as unknown as Meal['images'] });
  await database.imageMigrationJobs.bulkPut([17, 18, 19, 20, 21].map(id => ({ id: `meals:${id}`,
    issues: ['slot 0: ambiguous recipe image reference'], updatedAt: date.toISOString() })));
  await database.imageMigrationJobs.put({ id: 'scan', tableIndex: 3, issues: [], updatedAt: date.toISOString() });
  let attempts = 0;
  while ((await runImageMigration(database, { maxRows: 1 })).interrupted && attempts++ < 10) { /* resume */ }
  check('Bounded scans with multiple legacy blocked jobs finish and remove checkpoint', attempts < 10 && !await database.imageMigrationJobs.get('scan') &&
    !await database.imageMigrationJobs.get('meals:20') && !await database.imageMigrationJobs.get('meals:21'));
  check('Deleted meal and removed-image legacy jobs retire without starving repair',
    !await database.imageMigrationJobs.get('meals:18') && !await database.imageMigrationJobs.get('meals:19'));
  check('Malformed image list is retained and reclassified without restarting forever',
    ((await database.meals.get(17))!.images as unknown) === 'synthetic malformed' &&
    (await database.imageMigrationJobs.get('meals:17'))!.issues[0] === 'invalid_image_list');
  lines.push('LANE EXIT: 0'); document.title = 'Image migration regression PASSED';
} catch (error) {
  lines.push('ERROR ' + String(error), 'LANE EXIT: 1'); document.title = 'Image migration regression FAILED';
} finally {
  await database.delete(); output.textContent = lines.join('\n');
}
