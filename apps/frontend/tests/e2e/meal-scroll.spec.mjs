import { expect, test } from '@playwright/test';

const targetName = 'Lemon and herb chicken';
const targetId = 15;
const listName = 'Weekly shopping';

const mealSummary = page => page.getByRole('button', { name: new RegExp(`^${targetName}`) });

async function seedMealList({ targetName, targetId, listName }) {
  const { db } = await import('/src/db/db.ts');
  const date = new Date('2025-01-01T00:00:00Z');
  await db.meals.bulkAdd(Array.from({ length: 38 }, (_, index) => ({
    id: index + 1,
    name: index + 1 === targetId ? targetName : `${index + 1 < targetId ? 'Apple' : 'Tomato'} meal ${index + 1}`,
    ingredients: [{ name: 'onion', quantity: 1 }],
    createdAt: date,
    updatedAt: date,
  })));
  await db.recipes.add({ mealId: targetId, url: '', notes: 'Roast until golden.', images: [] });
  await db.groceryLists.add({ name: listName, meals: [targetId, 999], createdAt: date });
}

async function assertHighlightedMeal(page, screenshot) {
  await expect(page).toHaveURL(url => url.pathname === '/meals' &&
    url.searchParams.get('mealId') === JSON.stringify(String(targetId)));
  const summary = mealSummary(page);
  const banner = page.getByRole('banner');
  await expect(summary).toBeVisible();
  const accordion = summary.locator('xpath=../..');
  await expect(accordion).toHaveCSS('background-color', 'rgb(255, 255, 0)');
  const measure = async () => {
    const header = await banner.boundingBox();
    const meal = await accordion.boundingBox();
    return { mealTop: meal.y, headerBottom: header.y + header.height };
  };
  try {
    await expect.poll(async () => {
      const { mealTop, headerBottom } = await measure();
      const gap = mealTop - headerBottom;
      return gap >= 0 && gap <= 8 ? 'aligned' : gap;
    }, { timeout: 1200, message: 'The highlighted meal top aligns below the app bar' }).toBe('aligned');
  } finally {
    console.log(await measure());
    if (screenshot) await page.screenshot({ path: screenshot });
  }
  await expect(summary).toBeInViewport({ ratio: 1 });
  await expect(accordion).toHaveCSS('background-color', 'rgb(255, 255, 0)');
}

for (const { label, viewport, touch } of [
  { label: 'phone', viewport: { width: 390, height: 844 }, touch: true },
  { label: 'desktop', viewport: { width: 1200, height: 900 }, touch: false },
]) {
  test.describe(`Meal navigation on ${label}`, () => {
    test.use({ viewport, hasTouch: touch, isMobile: touch });

    test.beforeEach(async ({ context, page, baseURL }) => {
      const origin = new URL(baseURL).origin;
      await context.route('**/*', route =>
        new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
      );
      await page.goto('/');
      await page.evaluate(seedMealList, { targetName, targetId, listName });
    });

    test('returning from a recipe aligns and highlights its meal', async ({ page }, testInfo) => {
      await page.getByRole('link', { name: 'Meals', exact: true }).click();
      const summary = mealSummary(page);
      await summary.click();
      await summary.locator('xpath=../..').getByTestId('RestaurantIcon').click();
      await expect(page.getByRole('heading', { name: `Recipe for ${targetName}` })).toBeVisible();
      await page.evaluate(async () => {
        const { db } = await import('/src/db/db.ts');
        window.mealReturnScrollEnd = new Promise(resolve => {
          const onScrollEnd = () => {
            if (location.pathname !== '/meals' || window.scrollY <= 10) return;
            document.removeEventListener('scrollend', onScrollEnd);
            resolve();
          };
          document.addEventListener('scrollend', onScrollEnd);
        });

        // A pending write lets the cached meal list render before its refresh reads the database.
        await new Promise(started => {
          void db.transaction('rw', db.meals, async () => {
            started();
            await db.constructor.waitFor(new Promise(resolve => {
              const check = () => {
                if (location.pathname === '/meals' && window.scrollY > 10) resolve();
                else requestAnimationFrame(check);
              };
              requestAnimationFrame(check);
            }));
            await db.meals.delete(1);
          });
        });
      });
      await page.getByTestId('ArrowBackIcon').click();
      await expect(mealSummary(page)).toBeVisible();
      await expect(page.getByRole('button', { name: /^Apple meal 1 Created:/ })).toHaveCount(0);
      await page.evaluate(() => window.mealReturnScrollEnd);
      await assertHighlightedMeal(page, testInfo.outputPath('recipe-return.png'));
    });

    test('opening a grocery list meal scrolls to it and Back returns to Lists', async ({ page }, testInfo) => {
      await page.getByRole('link', { name: 'Lists', exact: true }).click();
      const list = page.getByRole('button', { name: new RegExp(`^${listName}`) });
      await list.click();
      const mealLink = page.getByRole('link', { name: targetName, exact: true });
      await expect(mealLink).toBeInViewport({ ratio: 1 });
      await expect(page.locator('a[href^="/meals?"]')).toHaveCount(1);
      await page.screenshot({ path: testInfo.outputPath('list-link.png'), animations: 'disabled' });
      if (touch) await mealLink.tap();
      else await mealLink.press('Enter');
      await assertHighlightedMeal(page, testInfo.outputPath('list-landing.png'));

      await page.goBack();
      await expect(page).toHaveURL(/\/grocery-list$/);
      await expect(list).toBeVisible();
    });
  });
}


test('a directly opened recipe aligns the last meal and filters do not replay the highlight', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.evaluate(seedMealList, { targetName, targetId, listName });
  await page.evaluate(async id => {
    const { db } = await import('/src/db/db.ts');
    await db.meals.where('id').above(id).delete();
  }, targetId);
  await page.goto(`/recipe/${targetId}`);
  await expect(page.getByRole('heading', { name: `Recipe for ${targetName}` })).toBeVisible();
  await page.getByTestId('ArrowBackIcon').click();
  await assertHighlightedMeal(page, testInfo.outputPath('last-meal.png'));
  const { width, height } = page.viewportSize();
  await page.setViewportSize({ width, height: height + 150 });
  await assertHighlightedMeal(page);
  const summary = mealSummary(page);
  const accordion = summary.locator('xpath=../..');
  await expect(accordion).not.toHaveCSS('background-color', 'rgb(255, 255, 0)');

  const search = page.getByRole('textbox', { name: 'Search Meals', exact: true });
  await search.fill('Apple');
  await expect(summary).toHaveCount(0);
  await search.clear();
  await expect(summary).toBeVisible();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(accordion).not.toHaveCSS('background-color', 'rgb(255, 255, 0)');
});
