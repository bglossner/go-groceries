import { expect, test } from '@playwright/test';
import { readFile, rename, symlink } from 'node:fs/promises';
import { join } from 'node:path';

const currentDist = process.env.GG_PWA_UPDATE_CURRENT_DIST;
const firstDist = process.env.GG_PWA_UPDATE_FIRST_DIST;
const nextDist = process.env.GG_PWA_UPDATE_NEXT_DIST;
const toast = (page) => page.getByText('A new version of the app is available.', { exact: true });
const restaurants = (page) => page.getByRole('heading', { name: 'Restaurants', exact: true });

test.skip(!currentDist || !firstDist || !nextDist, 'Run with npm run test:e2e -- --pwa-update-only');

async function publish(dist) {
  const nextLink = `${currentDist}.next`;
  await symlink(dist, nextLink);
  await rename(nextLink, currentDist);
}

async function setVisibility(page, state) {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

async function returnToForeground(page) {
  await setVisibility(page, 'hidden');
  await setVisibility(page, 'visible');
}

async function observeUpdateChecks(page) {
  await page.evaluate(() => {
    const update = ServiceWorkerRegistration.prototype.update;
    window.updateJobs = [];
    ServiceWorkerRegistration.prototype.update = function () {
      const result = update.call(this);
      window.updateJobs.push(result);
      return result;
    };
  });
}

async function expectUpdateChecks(page, count) {
  await expect.poll(() => page.evaluate(() => window.updateJobs.length)).toBe(count);
  await page.evaluate(async () => { await Promise.all(window.updateJobs); });
}

function loadedEntry(page) {
  return page.locator('script[type="module"][src]').getAttribute('src');
}

async function builtEntry(dist) {
  const html = await readFile(join(dist, 'index.html'), 'utf8');
  const entry = html.match(/<script\b[^>]*type="module"[^>]*src="([^"]+)"/)?.[1];
  expect(entry).toBeTruthy();
  return entry;
}

test.beforeEach(async ({ page, context, baseURL }) => {
  await publish(firstDist);
  await context.route('**/*', (route) => new URL(route.request().url()).origin === new URL(baseURL).origin
    ? route.continue() : route.abort());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/restaurants');
  await expect(restaurants(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
  await expect(toast(page)).toBeHidden();
});

test('a foregrounded PWA offers the new build and reloads once into it', async ({ page, context }) => {
  const firstEntry = await builtEntry(firstDist);
  const nextEntry = await builtEntry(nextDist);
  expect(await loadedEntry(page)).toBe(firstEntry);
  expect(nextEntry).not.toBe(firstEntry);

  const legacyCache = await page.evaluate(async () => {
    const { scope } = await navigator.serviceWorker.ready;
    const name = `workbox-runtime-${scope}`;
    await caches.open(name);
    return name;
  });
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });

  await test.step('publish the second build and return to the foreground', async () => {
    await publish(nextDist);
    await observeUpdateChecks(page);
    await context.setOffline(true);
    await returnToForeground(page);
    await expectUpdateChecks(page, 0);
    await context.setOffline(false);
    await setVisibility(page, 'hidden');
    await expectUpdateChecks(page, 0);
    await setVisibility(page, 'visible');
    await expect(toast(page), 'The next build should prompt without a navigation').toBeVisible({ timeout: 10_000 });
    await returnToForeground(page);
    await expectUpdateChecks(page, 1);
    await expect(toast(page)).toHaveCount(1);
    expect(navigations).toBe(0);
    expect(await loadedEntry(page)).toBe(firstEntry);
    expect(await page.evaluate((name) => caches.has(name), legacyCache)).toBe(true);
    await page.screenshot({ path: join(process.env.REGRESSION_ARTIFACT_DIR, 'pwa-update-toast-phone.png') });
  });

  await test.step('activate with Reload and verify the new build', async () => {
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect.poll(() => loadedEntry(page)).toBe(nextEntry);
    await expect(restaurants(page)).toBeVisible();
    await expect.poll(() => page.evaluate((name) => caches.has(name), legacyCache)).toBe(false);
    expect(navigations).toBe(1);
  });

  await test.step('check the same build and open it offline', async () => {
    await observeUpdateChecks(page);
    await returnToForeground(page);
    await expectUpdateChecks(page, 1);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).waiting)).toBeNull();
    await expect(toast(page)).toBeHidden();
    expect(navigations).toBe(1);

    await context.setOffline(true);
    await page.reload();
    await expect(restaurants(page)).toBeVisible();
    expect(await loadedEntry(page)).toBe(nextEntry);
    await expect(toast(page)).toBeHidden();
    expect(navigations).toBe(2);
  });
});

test('turning off notifications in another tab leaves the next worker waiting until all tabs close', async ({ page, context }) => {
  await setVisibility(page, 'hidden');
  const settingsPage = await context.newPage();
  await settingsPage.goto('/settings');
  const setting = settingsPage.getByRole('checkbox', { name: 'Show PWA Update Notifications' });
  await expect(setting).toBeChecked();
  await setting.click();
  await expect(setting).not.toBeChecked();
  const nextWorker = context.waitForEvent('serviceworker');
  await publish(nextDist);
  await returnToForeground(settingsPage);
  const waiting = await nextWorker;
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).waiting?.state)).toBe('installed');
  await Promise.all([page, settingsPage].map(tab =>
    expect(toast(tab).waitFor({ state: 'visible', timeout: 500 })).rejects.toThrow('Timeout'),
  ));
  expect(await loadedEntry(page)).toBe(await builtEntry(firstDist));

  await setting.click();
  await expect(setting).toBeChecked();
  await expect(toast(page)).toBeVisible();
  await expect(toast(page)).toHaveCount(1);
  expect(await loadedEntry(page)).toBe(await builtEntry(firstDist));

  await Promise.all([page.close(), settingsPage.close()]);
  await expect.poll(() => waiting.evaluate(() => self.registration.active?.state === 'activated' && !self.registration.waiting)).toBe(true);
  const reopened = await context.newPage();
  await reopened.goto('/restaurants');
  await expect(restaurants(reopened)).toBeVisible();
  expect(await loadedEntry(reopened)).toBe(await builtEntry(nextDist));
  await expect(toast(reopened)).toBeHidden();
});
