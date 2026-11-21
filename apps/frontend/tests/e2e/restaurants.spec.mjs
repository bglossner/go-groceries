import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
const base = 'http://127.0.0.1:18926';
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=',
  'base64'
);
const png = process.env.REGRESSION_PHOTO_PATH
  ? await readFile(process.env.REGRESSION_PHOTO_PATH)
  : tinyPng;
const tables = [
  'restaurants',
  'restaurantTags',
  'restaurantItems',
  'people',
  'restaurantItemRatings',
];
async function guard(context) {
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return ['http:', 'https:'].includes(url.protocol) &&
      ![base, 'http://127.0.0.1:18927'].includes(url.origin)
      ? route.abort()
      : route.continue();
  });
  await context.routeWebSocket('**/*', (socket) => socket.close());
}
async function shot(page, name) {
  const closeToast = page.locator('.MuiSnackbar-root button[aria-label="Close"]');
  for (const button of await closeToast.all()) await button.click();
  // Hide only the existing development diagnostic badge for production layout comparison.
  await page
    .getByRole('button', { name: 'Open Tanstack query devtools', exact: true })
    .evaluateAll((buttons) =>
      buttons.forEach((button) => {
        const container = button.closest('.tsqd-open-btn-container');
        if (container) container.style.display = 'none';
      })
    );
  await page.evaluate(async () => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    document.body.getBoundingClientRect();
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {}))
    );
  });
  await page.screenshot({
    path: join(process.env.REGRESSION_ARTIFACT_DIR, name + '.png'),
  });
  if (name.startsWith('restaurant-editor-')) {
    await page.getByLabel('Google Maps link', { exact: true }).evaluate((field) =>
      field.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await page.screenshot({
      path: join(
        process.env.REGRESSION_ARTIFACT_DIR,
        name.replace('restaurant-editor', 'restaurant-editor-location') + '.png'
      ),
    });
  }
  if (name.startsWith('dish-details-')) {
    const field = name.includes('-on-')
      ? page.getByLabel('Price', { exact: true })
      : page.getByLabel('Last ordered', { exact: true });
    if (await field.count()) {
      await field.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: join(
          process.env.REGRESSION_ARTIFACT_DIR,
          name.replace('dish-details', 'dish-ordering') + '.png'
        ),
      });
    }
  }
}
async function choose(page, label, text) {
  await page.getByLabel(label, { exact: true }).filter({ visible: true }).click();
  await page.getByRole('option', { name: text, exact: true }).click();
}
async function advanced(page, enabled) {
  const toggle = page.getByLabel('Show advanced restaurant fields', {
    exact: true,
  });
  if ((await toggle.isChecked()) !== enabled) await toggle.click();
  if (enabled) await expect(toggle).toBeChecked();
  else await expect(toggle).not.toBeChecked();
}
async function state(page) {
  return page.evaluate(async (tables) => {
    const { db } = await import('/src/db/db.ts');
    const { hashBlob } = await import('/src/db/image-cache.ts');
    return {
      tables: Object.fromEntries(
        await Promise.all(tables.map(async (name) => [name, await db.table(name).toArray()]))
      ),
      assets: await Promise.all(
        (await db.imageAssets.toArray()).map(async (a) => ({
          id: a.assetId,
          hash: await hashBlob(a.blob),
          size: a.byteLength,
          mime: a.mimeType,
        }))
      ),
    };
  }, tables);
}
async function setPass(page) {
  await page.goto('/settings');
  await page.getByLabel('YouTube API Pass', { exact: true }).fill('test-writer-pass');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Save YouTube API Pass', exact: true }).click();
}
async function create(page, suffix) {
  await page.goto('/restaurants');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Restaurant name', exact: true })
    .fill('Kumo Noodle House');
  await page
    .getByLabel('General notes', { exact: true })
    .fill('Quiet at lunch.\nAsk for mushroom broth.');
  await page.getByLabel('Country', { exact: true }).fill('United Kingdom');
  await page.getByLabel('State / region', { exact: true }).fill('England');
  await page.getByLabel('City', { exact: true }).fill('London');
  await page.getByLabel('Address', { exact: true }).fill('18 Maple Lane, London');
  await page
    .getByLabel('Google Maps link', { exact: true })
    .fill('https://maps.google.com/?q=London');
  await page.getByRole('combobox', { name: 'Restaurant tags', exact: true }).fill('Japanese');
  await page.getByRole('combobox', { name: 'Restaurant tags', exact: true }).press('ArrowDown');
  await page.getByRole('combobox', { name: 'Restaurant tags', exact: true }).press('Enter');
  await page.getByRole('combobox', { name: 'Restaurant tags', exact: true }).fill('Vegan options');
  await page.getByRole('option', { name: 'Vegan options', exact: true }).click();
  await expect(page.getByLabel('Latitude', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Longitude', { exact: true })).toHaveCount(0);
  await shot(page, `restaurant-editor-${suffix}`);
  await page.getByRole('button', { name: 'Save restaurant', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Kumo Noodle House', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add dish', exact: true }).click();
  await page.getByRole('textbox', { name: 'Dish name', exact: true }).fill('Miso mushroom ramen');
  await page
    .getByLabel('Description', { exact: true })
    .fill('Mushroom broth, spring onion and silky noodles.');
  await page
    .getByLabel('Ordering modifiers', { exact: true })
    .fill('No coriander, sauce on the side');
  await choose(page, 'Category', 'Main');
  await page.getByLabel('Vegan', { exact: true }).check();
  await page.getByLabel('Last ordered', { exact: true }).fill('2020-11-12');
  await page.getByLabel('Upload dish photos', { exact: true }).setInputFiles({
    name: 'synthetic.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await expect(page.getByAltText('Miso mushroom ramen photo')).toBeVisible();
  await shot(page, `dish-details-off-${suffix}`);
  await page.getByRole('tab', { name: 'Opinions', exact: true }).click();
  for (const name of ['Ben', 'Sarah']) {
    await page.getByRole('button', { name: 'Add person', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Person name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Save person', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add rating', exact: true }).click();
    const row = page.getByLabel('Person', { exact: true }).last();
    await row.click();
    await page.getByRole('option', { name, exact: true }).click();
    await page
      .getByLabel('Score / 10', { exact: true })
      .last()
      .fill(name === 'Ben' ? '9' : '8');
    await page
      .getByLabel('Comment', { exact: true })
      .last()
      .fill(name === 'Ben' ? 'Rich broth.' : 'Lovely noodles.');
  }
  await shot(page, `dish-opinions-${suffix}`);
  await page.getByRole('button', { name: 'Save dish', exact: true }).click();
  await expect(page.getByText('Mean 8.5/10 · 2 people', { exact: true })).toBeVisible();
  await shot(page, `restaurant-dishes-off-${suffix}`);
  await page.getByRole('button', { name: 'Pin Kumo Noodle House', exact: true }).click();
  await page.getByRole('tab', { name: 'About', exact: true }).click();
  await shot(page, `restaurant-about-${suffix}`);
  await page.getByRole('button', { name: 'Manage people', exact: true }).click();
  await shot(page, `restaurant-people-${suffix}`);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
}
for (const [suffix, width] of [
  ['phone', 390],
  ['wide', 1180],
])
  test(`cards and tabs ${suffix}: CRUD, photo, named ratings, filters, advanced drafts, export/import and stub sync`, async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width, height: 844 });
    await guard(context);
    await page.goto('/restaurant/999999');
    await expect(page.getByText('Restaurant not found', { exact: true })).toBeVisible();
    await shot(page, `restaurant-not-found-${suffix}`);
    await page.goto('/restaurants');
    await expect(
      page.getByText('No matching restaurants. Clear filters or create a restaurant.', {
        exact: true,
      })
    ).toBeVisible();
    await shot(page, `restaurant-empty-${suffix}`);
    await create(page, suffix);
    await page.getByRole('link', { name: 'Back to Restaurants', exact: true }).click();
    await choose(page, 'Sort', 'Best rated');
    await choose(page, 'Rating basis', 'Ben');
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await choose(page, 'Country', 'United Kingdom');
    await choose(page, 'State / region', 'England');
    await choose(page, 'City', 'London');
    await page.getByLabel('Minimum person score', { exact: true }).check();
    await page.getByLabel('Minimum score / 10', { exact: true }).fill('9');
    await shot(page, `restaurant-filters-${suffix}`);
    await page.getByRole('button', { name: 'Show results', exact: true }).click();
    await expect(
      page.getByLabel('Rating basis', { exact: true }).filter({ visible: true })
    ).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Kumo Noodle House', exact: true })).toBeVisible();
    await shot(page, `restaurant-list-${suffix}`);
    await choose(page, 'Rating basis', 'Household');
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await expect(page.getByLabel('Minimum person score', { exact: true })).not.toBeChecked();
    await page.getByRole('button', { name: 'Show results', exact: true }).click();
    await expect(
      page.getByLabel('Rating basis', { exact: true }).filter({ visible: true })
    ).toHaveCount(1);
    await choose(page, 'Rating basis', 'Ben');
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await expect(page.getByLabel('Minimum person score', { exact: true })).not.toBeChecked();
    await page.getByRole('button', { name: 'Show results', exact: true }).click();
    await expect(
      page.getByLabel('Rating basis', { exact: true }).filter({ visible: true })
    ).toHaveCount(1);
    await page.getByRole('link', { name: 'Kumo Noodle House', exact: true }).click();
    const settings = await context.newPage();
    await settings.setViewportSize({ width, height: 844 });
    await settings.goto(base + '/settings');
    await shot(settings, `restaurant-settings-off-${suffix}`);
    await advanced(settings, true);
    await shot(settings, `restaurant-settings-on-${suffix}`);
    await page.getByRole('button', { name: 'Edit Miso mushroom ramen', exact: true }).click();
    await expect(page.getByLabel('Price', { exact: true })).toBeVisible();
    await page.getByLabel('Price', { exact: true }).fill('10');
    await page.getByLabel('Currency', { exact: true }).fill('GBP');
    await page.getByLabel('Size / portion', { exact: true }).fill('Regular bowl');
    await choose(page, 'Spice', 'Mild');
    await shot(page, `dish-details-on-${suffix}`);
    await page.getByRole('button', { name: 'Save dish', exact: true }).click();
    await shot(page, `restaurant-dishes-on-${suffix}`);
    await page.getByRole('button', { name: 'Edit Miso mushroom ramen', exact: true }).click();
    await page.getByLabel('Price', { exact: true }).fill('12');
    await advanced(settings, false);
    await expect(page.getByLabel('Price', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Save dish', exact: true }).click();
    expect((await state(page)).tables.restaurantItems[0].priceAmount).toBe('12');
    await advanced(settings, true);
    await page.getByRole('button', { name: 'Edit Miso mushroom ramen', exact: true }).click();
    await page.getByLabel('Price', { exact: true }).fill('14');
    await advanced(settings, false);
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
    expect((await state(page)).tables.restaurantItems[0].priceAmount).toBe('12');
    await settings.close();
    const expected = await state(page);
    await page.goto('/');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Groceries', exact: true }).click();
    const file = join(process.env.REGRESSION_ARTIFACT_DIR, `restaurant-backup-${suffix}.json`);
    await (await downloadPromise).saveAs(file);
    const fresh = await browser.newContext({
      viewport: { width, height: 844 },
    });
    await guard(fresh);
    try {
      const imported = await fresh.newPage();
      await imported.goto(base + '/');
      await imported.getByRole('button', { name: 'Import Groceries', exact: true }).click();
      const chooser = imported.waitForEvent('filechooser');
      await imported.getByRole('button', { name: 'Yes', exact: true }).click();
      await (await chooser).setFiles(file);
      await expect(
        imported.getByText('Restaurants: 0 local → 1 imported', {
          exact: false,
        })
      ).toBeVisible();
      await imported.getByRole('button', { name: 'Confirm replacement', exact: true }).click();
      await expect(imported.getByText('Import Succeeded!', { exact: true })).toBeVisible();
      expect(await state(imported)).toEqual(expected);
      await imported.getByRole('button', { name: 'Close', exact: true }).click();
      const old = JSON.parse(await readFile(file, 'utf8'));
      old.data.databaseVersion = 15;
      old.data.tables = old.data.tables.filter((t) => !tables.includes(t.name));
      old.data.data = old.data.data.filter((t) => !tables.includes(t.tableName));
      const oldFile = join(
        process.env.REGRESSION_ARTIFACT_DIR,
        `restaurant-old-backup-${suffix}.json`
      );
      await writeFile(oldFile, JSON.stringify(old));
      await imported.getByRole('button', { name: 'Import Groceries', exact: true }).click();
      const oldChooser = imported.waitForEvent('filechooser');
      await imported.getByRole('button', { name: 'Yes', exact: true }).click();
      await (await oldChooser).setFiles(oldFile);
      await expect(
        imported.getByText('Restaurants: 1 local → 0 imported', {
          exact: false,
        })
      ).toBeVisible();
      await shot(imported, `restaurant-import-replacement-${suffix}`);
      await imported.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect(await state(imported)).toEqual(expected);
    } finally {
      await fresh.close();
    }
    await setPass(page);
    await page.getByRole('button', { name: 'Sync To Cloud', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Synced metadata' })).toBeVisible();
    const url = await page.evaluate(async () => {
      const { db } = await import('/src/db/db.ts');
      return (await db.syncs.where('type').equals('to').first()).url;
    });
    const downContext = await browser.newContext({
      viewport: { width, height: 844 },
    });
    await guard(downContext);
    try {
      const down = await downContext.newPage();
      await down.goto(base + '/settings');
      await setPass(down);
      await down.getByLabel('Sync From URL', { exact: true }).fill(url);
      await down.getByRole('button', { name: 'Save New Sync Location', exact: true }).click();
      await down.getByRole('button', { name: 'Sync DB', exact: true }).click();
      await expect(
        down.getByText('Restaurants: 0 local → 1 imported', { exact: false })
      ).toBeVisible();
      await down.getByRole('button', { name: 'Confirm Import', exact: true }).click();
      await expect(down.getByRole('dialog')).toHaveCount(0);
      expect(await state(down)).toEqual(expected);
      await down.goto(base + '/restaurant/' + expected.tables.restaurants[0].id);
      await expect(down.getByText('Mean 8.5/10 · 2 people', { exact: true })).toBeVisible();
      await expect
        .poll(() =>
          down.getByAltText('Miso mushroom ramen photo').evaluate((img) => img.naturalWidth)
        )
        .toBeGreaterThan(0);
    } finally {
      await downContext.close();
    }
  });

test('restaurant stress timings with 500 restaurants, 5000 dishes, 10000 ratings and 500 cached assets', async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120000);
  await guard(context);
  await page.goto('/restaurants');
  await page.evaluate(
    async (png) => {
      const { db } = await import('/src/db/db.ts');
      const { cacheImage } = await import('/src/db/image-cache.ts');
      const refs = [];
      for (let start = 0; start < 500; start += 16) {
        refs.push(
          ...(await Promise.all(
            Array.from({ length: Math.min(16, 500 - start) }, (_, offset) =>
              cacheImage(
                new File([new Uint8Array(png), String(start + offset)], 'stress.png', {
                  type: 'image/png',
                })
              )
            )
          ))
        );
      }
      const time = '2020-01-01T00:00:00.000Z';
      const dates = { createdAt: time, updatedAt: time };
      await db.transaction(
        'rw',
        [db.restaurants, db.restaurantItems, db.people, db.restaurantItemRatings],
        async () => {
          await db.restaurants.bulkPut(
            Array.from({ length: 500 }, (_, i) => ({
              id: i + 1,
              name: 'Restaurant ' + String(i).padStart(3, '0'),
              tags: [],
              notes: '',
              isPinned: false,
              country: 'Canada',
              countryKey: 'canada',
              regionKey: '',
              cityKey: '',
              ...dates,
            }))
          );
          await db.restaurantItems.bulkPut(
            Array.from({ length: 5000 }, (_, i) => ({
              id: i + 1,
              restaurantId: i < 20 ? 1 : Math.floor(i / 10) + 1,
              name: 'Dish ' + i,
              description: 'Synthetic stress dish',
              notes: '',
              images: i < 500 ? [refs[i]] : [],
              dietaryFlags: [],
              ...dates,
            }))
          );
          await db.people.bulkPut([
            {
              id: 1,
              name: 'Ben',
              normalizedName: 'ben',
              status: 'active',
              ...dates,
            },
            {
              id: 2,
              name: 'Sarah',
              normalizedName: 'sarah',
              status: 'active',
              ...dates,
            },
          ]);
          await db.restaurantItemRatings.bulkPut(
            Array.from({ length: 10000 }, (_, i) => ({
              id: i + 1,
              itemId: (i % 5000) + 1,
              personId: i < 5000 ? 1 : 2,
              score: 8,
              ...dates,
            }))
          );
        }
      );
    },
    [...png]
  );
  await expect(
    page.getByText('500 restaurants · matching pins first', { exact: true })
  ).toBeVisible();
  await page.getByLabel('Find restaurant, dish or place', { exact: true }).fill('Restaurant 042');
  await expect(
    page.getByText('1 restaurants · matching pins first', { exact: true })
  ).toBeVisible();
  await page.getByLabel('Find restaurant, dish or place', { exact: true }).fill('Restaurant 043');
  await expect(page.getByRole('link', { name: 'Restaurant 043', exact: true })).toBeVisible();
  const searchStart = Date.now();
  await page.getByLabel('Find restaurant, dish or place', { exact: true }).fill('Restaurant 000');
  await expect(page.getByRole('link', { name: 'Restaurant 000', exact: true })).toBeVisible();
  const searchMs = Date.now() - searchStart;
  const detailStart = Date.now();
  await page.getByRole('link', { name: 'Restaurant 000', exact: true }).click();
  await expect(page.getByText('Dish 19', { exact: true })).toBeVisible();
  const detailMs = Date.now() - detailStart;
  await writeFile(
    join(process.env.REGRESSION_ARTIFACT_DIR, 'restaurant-performance.json'),
    JSON.stringify(
      {
        browser: browser.version(),
        platform: process.platform,
        restaurants: 500,
        dishes: 5000,
        ratings: 10000,
        assets: 500,
        searchMs,
        first20DishSummariesMs: detailMs,
      },
      null,
      2
    )
  );
  expect(searchMs).toBeLessThanOrEqual(500);
  expect(detailMs).toBeLessThanOrEqual(1000);
  const blocked = await page.evaluate(async () => {
    const { freezeSnapshot } = await import('/src/util/sync/snapshot-adapter.ts');
    const { db } = await import('/src/db/db.ts');
    try {
      await freezeSnapshot(crypto.randomUUID(), crypto.randomUUID());
      return 'unexpected success';
    } catch (error) {
      return {
        message: error.message,
        restaurants: await db.restaurants.count(),
        ratings: await db.restaurantItemRatings.count(),
      };
    }
  });
  expect(blocked.restaurants).toBe(500);
  expect(blocked.ratings).toBe(10000);
  expect(blocked.message).toContain('Reduce the collection');
});

test('restaurant visual regression: drawer fits a phone viewport', async ({ page, context }) => {
  await guard(context);
  await page.setViewportSize({ width: 360, height: 844 });
  await page.goto('/restaurants');
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  const rect = await page.locator('.MuiDrawer-paper').evaluate((el) => ({
    width: el.getBoundingClientRect().width,
    viewport: innerWidth,
  }));
  expect(rect.width).toBeLessThanOrEqual(rect.viewport + 0.5);
});
test('restaurant visual regression: editor action bar stays at the viewport bottom', async ({
  page,
  context,
}) => {
  await guard(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/restaurants');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('textbox', { name: 'Restaurant name', exact: true }).fill('Visual kitchen');
  await page.getByRole('button', { name: 'Save restaurant', exact: true }).click();
  await page.getByRole('button', { name: 'Add dish', exact: true }).click();
  await page.getByRole('tab', { name: 'Opinions', exact: true }).click();
  const rect = await page
    .getByRole('button', { name: 'Save dish', exact: true })
    .evaluate((el) => ({
      bottom: el.closest('.MuiPaper-root').getBoundingClientRect().bottom,
      viewport: innerHeight,
    }));
  expect(Math.abs(rect.bottom - rect.viewport)).toBeLessThanOrEqual(1);
});

for (const [suffix, width] of [
  ['phone', 390],
  ['wide', 1180],
])
  test(`removable applied filters ${suffix}: each chip, dependent resets and drawer state`, async ({
    page,
    context,
  }) => {
    await guard(context);
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/restaurants');
    await page.evaluate(async () => {
      const { saveRestaurant, saveDish, savePerson } = await import('/src/db/restaurants.ts');
      const time = '2020-01-01T00:00:00.000Z';
      const dates = { createdAt: time, updatedAt: time };
      const rid = await saveRestaurant(
        {
          name: 'Synthetic kitchen',
          tags: [],
          notes: '',
          isPinned: false,
          country: 'USA',
          region: 'California',
          city: 'Oakland',
          countryKey: 'usa',
          regionKey: 'california',
          cityKey: 'oakland',
          ...dates,
        },
        ['Japanese', 'Vegan options']
      );
      const personId = await savePerson('Alex');
      await saveDish(
        {
          restaurantId: rid,
          name: 'Ramen',
          description: '',
          notes: '',
          images: [],
          dietaryFlags: [],
          ...dates,
        },
        [{ itemId: 1, personId, score: 9, ...dates }]
      );
    });
    await expect(page.getByRole('link', { name: 'Synthetic kitchen', exact: true })).toBeVisible();
    await page.getByLabel('Find restaurant, dish or place', { exact: true }).fill('Ramen');
    await choose(page, 'Sort', 'Best rated');
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    for (const tag of ['Japanese', 'Vegan options']) {
      await page.getByLabel('Tags · match all', { exact: true }).fill(tag);
      await page.getByRole('option', { name: tag, exact: true }).click();
    }
    await choose(page, 'Country', 'USA');
    await choose(page, 'State / region', 'California');
    await choose(page, 'City', 'Oakland');
    await page.locator('.MuiDrawer-paper').getByLabel('Rating basis', { exact: true }).click();
    await page.getByRole('option', { name: 'Alex', exact: true }).click();
    await page.getByLabel('Minimum person score', { exact: true }).check();
    await page.getByLabel('Minimum score / 10', { exact: true }).fill('8.5');
    await page.getByRole('button', { name: 'Show results', exact: true }).click();
    const labels = [
      'Search: Ramen',
      'Tag: Japanese',
      'Tag: Vegan options',
      'Country: USA',
      'State / region: California',
      'City: Oakland',
      'Person: Alex',
      'Minimum score: 8.5/10',
      'Sort: Best rated',
    ];
    // Preserve the pre-assertion screen so a failing-first run proves the reported state.
    await shot(page, `filters-applied-${suffix}`);
    console.log(
      JSON.stringify({
        viewport: suffix,
        appliedTypes: labels,
        visibleDeleteControls: await page.locator('[aria-label^="Remove filter:"]').count(),
      })
    );
    const chips = page.getByRole('group', {
      name: 'Applied filters',
      exact: true,
    });
    const remove = async (label) => {
      const chip = chips.getByRole('button', {
        name: `Remove filter: ${label}`,
        exact: true,
      });
      // MUI onDelete supports keyboard removal as well as the delete icon.
      if (label.startsWith('Search:')) {
        await chip.focus();
        await chip.press('Delete');
      } else await chip.locator('.MuiChip-deleteIcon').click();
      await expect(chip).toHaveCount(0);
    };
    for (const label of labels)
      await expect(
        chips.getByRole('button', {
          name: `Remove filter: ${label}`,
          exact: true,
        })
      ).toBeVisible();
    await remove('Search: Ramen');
    await expect(page.getByLabel('Find restaurant, dish or place', { exact: true })).toHaveValue(
      ''
    );
    await remove('Tag: Japanese');
    await expect(chips.getByText('Tag: Vegan options', { exact: true })).toBeVisible();
    await remove('City: Oakland');
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await choose(page, 'City', 'Oakland');
    await page.getByRole('button', { name: 'Show results', exact: true }).click();
    await remove('State / region: California');
    await expect(chips.getByText('City: Oakland', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await expect(page.getByLabel('Tags · match all', { exact: true })).toHaveValue('');
    await expect(
      page.locator('.MuiDrawer-paper').getByText('Vegan options', { exact: true })
    ).toBeVisible();
    await expect(page.getByLabel('Country', { exact: true })).toHaveText('USA');
    await expect(page.getByLabel('State / region', { exact: true })).toHaveText('All');
    await choose(page, 'State / region', 'California');
    await choose(page, 'City', 'Oakland');
    await page.getByRole('button', { name: 'Show results', exact: true }).click();
    await remove('Country: USA');
    await expect(chips.getByText('State / region: California', { exact: true })).toHaveCount(0);
    await expect(chips.getByText('City: Oakland', { exact: true })).toHaveCount(0);
    await shot(page, `filters-removed-${suffix}`);
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await expect(page.getByLabel('Country', { exact: true })).toHaveText('All');
    await expect(page.getByLabel('State / region', { exact: true })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    await expect(page.getByLabel('City', { exact: true })).toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('button', { name: 'Show results', exact: true }).click();
    await remove('Minimum score: 8.5/10');
    await expect(chips.getByText('Person: Alex', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await expect(page.getByLabel('Minimum person score', { exact: true })).not.toBeChecked();
    await page.getByLabel('Minimum person score', { exact: true }).check();
    await page.getByRole('button', { name: 'Show results', exact: true }).click();
    await remove('Person: Alex');
    await expect(chips.getByText('Minimum score: 8.5/10', { exact: true })).toHaveCount(0);
    await choose(page, 'Rating basis', 'Alex');
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await expect(page.getByLabel('Minimum person score', { exact: true })).not.toBeChecked();
    await page.getByRole('button', { name: 'Show results', exact: true }).click();
    await remove('Sort: Best rated');
    await expect(page.getByLabel('Sort', { exact: true })).toHaveText('Name');
    await page.getByRole('button', { name: 'Clear all', exact: true }).click();
    await expect(chips).toHaveCount(0);
    await expect(page.getByLabel('Rating basis', { exact: true })).toHaveText('Household');
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await expect(page.locator('.MuiDrawer-paper .MuiAutocomplete-tag')).toHaveCount(0);
    await expect(page.getByLabel('Minimum person score', { exact: true })).not.toBeChecked();
    await expect(page.getByLabel('Minimum person score', { exact: true })).toBeDisabled();
  });
