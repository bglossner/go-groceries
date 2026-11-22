import { expect, test } from '@playwright/test';

const worker = 'http://127.0.0.1:18927';
const frontend = 'http://127.0.0.1:18926';

for (const scenario of ['mislabelled', 'oversized', '48-megapixel', 'pending', 'undecodable']) {
  test(`sync photo preflight handles ${scenario} photos`, async ({ page, context, request }) => {
    await context.route('**/*', route => [frontend, worker].includes(new URL(route.request().url()).origin)
      ? route.continue() : route.abort());
    await context.routeWebSocket('**/*', socket => socket.close());
    await page.goto('/settings');
    const result = await page.evaluate(async scenario => {
      const { db } = await import('/src/db/db.ts');
      const { cacheImage, hashBlob } = await import('/src/db/image-cache.ts');
      const { syncTo } = await import('/src/util/sync.ts');
      const { freezeSnapshot } = await import('/src/util/sync/snapshot-adapter.ts');
      const { makeAsset } = await import('/src/util/sync/snapshot-validation.ts');
      const makePhoto = async (w, h, color, type) => {
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
        return new Promise(resolve => canvas.toBlob(resolve, type));
      };
      const now = new Date();
      await db.settings.put({ id: 'youtubeApiPass', value: 'test-writer-pass' });
      const controls = [];
      for (const color of ['red', 'green', 'blue']) controls.push(await cacheImage(await makePhoto(16, 16, color, 'image/png')));
      const webp = await makePhoto(16, 16, 'yellow', 'image/webp');
      let photo = new Blob([webp], { type: 'image/jpeg' });
      if (scenario === 'oversized') photo = await makePhoto(5000, 3500, 'yellow', 'image/jpeg');
      if (scenario === '48-megapixel') {
        const jpeg = await makePhoto(8000, 6000, 'yellow', 'image/jpeg');
        // APP1 EXIF with a single big-endian TIFF orientation entry (rotate 90° clockwise).
        const exif = Uint8Array.of(0xff, 0xe1, 0, 34, 69, 120, 105, 102, 0, 0, 77, 77, 0, 42,
          0, 0, 0, 8, 0, 1, 1, 18, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0);
        photo = new Blob([jpeg.slice(0, 2), exif, jpeg.slice(2)], { type: 'image/jpeg' });
      }
      if (scenario === 'undecodable') {
        // Structurally valid PNG with invalid compressed pixel data. The browser must try decoding it.
        const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII='), c => c.charCodeAt(0));
        bytes.fill(0, 41, bytes.length - 16);
        photo = new Blob([bytes], { type: 'image/png' });
      }
      const original = await cacheImage(photo);
      await db.meals.put({ id: 1, name: 'Evening soup', ingredients: [], createdAt: now, updatedAt: now,
        images: [{ type: 'recipeImage', recipeId: 1, imageIndex: 2, isThumbnail: true }] });
      await db.recipes.put({ id: 1, mealId: 1, url: '', notes: '', images: controls });
      let staleId, expectedRevision;
      if (scenario === 'pending') {
        await syncTo({ automatic: false });
        const writer = await db.syncs.where('type').equals('to').first();
        staleId = crypto.randomUUID();
        expectedRevision = writer.revision;
        const { snapshot } = await freezeSnapshot(writer.collectionId, staleId);
        snapshot.data.tables.recipes[0].images.push(original);
        snapshot.assets.push(makeAsset(writer.collectionId, { sha256: original.assetId, byteLength: photo.size, mimeType: photo.type }));
        await db.syncs.update(writer.id, { pendingPublication: { snapshot, expectedRevision } });
      }
      const localImages = scenario === 'undecodable'
        ? [controls[0], original, controls[1], controls[2]] : [...controls, original];
      await db.recipes.update(1, { images: localImages, notes: 'Current recipe' });
      const progress = [];
      let error, publishedRevision;
      const originalFetch = window.fetch;
      window.fetch = (input, init) => {
        if (String(input).endsWith('/v2/snapshots/publish')) publishedRevision = JSON.parse(init.body).expectedRevision;
        return originalFetch(input, init);
      };
      try { await syncTo({ automatic: false, onProgress: message => progress.push(message) }); }
      catch (cause) { error = cause.message; }
      finally { window.fetch = originalFetch; }
      const writer = await db.syncs.where('type').equals('to').first();
      const stored = await db.imageAssets.get(original.assetId);
      const retained = (await db.recipes.get(1)).images;
      return { error, progress, collectionId: writer.collectionId, snapshotId: writer.snapshotId, pending: !!writer.pendingPublication,
        originalId: original.assetId, originalMime: stored.mimeType, staleId, expectedRevision, publishedRevision,
        retained: retained.some(image => image.assetId === original.assetId) && await hashBlob(stored.blob) === original.assetId && stored.mimeType === photo.type };
    }, scenario);
    expect(result.error).toBeUndefined();
    expect(result.pending).toBe(false);
    expect(result.retained).toBe(true);
    const { snapshots } = await (await request.get(worker + '/__state')).json();
    const snapshot = snapshots.find(s => s.collectionId === result.collectionId && s.snapshotId === result.snapshotId);
    expect(snapshot).toBeDefined();
    expect(snapshot.data.tables.recipes[0].notes).toBe('Current recipe');
    if (scenario === 'undecodable') {
      expect(result.progress.at(-1)).toContain('Evening soup');
      expect(result.progress.at(-1)).toContain('could not be decoded');
      expect(snapshot.assets).toHaveLength(3);
      expect(snapshot.assets.some(asset => asset.assetId === result.originalId)).toBe(false);
      expect(snapshot.data.tables.meals[0].images[0].imageIndex).toBe(1);
      return;
    }
    expect(snapshot.assets).toHaveLength(4);
    const ref = snapshot.data.tables.recipes[0].images[3];
    const asset = snapshot.assets.find(asset => asset.assetId === ref.assetId);
    if (scenario === 'oversized' || scenario === '48-megapixel') {
      expect(ref.assetId).not.toBe(result.originalId);
      const dimensions = await page.evaluate(async assetId => {
        const { db } = await import('/src/db/db.ts');
        const bitmap = await createImageBitmap((await db.imageAssets.get(assetId)).blob);
        try { return [bitmap.width, bitmap.height]; } finally { bitmap.close(); }
      }, ref.assetId);
      expect(dimensions).toEqual(scenario === '48-megapixel' ? [1440, 1920] : [1920, 1344]);
      if (scenario === '48-megapixel') return;
      await page.reload();
      const next = await page.evaluate(async () => {
        const { db } = await import('/src/db/db.ts');
        const { syncTo } = await import('/src/util/sync.ts');
        await syncTo({ automatic: false });
        return (await db.syncs.where('type').equals('to').first()).snapshotId;
      });
      const { snapshots, events } = await (await request.get(worker + '/__state')).json();
      expect(snapshots.find(snapshot => snapshot.snapshotId === next).data.tables.recipes[0].images[3].assetId).toBe(ref.assetId);
      expect(events.filter(event => event.action === 'SIGNED_PUT' && event.key.includes(`/${result.collectionId}/`))).toHaveLength(4);
    } else {
      expect(asset.mimeType).toBe('image/webp');
      expect(ref.assetId).toBe(result.originalId);
      expect(result.originalMime).toBe('image/jpeg');
    }
    if (scenario === 'pending') {
      expect(result.snapshotId).not.toBe(result.staleId);
      expect(result.publishedRevision).toBe(result.expectedRevision);
    }
  });
}
