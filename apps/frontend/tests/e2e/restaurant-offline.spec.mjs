import { test, expect } from '@playwright/test';
import { join } from 'node:path';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=',
  'base64'
);
test('installed PWA offline restaurant deep-route CRUD, ratings, photos and setting', async ({
  page,
  context,
}) => {
  test.skip(process.env.GG_PWA_PHASE !== 'true', 'Runs only against the owned built PWA server');
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === 'http://127.0.0.1:18926'
      ? route.continue()
      : route.abort()
  );
  await page.setViewportSize({ width: 360, height: 844 });
  await page.goto('/restaurants');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })
      );
  });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const keys = await caches.keys();
        return keys.filter((k) => k.includes('precache')).length;
      })
    )
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('textbox', { name: 'Restaurant name', exact: true }).fill('Offline kitchen');
  await page.getByRole('button', { name: 'Save restaurant', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Offline kitchen', exact: true })).toBeVisible();
  const route = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Add dish', exact: true }).click();
  await page.getByRole('textbox', { name: 'Dish name', exact: true }).fill('Offline soup');
  await page
    .getByLabel('Upload dish photos', { exact: true })
    .setInputFiles({ name: 'offline.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByAltText('Offline soup photo')).toBeVisible();
  await page.getByRole('button', { name: 'Save dish', exact: true }).click();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Offline soup', { exact: true })).toBeVisible();
  await expect
    .poll(() => page.getByAltText('Offline soup photo').evaluate((img) => img.naturalWidth))
    .toBeGreaterThan(0);
  expect(new URL(page.url()).pathname).toBe(route);
  await page.getByRole('button', { name: 'Pin Offline kitchen', exact: true }).click();
  // Evict only this fresh profile's synthetic bytes: metadata must remain editable offline.
  await page.evaluate(async () => {
    const request = indexedDB.open('groceriesHelper');
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = database.transaction('imageAssets', 'readwrite');
    tx.objectStore('imageAssets').clear();
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    database.close();
  });
  await page.reload();
  await expect(page.getByText('Image unavailable offline', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Offline soup', exact: true }).click();
  await page.getByRole('tab', { name: 'Opinions', exact: true }).click();
  await page.getByRole('button', { name: 'Add person', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Person name', { exact: true }).fill('Ben');
  await page.getByRole('button', { name: 'Save person', exact: true }).click();
  await page.getByRole('button', { name: 'Add rating', exact: true }).click();
  await page.getByLabel('Person', { exact: true }).click();
  await page.getByRole('option', { name: 'Ben', exact: true }).click();
  await page.getByLabel('Score / 10', { exact: true }).fill('9');
  await page.getByRole('button', { name: 'Save dish', exact: true }).click();
  await expect(page.getByText('Ben 9/10', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Show advanced restaurant fields', { exact: true }).click();
  await expect(page.getByLabel('Show advanced restaurant fields', { exact: true })).toBeChecked();
  await page.getByRole('link', { name: 'Restaurants', exact: true }).click();
  await page.getByLabel('Find restaurant, dish or place', { exact: true }).fill('Offline');
  await expect(page.getByRole('link', { name: 'Offline kitchen', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Offline kitchen', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Offline soup', exact: true }).click();
  await expect(page.getByLabel('Price', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.tsqd-open-btn-container').evaluateAll((elements) =>
    elements.forEach((el) => {
      el.style.display = 'none';
    })
  );
  await page.screenshot({
    path: join(process.env.REGRESSION_ARTIFACT_DIR, 'restaurant-offline-360.png'),
    fullPage: false,
  });
});
