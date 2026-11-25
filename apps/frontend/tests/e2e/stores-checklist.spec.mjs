import { expect, test } from '@playwright/test';

const ingredients = ['carrots', 'red-pepper flakes', ...Array.from({ length: 24 }, (_, index) => `ingredient ${index}`)];

async function readStores(page) {
  return page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    const stores = await db.stores.orderBy('name').toArray();
    const assignments = await db.ingredientStores.toArray();
    return stores.map(({ id, name, color }) => ({
      name, color, ingredients: assignments.filter(link => link.storeId === id)
        .map(link => link.ingredientName).sort(),
    }));
  });
}

async function selectStore(page, name) {
  await page.getByRole('combobox', { name: 'Store', exact: true }).tap();
  await page.getByRole('option', { name, exact: true }).tap();
}

test.beforeEach(async ({ context, page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  await context.route('**/*', route =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  await context.routeWebSocket('**/*', socket => socket.close());
  await page.goto('/manage-stores');
  await page.evaluate(async names => {
    const { db } = await import('/src/db/db.ts');
    const fresh = await db.stores.add({ name: 'Fresh Mart', color: '#008000' });
    const corner = await db.stores.add({ name: 'Corner Market', color: '#4682B4' });
    await db.customIngredients.bulkAdd(names.map(name => ({ name })));
    await db.ingredientStores.bulkAdd([
      { storeId: corner, ingredientName: 'white miso' },
      { storeId: fresh, ingredientName: 'carrots' },
    ]);
  }, ingredients);
  await page.reload();
  await expect(page.getByRole('searchbox', { name: 'Search ingredients' })).toBeVisible();
});

test.describe('Stores checklist on a touch phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('adds a hyphenated name at two stores, removes one link, and undoes that edit', async ({ page }) => {
    const storePicker = page.getByRole('combobox', { name: 'Store', exact: true });
    const search = page.getByRole('searchbox', { name: 'Search ingredients' });
    const corner = page.getByRole('checkbox', { name: 'Red-Pepper Flakes at Corner Market' });
    const fresh = page.getByRole('checkbox', { name: 'Red-Pepper Flakes at Fresh Mart' });
    await expect(storePicker).toHaveText('Corner Market');
    await search.fill('RED-PEPPER');
    await expect(page.getByRole('checkbox')).toHaveCount(1);
    await page.getByText('Red-Pepper Flakes', { exact: true }).tap();
    await expect(corner).toBeChecked();
    await expect(page.getByRole('status')).toHaveText(/Added to Corner Market/);

    await selectStore(page, 'Fresh Mart');
    await expect(search).toHaveValue('RED-PEPPER');
    await expect(fresh).not.toBeChecked();
    await fresh.tap();
    await expect(fresh).toBeChecked();

    await selectStore(page, 'Corner Market');
    await corner.tap();
    await expect(corner).not.toBeChecked();
    await expect.poll(async () => (await readStores(page)).map(store => store.ingredients))
      .toEqual([['white miso'], ['carrots', 'red-pepper flakes']]);

    await selectStore(page, 'Fresh Mart');
    await page.getByRole('button', { name: 'Undo' }).tap();
    await expect(page.getByRole('status')).toHaveText(/Change undone/);
    await expect.poll(async () => (await readStores(page)).map(store => store.ingredients))
      .toEqual([['red-pepper flakes', 'white miso'], ['carrots', 'red-pepper flakes']]);
    await page.reload();
    await search.fill('red-pepper');
    await expect(corner).toBeChecked();
  });

  test('a swipe scrolls about five visible rows inside the pane without moving the store or editing a link', async ({ page, context }) => {
    const region = page.getByRole('region', { name: 'Ingredient checklist' });
    const storePicker = page.getByRole('combobox', { name: 'Store', exact: true });
    const manage = page.getByRole('button', { name: 'Manage stores' });
    const search = page.getByRole('searchbox', { name: 'Search ingredients' });
    const before = await Promise.all([storePicker, manage, search].map(control => control.boundingBox()));
    const metrics = await region.evaluate(node => ({
      height: node.clientHeight, row: node.querySelector('li').offsetHeight, total: node.scrollHeight,
    }));
    expect(metrics.height / metrics.row).toBeGreaterThanOrEqual(4.9);
    expect(metrics.height / metrics.row).toBeLessThanOrEqual(5.1);
    expect(metrics.total).toBeGreaterThan(metrics.height);

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
    expect(await Promise.all([storePicker, manage, search].map(control => control.boundingBox()))).toEqual(before);
    expect((await readStores(page)).map(store => store.ingredients)).toEqual([['white miso'], ['carrots']]);
  });

  test('manages store names and colors, then confirms deletion of the selected store and its links', async ({ page }) => {
    const manage = page.getByRole('button', { name: 'Manage stores' });
    const dialog = page.getByRole('dialog');
    await manage.tap();
    await dialog.getByRole('textbox', { name: 'Store name' }).fill('  Z Market  ');
    await dialog.getByRole('button', { name: 'Add' }).tap();
    await expect(dialog.getByText('Z Market', { exact: true })).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Color for Z Market' }).tap();
    await page.getByRole('option', { name: 'Orchid' }).tap();
    await expect.poll(async () => (await readStores(page)).at(-1).color).toBe('#DA70D6');

    await dialog.getByRole('button', { name: 'Delete Corner Market' }).tap();
    await expect(dialog.getByText('Delete Corner Market and its 1 ingredient assignment?')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).tap();
    expect((await readStores(page))[0].ingredients).toEqual(['white miso']);
    await dialog.getByRole('button', { name: 'Delete Corner Market' }).tap();
    await dialog.getByRole('button', { name: 'Delete', exact: true }).tap();
    await expect(dialog.getByText('Corner Market', { exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Done' }).tap();
    await expect(page.getByRole('combobox', { name: 'Store', exact: true })).toHaveText('Fresh Mart');
    const state = await page.evaluate(async () => {
      const { db } = await import('/src/db/db.ts');
      return (await db.ingredientStores.toArray()).map(row => row.ingredientName);
    });
    expect(state).toEqual(['carrots']);
  });
});

test('Stores checklist desktop caps the list and keeps keyboard focus after removing a saved assignment', async ({ page }) => {
  const sidebar = page.getByRole('complementary', { name: 'Stores' });
  await expect(sidebar.getByRole('button', { name: 'Corner Market 1' })).toHaveAttribute('aria-pressed', 'true');
  const region = page.getByRole('region', { name: 'Ingredient checklist' });
  await region.press('PageDown');
  await expect.poll(() => region.evaluate(node => node.scrollTop)).toBeGreaterThan(50);
  await expect(page.getByRole('heading', { name: 'Corner Market' })).toBeInViewport();
  await expect(page.getByRole('searchbox')).toBeInViewport();
  await page.setViewportSize({ width: 1100, height: 440 });
  const searchTop = (await page.getByRole('searchbox').boundingBox()).y;
  await region.evaluate(node => { node.scrollTop = node.scrollHeight; });
  const pane = await region.boundingBox();
  await page.mouse.move(pane.x + pane.width / 2, pane.y + 10);
  await page.mouse.wheel(0, 450);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect((await page.getByRole('searchbox').boundingBox()).y).toBe(searchTop);

  const filter = page.getByRole('button', { name: 'At this store' });
  await filter.press('Enter');
  await expect(page.getByText('Saved assignment')).toBeVisible();
  const orphan = page.getByRole('checkbox', { name: 'White Miso at Corner Market' });
  await expect(orphan).toBeChecked();
  await orphan.press('Space');
  await expect(orphan).toHaveCount(0);
  await expect(filter).toBeFocused();

  await page.getByRole('button', { name: 'Undo' }).press('Enter');
  await expect(orphan).toBeChecked();
  await expect(filter).toBeFocused();
  await sidebar.getByRole('button', { name: 'Fresh Mart 1' }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Fresh Mart' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Carrots at Fresh Mart' })).toBeChecked();
});

test('Stores checklist preserves the latest Undo after a failed save and rolls back a failed store delete', async ({ page }) => {
  const search = page.getByRole('searchbox');
  await search.fill('carrots');
  const carrots = page.getByRole('checkbox', { name: 'Carrots at Corner Market' });
  await carrots.press('Space');
  await expect(carrots).toBeChecked();
  await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    db.ingredientStores.hook('creating', () => { throw new Error('Fixture rejected assignment'); });
    db.stores.hook('deleting', () => { throw new Error('Fixture rejected store delete'); });
  });
  await search.fill('red-pepper');
  const checkbox = page.getByRole('checkbox', { name: 'Red-Pepper Flakes at Corner Market' });
  await checkbox.press('Space');
  await expect(page.getByRole('alert')).toHaveText(/Could not save the assignment/);
  await expect(checkbox).not.toBeChecked();
  await expect(checkbox).toBeFocused();
  await page.getByRole('button', { name: 'Undo' }).press('Enter');
  await expect(page.getByRole('status')).toHaveText(/Change undone/);
  await search.fill('carrots');
  await expect(carrots).not.toBeChecked();
  await expect(page.getByRole('alert')).toHaveText(/Could not save the assignment/);

  await page.getByRole('button', { name: 'Manage stores' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Delete Corner Market' }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText(/Could not delete the store/);
  expect((await readStores(page)).map(({ name, ingredients }) => ({ name, ingredients }))).toEqual([
    { name: 'Corner Market', ingredients: ['white miso'] },
    { name: 'Fresh Mart', ingredients: ['carrots'] },
  ]);
});


test('Stores checklist saves and creates a store offline while keeping the current selection', async ({ page, context }) => {
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await page.getByRole('searchbox').fill('carrots');
  const checkbox = page.getByRole('checkbox', { name: 'Carrots at Corner Market' });
  await checkbox.press('Space');
  await expect(checkbox).toBeChecked();

  const dialog = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Manage stores' }).click();
  await dialog.getByRole('textbox', { name: 'Store name' }).fill('A Market');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog.getByText('A Market', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('heading', { name: 'Corner Market' })).toBeVisible();
  await expect(checkbox).toBeChecked();
});

test('Stores checklist keeps the newer Undo when a previous Undo and another save overlap', async ({ page }) => {
  const carrots = page.getByRole('checkbox', { name: 'Carrots at Corner Market' });
  await carrots.press('Space');
  await expect(carrots).toBeChecked();
  const next = page.getByRole('checkbox', { name: 'Ingredient 0 at Corner Market' });
  await next.evaluate(input => {
    input.click();
    [...document.querySelectorAll('button')].find(button => button.textContent === 'Undo').click();
  });
  await expect(carrots).not.toBeChecked();
  await expect(next).toBeChecked();
  await page.getByRole('button', { name: 'Undo' }).press('Enter');
  await expect(next).not.toBeChecked();
});

test('Stores checklist asks for confirmation again if the store’s linked count changes', async ({ page }) => {
  await page.getByRole('button', { name: 'Manage stores' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Delete Corner Market' }).click();
  await expect(dialog.getByText('Delete Corner Market and its 1 ingredient assignment?')).toBeVisible();
  await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    const store = await db.stores.get({ name: 'Corner Market' });
    await db.ingredientStores.add({ storeId: store.id, ingredientName: 'red-pepper flakes' });
  });
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText(/Store details changed/);
  await expect(dialog.getByText('Delete Corner Market and its 2 ingredient assignments?')).toBeVisible();
  expect((await readStores(page))[0].ingredients).toEqual(['red-pepper flakes', 'white miso']);
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog.getByText('Corner Market', { exact: true })).toHaveCount(0);
  expect((await readStores(page)).map(store => store.name)).toEqual(['Fresh Mart']);
});

test('Stores checklist keeps loaded rows visible if IndexedDB closes after loading', async ({ page }) => {
  await page.getByRole('searchbox').fill('red-pepper');
  const checkbox = page.getByRole('checkbox', { name: 'Red-Pepper Flakes at Corner Market' });
  await expect(checkbox).toBeVisible();
  await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    db.close();
  });
  await checkbox.press('Space');
  await expect(page.getByRole('alert')).toHaveText(/Could not save the assignment/);
  await expect(checkbox).not.toBeChecked();
  await expect(checkbox).toBeFocused();
});

test('Stores checklist recovers focus when a pending Undo removes the focused row', async ({ page }) => {
  await page.getByRole('searchbox').fill('red-pepper');
  const checkbox = page.getByRole('checkbox', { name: 'Red-Pepper Flakes at Corner Market' });
  await page.getByRole('button', { name: 'Not assigned' }).press('Enter');
  await checkbox.press('Space');
  await expect(checkbox).toHaveCount(0);
  const assignedFilter = page.getByRole('button', { name: 'At this store' });
  await assignedFilter.press('Enter');
  await expect(checkbox).toBeChecked();

  await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    const remove = db.ingredientStores.delete.bind(db.ingredientStores);
    const release = new Promise(resolve => { window.finishChecklistUndo = resolve; });
    db.ingredientStores.delete = async id => {
      await db.constructor.waitFor(release);
      return remove(id);
    };
  });
  await page.getByRole('button', { name: 'Undo' }).press('Enter');
  await page.keyboard.press('Shift+Tab');
  await expect(checkbox).toBeFocused();
  await page.evaluate(() => window.finishChecklistUndo());
  await expect(checkbox).toHaveCount(0);
  await expect(assignedFilter).toBeFocused();
});

test('Stores checklist shows committed changes even when its reconciliation read fails', async ({ page }) => {
  await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    db.ingredientStores.toArray = () => Promise.reject(new Error('Fixture rejected assignment refresh'));
    db.stores.orderBy = () => ({ toArray: () => Promise.reject(new Error('Fixture rejected store refresh')) });
  });
  const carrots = page.getByRole('checkbox', { name: 'Carrots at Corner Market' });
  await carrots.press('Space');
  await expect(carrots).toBeChecked();
  await expect(page.getByRole('button', { name: 'Corner Market 2' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).press('Enter');
  await expect(carrots).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Corner Market 1' })).toBeVisible();

  const dialog = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Manage stores' }).click();
  await dialog.getByRole('textbox', { name: 'Store name' }).fill('A Market');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog.getByText('A Market', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete Corner Market' }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog.getByText('Corner Market', { exact: true })).toHaveCount(0);
});

test('Stores checklist keeps a failed edit visible when a different pair saves', async ({ page }) => {
  await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    db.ingredientStores.hook('creating', (_, link) => {
      if (link.ingredientName === 'carrots') throw new Error('Fixture rejected carrots');
    });
    [...document.querySelectorAll('input[type=checkbox]')].slice(0, 2).forEach(input => input.click());
  });
  await expect(page.getByRole('checkbox', { name: 'Carrots at Corner Market' })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Ingredient 0 at Corner Market' })).toBeChecked();
  await expect(page.getByRole('alert')).toHaveText(/Could not save the assignment for Carrots/);
});
