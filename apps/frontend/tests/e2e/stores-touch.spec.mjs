import { devices, expect, test } from '@playwright/test';

test.use({ ...devices['Pixel 7'] });

test.beforeEach(async ({ context, page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  await context.route('**/*', route =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
  );
  await context.routeWebSocket('**/*', socket => socket.close());
  await page.goto('/manage-stores');
  await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    await db.customIngredients.bulkAdd([
      { name: 'carrot' },
      ...Array.from({ length: 24 }, (_, index) => ({ name: `ingredient ${index}` })),
    ]);
    await db.stores.add({ name: 'Test Market', color: '#1976d2' });
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Carrot', exact: true })).toBeVisible();
});

async function center(locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
}

async function dragTouch(page, context, source, target) {
  const session = await context.newCDPSession(page);
  const start = await center(source);
  const end = await center(target);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await expect(source).toHaveAttribute('aria-pressed', 'true');
    for (let step = 1; step <= 12; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{
          x: Math.round(start.x + (end.x - start.x) * step / 12),
          y: Math.round(start.y + (end.y - start.y) * step / 12),
        }],
      });
    }
  } finally {
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
  }
}

async function associations(page) {
  return page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    return (await db.ingredientStores.toArray()).map(({ ingredientName }) => ingredientName);
  });
}

test('touch drag assigns an ingredient to a store and removes it through trash', async ({ page, context }) => {
  const source = page.getByRole('button', { name: 'Carrot', exact: true });
  await dragTouch(page, context, source, page.getByText('Test Market', { exact: true }));
  await expect.poll(() => associations(page)).toEqual(['carrot']);

  const bucket = page.getByText('Test Market', { exact: true }).locator('../../..');
  const assigned = bucket.getByRole('button', { name: 'Carrot', exact: true });
  await expect(assigned).toBeVisible();
  await dragTouch(page, context, assigned, page.getByText('Drag ingredients here to remove from store'));
  await expect.poll(() => associations(page)).toEqual([]);
  await expect(assigned).toHaveCount(0);
});

test('a swipe starting on an ingredient scrolls the available ingredients', async ({ page, context }) => {
  const list = page.getByText('Available Ingredients', { exact: true }).locator('..');
  const source = page.getByRole('button', { name: 'Ingredient 10', exact: true });
  const start = await center(source);
  const session = await context.newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    for (let step = 1; step <= 6; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x: start.x, y: start.y - step * 18 }],
      });
    }
  } finally {
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
  }
  await expect.poll(() => list.evaluate(node => node.scrollTop)).toBeGreaterThan(50);
  expect(await associations(page)).toEqual([]);
});
