import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const frontend = 'http://127.0.0.1:18926';
const worker = 'http://127.0.0.1:18927';
const skipReason = 'Only JPEG, PNG and WebP photos can sync.';

async function setupWriter(page, context) {
  await context.route('**/*', route => [frontend, worker].includes(new URL(route.request().url()).origin)
    ? route.continue() : route.abort());
  await context.routeWebSocket('**/*', socket => socket.close());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings');
  await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    const now = new Date();
    await db.settings.put({ id: 'youtubeApiPass', value: 'test-writer-pass' });
    await db.transaction('rw', db.meals, db.recipes, async () => {
      await db.meals.put({ id: 1, name: 'Evening soup', ingredients: [], createdAt: now, updatedAt: now });
      await db.recipes.put({ id: 1, mealId: 1, url: '', notes: '', images: [] });
    });
  });
  await page.getByRole('button', { name: 'Sync To Cloud' }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('V2 sync location is set up.', { exact: false })).toBeVisible();
  const automatic = page.getByRole('checkbox', { name: 'Set up automatic syncs' });
  await automatic.check();
  await expect.poll(() => page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    return (await db.syncs.where('type').equals('to').first()).automatic;
  })).toBe(true);
}

async function editRecipe(page, notes, photoBytes) {
  return page.evaluate(async ({ notes, photoBytes }) => {
    const { db } = await import('/src/db/db.ts');
    const { cacheImage } = await import('/src/db/image-cache.ts');
    const changes = { notes };
    if (photoBytes !== undefined) {
      const blob = photoBytes === null
        ? await new Promise(resolve => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 16;
          canvas.getContext('2d').fillRect(0, 0, 16, 16);
          canvas.toBlob(resolve, 'image/png');
        })
        : new Blob([photoBytes], { type: 'image/png' });
      changes.images = [await cacheImage(blob)];
    }
    await db.recipes.update(1, changes);
    return changes.images?.[0].assetId;
  }, { notes, photoBytes });
}

const automaticRuns = page => page.evaluate(async () => {
  const { readSyncLog } = await import('/src/util/sync/diagnostics.ts');
  return readSyncLog().runs.filter(run => run.trigger === 'debounced' && run.endedAt !== undefined);
});

async function waitForAutomaticRun(page, count) {
  await expect.poll(async () => (await automaticRuns(page)).length, { timeout: 20000 }).toBe(count);
  return (await automaticRuns(page))[0];
}

async function capture(page, name) {
  const { SYNC_PHOTO_EVIDENCE_DIR: directory, SYNC_PHOTO_EVIDENCE_PHASE: phase } = process.env;
  if (directory && phase) await page.screenshot({ path: join(directory, `${phase}-${name}.png`), animations: 'disabled' });
}

test('automatic sync warns once about the same bad photo and logs every skip', async ({ page, context, request }) => {
  await setupWriter(page, context);
  const warning = page.getByRole('alert').filter({ hasText: 'Photo skipped for' });
  const firstId = await editRecipe(page, 'First edit', 'fixture one');
  const first = await waitForAutomaticRun(page, 1);
  await expect(warning).toContainText('Evening soup');
  await capture(page, 'first-photo-warning');
  await warning.getByRole('button', { name: 'Close' }).click();
  expect(first.steps.filter(step => step.kind === 'skipped').map(step => step.reason)).toEqual([skipReason]);

  await editRecipe(page, 'Second edit');
  const second = await waitForAutomaticRun(page, 2);
  await expect(page.getByRole('alert').filter({ hasText: 'Automatic sync [to] successful!' })).toBeVisible();
  expect(second.steps.filter(step => step.kind === 'skipped').map(step => step.reason)).toEqual([skipReason]);
  const secondWarningCount = await warning.count();
  console.log(`Auto sync 1 and 2 both logged the skip. Named alerts after auto sync 2: ${secondWarningCount}`);
  const openLog = page.getByRole('button', { name: 'Sync log', exact: true });
  await openLog.scrollIntoViewIfNeeded();
  await capture(page, 'second-auto-sync');
  expect(secondWarningCount).toBe(0);

  await page.getByRole('button', { name: 'Open sync log for skipped photos' }).click();
  const log = page.getByRole('dialog', { name: 'Sync log', exact: true });
  await expect(log.getByRole('button', { name: /Automatic/ })).toHaveCount(2);
  await log.getByRole('button', { name: /Run steps/ }).click();
  await expect(log.getByText(skipReason)).toBeVisible();
  await log.getByText(skipReason).evaluate(element => element.scrollIntoView({ block: 'center' }));
  await expect(log.getByText(skipReason)).toBeInViewport();
  await capture(page, 'repeated-skip-log');
  await log.getByRole('button', { name: 'Close sync log' }).click();

  const newId = await editRecipe(page, 'New bad photo', 'fixture two');
  expect(newId).not.toBe(firstId);
  await waitForAutomaticRun(page, 3);
  await expect(warning).toContainText(skipReason);
  await warning.getByRole('button', { name: 'Close' }).click();

  const replacement = await editRecipe(page, 'Valid replacement', null);
  const fourth = await waitForAutomaticRun(page, 4);
  expect(fourth.steps.some(step => step.kind === 'skipped')).toBe(false);
  const { snapshots } = await (await request.get(worker + '/__state')).json();
  expect(snapshots.some(snapshot => snapshot.data.tables.recipes.some(recipe => recipe.notes === 'Valid replacement' &&
    recipe.images.some(image => image.assetId === replacement)))).toBe(true);
  await expect.poll(() => page.evaluate(async assetId => {
    const { db } = await import('/src/db/db.ts');
    return Boolean(await db.imageAssets.get(assetId));
  }, firstId)).toBe(true);
  console.log('A new invalid photo raised a named alert. A valid replacement published, and the original stayed cached.');
});
