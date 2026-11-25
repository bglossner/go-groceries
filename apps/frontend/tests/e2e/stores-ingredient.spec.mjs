import { expect, test } from '@playwright/test';

const names = ['carrots', 'red-pepper flakes', ...Array.from({ length: 24 }, (_, index) => `ingredient ${index}`)];
const search = page => page.getByRole('searchbox', { name: 'Search ingredients' });
const ingredient = (page, name) => page.getByRole('button', { name });
const save = page => page.getByRole('button', { name: 'Save stores' });
const store = (page, name) => page.getByRole('checkbox', { name, exact: true });

async function readStores(page) {
  return page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    const stores = await db.stores.orderBy('name').toArray();
    const links = await db.ingredientStores.toArray();
    return stores.map(({ id, name, color }) => ({
      name, color, ingredients: links.filter(link => link.storeId === id).map(link => link.ingredientName).sort(),
    }));
  });
}

const readAssignments = async page => (await readStores(page)).map(row => row.ingredients);

async function openIngredient(page, query, matcher) {
  await search(page).fill(query);
  const row = ingredient(page, matcher);
  await row.press('Enter');
  return row;
}

test.beforeEach(async ({ context, page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  await context.route('**/*', route =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  await page.goto('/manage-stores');
  await page.evaluate(async names => {
    const { db } = await import('/src/db/db.ts');
    const fresh = await db.stores.add({ name: 'Fresh Mart', color: '#008000' });
    const corner = await db.stores.add({ name: 'Corner Market', color: '#4682B4' });
    await db.stores.add({ name: 'Green Grocer', color: '#DA70D6' });
    await db.customIngredients.bulkAdd(names.map(name => ({ name })));
    await db.meals.add({
      name: 'Fixture meal', ingredients: [{ name: 'Oat Milk', quantity: 1 }],
      createdAt: new Date(), updatedAt: new Date(),
    });
    await db.ingredientStores.bulkAdd([
      { storeId: corner, ingredientName: 'White Miso' },
      { storeId: fresh, ingredientName: 'carrots' },
    ]);
  }, names);
  await page.reload();
  await expect(search(page)).toBeVisible();
});

test.describe('Ingredient picker on a touch phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('batches a hyphenated ingredient across stores and removes only the unchecked pair', async ({ page }) => {
    await search(page).fill(' RED-PEPPER ');
    const row = ingredient(page, /^Red-Pepper Flakes/);
    await row.tap();
    const sheet = page.getByRole('dialog', { name: 'Red-Pepper Flakes', exact: true });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('checkbox')).toHaveCount(3);
    await expect(sheet.getByRole('checkbox').nth(0)).toHaveAccessibleName('Corner Market');
    await store(page, 'Corner Market').tap();
    await sheet.getByText('Fresh Mart', { exact: true }).tap();
    await expect(store(page, 'Corner Market')).toBeChecked();
    await expect(store(page, 'Fresh Mart')).toBeChecked();
    expect(await readAssignments(page)).toEqual([['White Miso'], ['carrots'], []]);
    await save(page).tap();
    await expect(row).toHaveText(/Corner Market, Fresh Mart/);
    await expect(row).toBeFocused();
    await row.tap();
    await store(page, 'Corner Market').tap();
    await store(page, 'Green Grocer').tap();
    await sheet.getByRole('button', { name: 'Cancel' }).tap();
    await expect(row).toBeFocused();
    await row.tap();
    await expect(store(page, 'Corner Market')).toBeChecked();
    await expect(store(page, 'Green Grocer')).not.toBeChecked();
    await store(page, 'Corner Market').tap();
    await save(page).tap();
    await expect.poll(() => readAssignments(page)).toEqual([['White Miso'], ['carrots', 'red-pepper flakes'], []]);
    await page.reload();
    await search(page).fill('red-pepper');
    await row.tap();
    await expect(store(page, 'Corner Market')).not.toBeChecked();
    await expect(store(page, 'Fresh Mart')).toBeChecked();
  });

  test('a touch scroll stays inside the ingredient directory even with many store names', async ({ page, context }) => {
    await page.evaluate(async () => {
      const { db } = await import('/src/db/db.ts');
      const storeIds = await db.stores.bulkAdd([
        'Central Farmers Market', 'Downtown Neighborhood Grocery', 'Northside Organic Produce Market',
        'West End Supermarket', 'Eastside Community Co-op',
      ].map(name => ({ name })), { allKeys: true });
      const ingredients = ['carrots', 'ingredient 0', 'ingredient 1', 'ingredient 10', 'ingredient 11'];
      await db.ingredientStores.bulkAdd(ingredients.flatMap(ingredientName => storeIds.map(storeId => ({ ingredientName, storeId }))));
    });
    await page.reload();
    const before = await readAssignments(page);
    const region = page.getByRole('region', { name: 'Ingredient directory' });
    const metrics = await region.evaluate(node => ({
      height: node.clientHeight,
      rows: [...node.querySelectorAll('li')].slice(0, 5).map(row => row.offsetHeight),
      total: node.scrollHeight,
    }));
    expect(metrics.height).toBe(metrics.rows.reduce((sum, height) => sum + height, 0));
    expect(metrics.total).toBeGreaterThan(metrics.height);
    const controlTop = (await search(page).boundingBox()).y;
    const box = await region.boundingBox();
    const start = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height - 20) };
    const session = await context.newCDPSession(page);
    try {
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
      for (let step = 1; step <= 7; step++) {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove', touchPoints: [{ x: start.x, y: start.y - step * 18 }],
        });
      }
    } finally {
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await session.detach();
    }
    await expect.poll(() => region.evaluate(node => node.scrollTop)).toBeGreaterThan(50);
    expect((await search(page).boundingBox()).y).toBe(controlTop);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await readAssignments(page)).toEqual(before);
  });
});

test('desktop saves via keyboard and restores focus when the filter removes the row', async ({ page }) => {
  await page.getByRole('button', { name: 'Unassigned' }).press('Enter');
  const row = await openIngredient(page, 'red-pepper', /^Red-Pepper Flakes/);
  const editor = page.getByRole('region', { name: 'Red-Pepper Flakes', exact: true });
  await expect(editor.getByRole('heading')).toBeFocused();
  await store(editor, 'Corner Market').press('Space');
  await store(editor, 'Fresh Mart').press('Space');
  await expect(editor.getByRole('checkbox', { checked: true })).toHaveCount(2);
  await save(editor).press('Enter');
  await expect(row).toHaveCount(0);
  await expect(search(page)).toBeFocused();
  await page.getByRole('button', { name: 'All ingredients' }).press('Enter');
  await expect(row).toHaveText(/Corner Market, Fresh Mart/);
});

test('shows and removes a saved assignment for a missing catalog ingredient', async ({ page }) => {
  const row = await openIngredient(page, 'white miso', /^White Miso/);
  await expect(row).toHaveText(/Saved assignment/);
  await expect(page.getByRole('checkbox')).toHaveCount(1);
  await expect(store(page, 'Corner Market')).toBeChecked();
  await store(page, 'Corner Market').press('Space');
  await save(page).press('Enter');
  await expect(row).toHaveCount(0);
  await expect(search(page)).toBeFocused();
  await expect.poll(() => readAssignments(page)).toEqual([[], ['carrots'], []]);
});

test('can edit stores and create or delete a store offline', async ({ page, context }) => {
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  const row = await openIngredient(page, 'carrots', /^Carrots/);
  await store(page, 'Corner Market').press('Space');
  await save(page).press('Enter');
  await expect(row).toHaveText(/Corner Market, Fresh Mart/);

  const manage = page.getByRole('button', { name: 'Manage stores' });
  const dialog = page.getByRole('dialog');
  await manage.click();
  await dialog.getByRole('textbox', { name: 'Store name' }).fill('  A Market  ');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog.getByText('A Market', { exact: true })).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Color for A Market' }).click();
  await page.getByRole('option', { name: 'Tomato' }).click();
  await expect.poll(async () => (await readStores(page))[0].color).toBe('#FF6347');

  const deleteCorner = dialog.getByRole('button', { name: 'Delete Corner Market' });
  await deleteCorner.click();
  await expect(dialog.getByText('Delete Corner Market and its 2 ingredient assignments?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(deleteCorner).toBeFocused();
  expect((await readStores(page))[1].ingredients).toEqual(['White Miso', 'carrots']);
  await deleteCorner.click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(deleteCorner).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(manage).toBeFocused();
  await expect(row).toHaveText('CarrotsFresh Mart');
  await expect.poll(() => readAssignments(page)).toEqual([[], ['carrots'], []]);
});

test('a failed save preserves the draft and a failed store delete preserves its assignments', async ({ page }) => {
  await openIngredient(page, 'carrots', /^Carrots/);
  await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    db.ingredientStores.hook('creating', (_, link) => {
      if (link.ingredientName === 'carrots') throw new Error('Fixture rejected assignment');
    });
    db.stores.hook('deleting', () => { throw new Error('Fixture rejected store delete'); });
  });
  await store(page, 'Corner Market').press('Space');
  await store(page, 'Fresh Mart').press('Space');
  await save(page).press('Enter');
  await expect(page.getByRole('alert')).toHaveText('Could not save stores for Carrots. Try again.');
  await expect(store(page, 'Corner Market')).toBeChecked();
  await expect(save(page)).toBeFocused();
  expect(await readAssignments(page)).toEqual([['White Miso'], ['carrots'], []]);
  await page.getByRole('button', { name: 'Cancel' }).press('Enter');
  await page.getByRole('button', { name: 'Manage stores' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Delete Corner Market' }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText(/Could not delete the store/);
  expect(await readAssignments(page)).toEqual([['White Miso'], ['carrots'], []]);
});

test.describe('Custom ingredient deletion on a touch phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('cancel preserves the custom ingredient and confirm removes it and its links offline', async ({ page, context }) => {
    const row = ingredient(page, /^Carrots/);
    await search(page).fill('carrots');
    await row.tap();
    const editor = page.getByRole('dialog', { name: 'Carrots', exact: true });
    const deleteAction = editor.getByRole('button', { name: 'Delete ingredient' });
    const confirmation = page.getByRole('dialog', { name: 'Delete Carrots?' });
    await deleteAction.tap();
    await expect(confirmation.getByText('Are you sure? This will be permanently delete the ingredient from the app', { exact: true })).toBeVisible();
    await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await confirmation.getByRole('button', { name: 'Cancel' }).tap();
    await expect(deleteAction).toBeFocused();
    await expect(store(editor, 'Fresh Mart')).toBeChecked();
    expect(await readAssignments(page)).toEqual([['White Miso'], ['carrots'], []]);

    await context.setOffline(true);
    await deleteAction.tap();
    await confirmation.getByRole('button', { name: 'Delete', exact: true }).tap();
    await expect(confirmation).toHaveCount(0);
    await expect(row).toHaveCount(0);
    await expect(search(page)).toBeFocused();
    expect(await readAssignments(page)).toEqual([['White Miso'], [], []]);
    expect(await page.evaluate(async () => {
      const { db } = await import('/src/db/db.ts');
      return db.customIngredients.get({ name: 'carrots' });
    })).toBeUndefined();
  });
});

test('offers no delete action for meal ingredients or saved-assignment-only entries', async ({ page }) => {
  await openIngredient(page, 'oat milk', /^Oat Milk/);
  await expect(page.getByRole('heading', { name: 'Oat Milk' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete ingredient' })).toHaveCount(0);
  await openIngredient(page, 'white miso', /^White Miso/);
  await expect(page.getByRole('heading', { name: 'White Miso' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete ingredient' })).toHaveCount(0);
});

test('protects custom ingredients used by a saved list or meal', async ({ page }) => {
  await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    await db.customIngredients.add({ name: 'oat milk' });
    await db.groceryLists.add({ name: 'Fixture list', meals: [], createdAt: new Date(), customIngredients: [{ name: 'Carrots', exact: true }] });
  });
  await page.reload();
  await openIngredient(page, 'carrots', /^Carrots/);
  await expect(page.getByText('Used in a saved list or meal.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete ingredient' })).toHaveCount(0);
  await openIngredient(page, 'oat milk', /^Oat Milk/);
  await expect(page.getByText('Used in a saved list or meal.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete ingredient' })).toHaveCount(0);
});

test('a disappearing store cannot cause a partial draft save', async ({ page }) => {
  await openIngredient(page, 'red-pepper', /^Red-Pepper Flakes/);
  await store(page, 'Corner Market').press('Space');
  await store(page, 'Green Grocer').press('Space');
  await page.getByRole('button', { name: 'Manage stores' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Delete Green Grocer' }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Delete Green Grocer' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await save(page).press('Enter');
  await expect(page.getByRole('alert')).toHaveText(/A selected store no longer exists/);
  await expect(store(page, 'Corner Market')).toBeChecked();
  expect(await readAssignments(page)).toEqual([['White Miso'], ['carrots']]);
});

test('focus moves to search when a saved assignment disappears after reconciliation', async ({ page }) => {
  await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    const { id } = await db.stores.get({ name: 'Fresh Mart' });
    await db.ingredientStores.add({ ingredientName: 'White Miso', storeId: id });
  });
  await page.reload();
  const row = await openIngredient(page, 'white miso', /^White Miso/);
  await store(page, 'Corner Market').press('Space');
  await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    const { id: storeId } = await db.stores.get({ name: 'Fresh Mart' });
    const { id } = await db.ingredientStores.get({ ingredientName: 'White Miso', storeId });
    await db.ingredientStores.delete(id);
    const read = db.ingredientStores.toArray.bind(db.ingredientStores);
    const held = new Promise(resolve => { window.finishAssignmentRefresh = resolve; });
    db.ingredientStores.toArray = async () => { await held; return read(); };
  });
  await save(page).press('Enter');
  await expect(row).toBeFocused();
  await page.evaluate(() => window.finishAssignmentRefresh());
  await expect(row).toHaveCount(0);
  await expect(search(page)).toBeFocused();
});

test('keeps delete confirmation reachable across the desktop breakpoint', async ({ page }) => {
  await openIngredient(page, 'carrots', /^Carrots/);
  await store(page, 'Corner Market').press('Space');
  await page.getByRole('button', { name: 'Delete ingredient' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete Carrots?', exact: true });
  await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  const sheet = page.getByRole('dialog', { name: 'Carrots', exact: true });
  await expect(sheet.getByRole('button', { name: 'Delete ingredient' })).toBeFocused();
  await expect(store(sheet, 'Corner Market')).toBeChecked();
  expect(await readAssignments(page)).toEqual([['White Miso'], ['carrots'], []]);
});


test('an ingredient that becomes used during confirmation is protected and no longer offers Delete', async ({ page }) => {
  await openIngredient(page, 'carrots', /^Carrots/);
  await page.getByRole('button', { name: 'Delete ingredient' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete Carrots?', exact: true });
  await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    await db.groceryLists.add({ name: 'Fixture list', meals: [], createdAt: new Date(), customIngredients: [{ name: 'Carrots' }] });
  });
  await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(confirmation.getByRole('alert')).toHaveText('This ingredient is still used in a saved grocery list or meal.');
  await confirmation.getByRole('button', { name: 'Cancel' }).click();
  const editor = page.getByRole('region', { name: 'Carrots', exact: true });
  await expect(editor.getByRole('heading')).toBeFocused();
  await expect(editor.getByRole('button', { name: 'Delete ingredient' })).toHaveCount(0);
  await expect(editor.getByText('Used in a saved list or meal.')).toBeVisible();
  expect(await readAssignments(page)).toEqual([['White Miso'], ['carrots'], []]);
});
