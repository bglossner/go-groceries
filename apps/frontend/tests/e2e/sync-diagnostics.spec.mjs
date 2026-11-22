import { expect, test } from '@playwright/test';

const worker = 'http://127.0.0.1:18927';
const frontend = 'http://127.0.0.1:18926';

test('Settings shows failed and successful runs, selectable reports and a confirmed clear', async ({ page, context }) => {
  await context.route('**/*', route => [frontend, worker].includes(new URL(route.request().url()).origin)
    ? route.continue() : route.abort());
  await context.routeWebSocket('**/*', socket => socket.close());
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) } });
  });
  await page.goto('/settings');
  const openLog = page.getByRole('button', { name: 'Sync log', exact: true });
  await openLog.click();
  await expect(page.getByText('No sync runs recorded yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Close sync log' }).click();
  await expect(openLog).toBeFocused();

  await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    const { cacheImage } = await import('/src/db/image-cache.ts');
    const canvas = document.createElement('canvas');
    canvas.width = 16; canvas.height = 12;
    canvas.getContext('2d').fillRect(0, 0, 16, 12);
    const photo = await cacheImage(await new Promise(resolve => canvas.toBlob(resolve, 'image/png')));
    const now = new Date();
    await db.settings.put({ id: 'youtubeApiPass', value: 'test-writer-pass' });
    await db.meals.put({ id: 1, name: 'Evening soup', ingredients: [], createdAt: now, updatedAt: now,
      images: [{ type: 'recipeImage', recipeId: 1, imageIndex: 0 }] });
    await db.recipes.put({ id: 1, mealId: 1, url: '', notes: '', images: [photo] });
  });
  const upload = worker + '/objects/**';
  await page.route(upload, route => route.abort('failed'));
  await page.getByRole('button', { name: 'Sync To Cloud' }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Upload interrupted for', { exact: false }).first()).toBeVisible();
  await page.unroute(upload);
  await openLog.click();
  const log = page.getByRole('dialog', { name: 'Sync log', exact: true });
  await expect(log.getByText('Upload image 1 of 1 · No response')).toBeVisible();
  const failure = log.getByRole('alert');
  await expect(failure.getByText('16 × 12 px')).toBeVisible();
  await expect(failure.getByText('Evening soup (+1 reference)')).toBeVisible();
  await log.getByRole('button', { name: 'Copy report' }).click();
  const fallback = page.getByRole('dialog', { name: 'Copy report', exact: true });
  const report = fallback.getByRole('textbox', { name: 'Selectable report' });
  await expect(report).toBeFocused();
  expect(await report.inputValue()).not.toContain('Evening soup');
  await fallback.getByRole('button', { name: 'Close' }).click();
  await log.getByRole('checkbox', { name: 'Include recipe and meal names' }).check();
  await log.getByRole('button', { name: 'Copy report' }).click();
  await expect(report).toBeVisible();
  expect(await report.inputValue()).toContain('Evening soup');
  await fallback.getByRole('button', { name: 'Close' }).click();
  await log.getByRole('button', { name: 'Close sync log' }).click();
  await page.getByRole('button', { name: 'Sync Now' }).click();
  await expect(page.getByText('Synced metadata;', { exact: false }).first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await openLog.click();
  await expect(log.getByText('Snapshot published')).toBeVisible();
  await expect(log.getByRole('button', { name: /Failed/ })).toBeVisible();
  await log.getByRole('button', { name: 'Clear log' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Clear sync log?' });
  await expect(confirmation.getByText('This removes all sync diagnostics saved on this device.')).toBeVisible();
  await confirmation.getByRole('button', { name: 'Clear log' }).click();
  await expect(log.getByText('No sync runs recorded yet.')).toBeFocused();
  await page.reload();
  await openLog.click();
  await expect(log.getByText('No sync runs recorded yet.')).toBeVisible();
  await page.evaluate(async () => {
    const { beginSyncRun } = await import('/src/util/sync/diagnostics.ts');
    const run = beginSyncRun('scheduled');
    run.acquired();
    for (let i = 0; i < 200; i++) run.start('prepare').finish('succeeded');
    run.start('commit').finish('failed');
    run.finish('failed');
  });
  await expect(log.getByText(/steps omitted to fit local history/)).toBeVisible();
  await expect(log.getByText('Commit metadata · Failed')).toBeVisible();
});
