import Dexie from 'dexie';
import { expect, test, vi } from 'vitest';
import { db, MySubClassedDexie, INCLUDE_TABLES } from '../src/db/db.ts';
import { cleanDatabase, image, meal } from './helpers.mjs';
import {
  saveRestaurant,
  saveDish,
  deleteRestaurant,
  deleteDish,
  savePerson,
  archivePerson,
  erasePerson,
  seedRestaurantTags,
  impliedTags,
  ratingSummary,
  selectRestaurants,
  readRestaurantData,
} from '../src/db/restaurants.ts';
import { restaurantSchema, itemSchema, ratingSchema, mapsUrl } from '../src/types/restaurants.ts';
import { cacheImage, getReferencedAssetIds } from '../src/db/image-cache.ts';
import { getExportBlob } from '../src/util/db/export.ts';
import { handleFileImport, getTemporaryDB, getRestaurantDiffs } from '../src/util/db/import.ts';
import {
  freezeSnapshot,
  stageSnapshot,
  localMetadataDigest,
} from '../src/util/sync/snapshot-adapter.ts';
import { canonicalJson, parseSnapshot } from '../src/util/sync/snapshot-validation.ts';
import { parseSnapshot as workerParse } from '../../go-groceries-images-meal-resolver/src/image-storage/validation.ts';
import { createApp } from '../../go-groceries-images-meal-resolver/src/index.ts';
import { createStorage } from '../../../test/memory-storage.mjs';
cleanDatabase();
const time = '2020-01-01T00:00:00.000Z';
const restaurant = (changes = {}) => ({
  name: 'Kumo',
  notes: 'Quiet\nat lunch',
  tags: [],
  isPinned: false,
  countryKey: '',
  regionKey: '',
  cityKey: '',
  createdAt: time,
  updatedAt: time,
  ...changes,
});
const dish = (restaurantId, changes = {}) => ({
  restaurantId,
  name: 'Ramen',
  description: 'Mushroom broth',
  notes: 'Ask for broth',
  images: [],
  dietaryFlags: [],
  createdAt: time,
  updatedAt: time,
  ...changes,
});
const rating = (personId, score, changes = {}) => ({
  itemId: 1,
  personId,
  score,
  createdAt: time,
  updatedAt: time,
  ...changes,
});
async function seed() {
  await seedRestaurantTags();
  const tag = (await db.restaurantTags.where('normalizedName').equals('only vegan').first()).id;
  const rid = await saveRestaurant(
    restaurant({
      country: 'United Kingdom',
      region: 'England',
      city: 'London',
      latitude: 0,
      longitude: 0,
      googleMapsUrl: 'https://maps.google.com/?q=0,0',
    }),
    ['Only vegan']
  );
  const ben = await savePerson('Ben');
  const sarah = await savePerson('Sarah');
  const ref = await cacheImage(image());
  const itemId = await saveDish(
    dish(rid, { images: [ref], coverImageIndex: 0, priceAmount: '10.00', currency: 'GBP' }),
    [rating(ben, 9), rating(sarah, 8)]
  );
  return { rid, itemId, ben, sarah, ref, tag };
}
test('v15 -> v16 only adds stores and preserves every old table and bytes', async () => {
  const current = new MySubClassedDexie(true);
  const old = new Dexie(current.name);
  const feature = [
    'restaurants',
    'restaurantTags',
    'restaurantItems',
    'people',
    'restaurantItemRatings',
  ];
  old
    .version(15)
    .stores(
      Object.fromEntries(
        db.tables
          .filter((t) => !feature.includes(t.name))
          .map((t) => [
            t.name,
            t.schema.primKey.src +
              (t.schema.indexes.length ? ',' + t.schema.indexes.map((i) => i.src).join(',') : ''),
          ])
      )
    );
  await old.open();
  await old.table('meals').put(meal());
  await old.table('settings').put({ id: 'youtubeApiPass', value: 'synthetic' });
  await old.table('imageAssets').put({ assetId: 'test', blob: image() });
  const before = Object.fromEntries(
    await Promise.all(old.tables.map(async (t) => [t.name, await t.toArray()]))
  );
  old.close();
  try {
    await current.open();
    expect(current.verno).toBe(16);
    for (const [name, rows] of Object.entries(before))
      expect(await current.table(name).toArray()).toEqual(rows);
    for (const name of feature) expect(await current.table(name).count()).toBe(0);
  } finally {
    await current.delete();
  }
});
test('restaurant CRUD trims, preserves createdAt and cascades ratings while retaining tags, people and shared cache', async () => {
  const s = await seed();
  const saved = await db.restaurants.get(s.rid);
  await saveRestaurant({ ...saved, name: ' Updated ' });
  expect(await db.restaurants.get(s.rid)).toMatchObject({ name: 'Updated', createdAt: time });
  await deleteRestaurant(s.rid);
  expect(await db.restaurantItems.count()).toBe(0);
  expect(await db.restaurantItemRatings.count()).toBe(0);
  expect(await db.people.count()).toBe(2);
  expect(await db.imageAssets.count()).toBe(1);
  expect(await db.restaurantTags.count()).toBeGreaterThan(0);
});
test('scoped location spelling, missing state, accent preservation and aliases', async () => {
  const a = await saveRestaurant(restaurant({ country: ' Canada ', city: ' Toronto ' }));
  const b = await saveRestaurant(restaurant({ country: 'canada', city: 'toronto' }));
  expect(await db.restaurants.get(b)).toMatchObject({
    country: 'Canada',
    city: 'Toronto',
    countryKey: 'canada',
    regionKey: '',
    cityKey: 'toronto',
  });
  const c = await saveRestaurant(
    restaurant({ country: 'Germany', region: 'Ontario', city: 'TORONTO' })
  );
  expect((await db.restaurants.get(c)).city).toBe('TORONTO');
  await expect(saveRestaurant(restaurant({ city: 'London' }))).rejects.toThrow();
  expect((await db.restaurants.get(a)).createdAt).toBe(time);
});
test('tags seed idempotently, reuse custom names and implement only explicit dietary implications', async () => {
  await seedRestaurantTags();
  const count = await db.restaurantTags.count();
  await seedRestaurantTags();
  expect(await db.restaurantTags.count()).toBe(count);
  const id = await saveRestaurant(restaurant(), [' Hidden Gem ']);
  await saveRestaurant({ ...(await db.restaurants.get(id)) }, ['hidden gem']);
  expect(await db.restaurantTags.where('normalizedName').equals('hidden gem').count()).toBe(1);
  expect([...impliedTags(['Only vegan'])].sort()).toEqual([
    'only vegan',
    'only vegetarian',
    'vegan options',
    'vegetarian options',
  ]);
  expect(impliedTags(['Vegetarian options']).has('only vegetarian')).toBe(false);
  await expect(saveRestaurant(restaurant(), ['Budget', 'Treat/splurge'])).rejects.toThrow();
});
test('ratings require half points, unique pairs, active new people; archive/rename/erase recalculate means', async () => {
  const s = await seed();
  expect(ratingSummary(await db.restaurantItemRatings.toArray())).toEqual({ count: 2, mean: 8.5 });
  await archivePerson(s.ben, true);
  expect(ratingSummary(await db.restaurantItemRatings.toArray()).mean).toBe(8.5);
  await savePerson('Benjamin', s.ben);
  expect((await db.people.get(s.ben)).name).toBe('Benjamin');
  await expect(savePerson('SARAH')).rejects.toThrow();
  await expect(
    saveDish(await db.restaurantItems.get(s.itemId), [rating(s.sarah, 8), rating(s.sarah, 9)])
  ).rejects.toThrow('One rating');
  expect(await db.restaurantItemRatings.count()).toBe(2);
  await erasePerson(s.ben);
  expect(ratingSummary(await db.restaurantItemRatings.toArray())).toEqual({ count: 1, mean: 8 });
  for (const score of [0, 10.5, 8.25, NaN])
    expect(ratingSchema.safeParse(rating(s.sarah, score)).success).toBe(false);
});
test('strict field, coordinate, Maps, price, calendar and image validation', () => {
  for (const name of ['', '  ', 'x'.repeat(201)])
    expect(restaurantSchema.safeParse(restaurant({ name })).success).toBe(false);
  expect(restaurantSchema.safeParse(restaurant({ latitude: 0, longitude: 0 })).success).toBe(true);
  for (const changes of [
    { latitude: 0 },
    { latitude: 91, longitude: 0 },
    { latitude: NaN, longitude: 0 },
    { latitude: 0, longitude: Infinity },
  ])
    expect(restaurantSchema.safeParse(restaurant(changes)).success).toBe(false);
  for (const url of [
    'javascript:alert(1)',
    'http://maps.google.com',
    'https://user:pass@example.invalid',
  ])
    expect(mapsUrl.safeParse(url).success).toBe(false);
  for (const changes of [
    { priceAmount: '8.333', currency: 'GBP' },
    { priceAmount: '10' },
    { lastOrderedDate: '2026-02-30' },
    { images: [], coverImageIndex: 0 },
  ])
    expect(itemSchema.safeParse(dish(1, changes)).success).toBe(false);
});
test('AND filtering, implied tags, pins-first, person threshold, missing locations and exact drill-down', async () => {
  const s = await seed();
  const empty = await saveRestaurant(restaurant({ name: 'No location', isPinned: true }));
  const other = await saveRestaurant(
    restaurant({ name: 'Other', country: 'Canada', city: 'London' })
  );
  const data = await readRestaurantData();
  const base = { search: '', tags: [], sort: 'name', threshold: false, minimum: 8 };
  const select = (f) =>
    selectRestaurants(
      data.restaurants,
      data.restaurantItems,
      data.restaurantItemRatings,
      data.restaurantTags,
      { ...base, ...f }
    );
  expect(select({})[0].restaurant.id).toBe(empty);
  expect(
    select({
      country: 'united kingdom',
      region: 'england',
      city: 'london',
      personId: s.ben,
      threshold: true,
      tags: [s.tag],
      search: 'Ramen',
    }).map((r) => r.restaurant.id)
  ).toEqual([s.rid]);
  expect(select({ personId: s.ben, threshold: true, minimum: 9.5 })).toHaveLength(0);
  expect(select({ country: '' }).map((r) => r.restaurant.id)).toEqual([empty]);
  expect(select({ country: 'canada', city: 'london' }).map((r) => r.restaurant.id)).toEqual([
    other,
  ]);
});
test('dish/menu-only images survive schema16 and portable round trips, settings remain local', async () => {
  const s = await seed();
  await db.restaurants.update(s.rid, { menuImages: [s.ref], isPinned: true });
  await db.settings.put({ id: 'showAdvancedRestaurantFields', value: 'true' });
  expect(await getReferencedAssetIds()).toEqual(new Set([s.ref.assetId]));
  const frozen = await freezeSnapshot(crypto.randomUUID(), crypto.randomUUID());
  expect(frozen.snapshot.data.schemaVersion).toBe(16);
  expect(workerParse(frozen.snapshot)).toEqual(parseSnapshot(frozen.snapshot));
  const staged = await stageSnapshot(frozen.snapshot);
  try {
    expect(await staged.temporary.restaurantItemRatings.count()).toBe(2);
  } finally {
    await staged.temporary.delete();
  }
  const backup = await getExportBlob();
  await deleteRestaurant(s.rid);
  await handleFileImport(backup);
  expect((await db.restaurants.get(s.rid)).isPinned).toBe(true);
  expect((await db.restaurantItems.get(s.itemId)).priceAmount).toBe('10.00');
  expect((await db.settings.get('showAdvancedRestaurantFields')).value).toBe('true');
  expect(await db.restaurantItemRatings.count()).toBe(2);
});
test('old15/1 read supplies empty feature tables; unsupported/missing versions retain data', async () => {
  const s = await seed();
  const frozen = await freezeSnapshot(crypto.randomUUID(), crypto.randomUUID());
  const old = structuredClone(frozen.snapshot);
  old.data = {
    schemaVersion: 15,
    adapterVersion: 1,
    tables: Object.fromEntries(
      Object.entries(old.data.tables).filter(
        ([name]) =>
          ![
            'restaurants',
            'restaurantTags',
            'restaurantItems',
            'people',
            'restaurantItemRatings',
          ].includes(name)
      )
    ),
  };
  old.assets = [];
  const stage = await stageSnapshot(old);
  try {
    expect(await stage.temporary.restaurants.count()).toBe(0);
    expect(
      (await getRestaurantDiffs(db, stage.temporary)).find((r) => r.table === 'restaurants').removed
    ).toBe(1);
  } finally {
    await stage.temporary.delete();
  }
  const future = structuredClone(frozen.snapshot);
  future.data.schemaVersion = 17;
  expect(() => parseSnapshot(future)).toThrow();
  expect(() => workerParse(future)).toThrow();
  const malformed = structuredClone(frozen.snapshot);
  delete malformed.data.tables.people;
  expect(() => parseSnapshot(malformed)).toThrow();
  expect(await db.restaurants.get(s.rid)).toBeDefined();
});
test('both validators reject relationship, name-key, coordinate and rating malformations', async () => {
  await seed();
  const { snapshot } = await freezeSnapshot(crypto.randomUUID(), crypto.randomUUID());
  for (const mutate of [
    (v) => (v.data.tables.restaurantItems[0].restaurantId = 999),
    (v) => (v.data.tables.restaurants[0].countryKey = 'wrong'),
    (v) => (v.data.tables.people[0].normalizedName = 'wrong'),
    (v) => (v.data.tables.restaurantItemRatings[0].score = 8.25),
    (v) =>
      v.data.tables.restaurantItemRatings.push({
        ...v.data.tables.restaurantItemRatings[0],
        id: 900,
      }),
    (v) =>
      (v.data.tables.restaurants[0].menuImages = [
        { kind: 'externalUrl', url: 'https://example.invalid' },
      ]),
  ]) {
    const bad = structuredClone(snapshot);
    mutate(bad);
    expect(() => parseSnapshot(bad)).toThrow();
    expect(() => workerParse(bad)).toThrow();
  }
});
test('digest catches pin/location/hidden/rating/person/bulk deletes', async () => {
  const s = await seed();
  let previous = await localMetadataDigest();
  for (const action of [
    () => db.restaurants.update(s.rid, { isPinned: true }),
    () => db.restaurants.update(s.rid, { address: 'New address' }),
    () => db.restaurantItems.update(s.itemId, { priceAmount: '12' }),
    () => db.restaurantItemRatings.toCollection().modify({ score: 7 }),
    () => savePerson('Benjamin', s.ben),
    () => db.restaurantItemRatings.toCollection().delete(),
  ]) {
    await action();
    const next = await localMetadataDigest();
    expect(next).not.toBe(previous);
    previous = next;
  }
  await db.settings.put({ id: 'showAdvancedRestaurantFields', value: 'true' });
  expect(await localMetadataDigest()).toBe(previous);
});
test('Worker rejects old commit and already committed old publication after16, even with current revision', async () => {
  const storage = createStorage();
  const app = createApp({ client: () => storage.client, sign: storage.sign, now: Date.now });
  const collectionId = crypto.randomUUID();
  const old = {
    format: 'go-groceries-snapshot',
    version: 2,
    collectionId,
    snapshotId: crypto.randomUUID(),
    assets: [],
    data: {
      schemaVersion: 15,
      adapterVersion: 1,
      tables: Object.fromEntries(
        [
          'meals',
          'groceryLists',
          'groceryListStates',
          'recipes',
          'tags',
          'customIngredients',
          'pendingRecipes',
          'stores',
          'ingredientStores',
        ].map((t) => [t, []])
      ),
    },
  };
  const call = async (path, body) =>
    app.fetch(
      new Request('http://127.0.0.1:18927/v2/' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pass: storage.env.PASS, ...body }),
      }),
      storage.env
    );
  expect((await call('snapshots/commit', { snapshot: old })).status).toBe(200);
  const { snapshot } = await freezeSnapshot(collectionId, crypto.randomUUID());
  expect((await call('snapshots/commit', { snapshot })).status).toBe(200);
  const published = await call('snapshots/publish', {
    collectionId,
    snapshotId: snapshot.snapshotId,
    expectedRevision: null,
  });
  expect(published.status).toBe(200);
  const head = await published.json();
  expect((await call('snapshots/commit', { snapshot: old })).status).toBe(409);
  expect(
    (
      await call('snapshots/publish', {
        collectionId,
        snapshotId: old.snapshotId,
        expectedRevision: head.revision,
      })
    ).status
  ).toBe(409);
  expect(await (await call('snapshots/latest', { collectionId })).json()).toEqual(head);
  expect((await call('snapshots/read', { collectionId, snapshotId: old.snapshotId })).status).toBe(
    200
  );
});

test('canonical byte, asset and total-row cloud boundaries agree in both validators', () => {
  const collectionId = crypto.randomUUID();
  const base = {
    format: 'go-groceries-snapshot',
    version: 2,
    collectionId,
    snapshotId: crypto.randomUUID(),
    assets: [],
    data: {
      schemaVersion: 16,
      adapterVersion: 2,
      tables: Object.fromEntries(
        [
          'meals',
          'groceryLists',
          'groceryListStates',
          'recipes',
          'tags',
          'customIngredients',
          'pendingRecipes',
          'stores',
          'ingredientStores',
          'restaurants',
          'restaurantTags',
          'restaurantItems',
          'people',
          'restaurantItemRatings',
        ].map((t) => [t, []])
      ),
    },
  };
  const bytes = structuredClone(base);
  bytes.data.tables.meals = Array.from({ length: 8 }, (_, i) => ({
    ...meal(i + 1),
    createdAt: time,
    updatedAt: time,
    recipe: 'x'.repeat(256 * 1024),
  }));
  const over = new Blob([canonicalJson(bytes)]).size - 2 * 1024 * 1024;
  bytes.data.tables.meals[7].recipe = bytes.data.tables.meals[7].recipe.slice(over);
  expect(new Blob([canonicalJson(bytes)]).size).toBe(2 * 1024 * 1024);
  expect(() => parseSnapshot(bytes)).not.toThrow();
  expect(() => workerParse(bytes)).not.toThrow();
  bytes.data.tables.meals[7].recipe += 'x';
  expect(() => parseSnapshot(bytes)).toThrow();
  expect(() => workerParse(bytes)).toThrow();
  const rows = structuredClone(base);
  rows.data.tables.restaurantTags = Array.from({ length: 10000 }, (_, i) => ({
    id: i + 1,
    name: 'Tag ' + i,
    normalizedName: 'tag ' + i,
    group: 'custom',
  }));
  expect(() => parseSnapshot(rows)).not.toThrow();
  expect(() => workerParse(rows)).not.toThrow();
  rows.data.tables.people.push({
    id: 1,
    name: 'Ben',
    normalizedName: 'ben',
    status: 'active',
    createdAt: time,
    updatedAt: time,
  });
  expect(() => parseSnapshot(rows)).toThrow();
  expect(() => workerParse(rows)).toThrow();
  const assets = structuredClone(base);
  for (let i = 0; i < 512; i++) {
    const hash = (i + 1).toString(16).padStart(64, '0');
    assets.assets.push({
      assetId: hash,
      sha256: hash,
      mimeType: 'image/png',
      byteLength: 1,
      location: { provider: 'r2', key: `collections/${collectionId}/images/sha256/${hash}` },
    });
  }
  assets.data.tables.meals = Array.from({ length: 6 }, (_, i) => ({
    ...meal(i + 1),
    createdAt: time,
    updatedAt: time,
    images: assets.assets
      .slice(i * 100, (i + 1) * 100)
      .map((a) => ({ kind: 'asset', assetId: a.assetId })),
  }));
  expect(() => parseSnapshot(assets)).not.toThrow();
  expect(() => workerParse(assets)).not.toThrow();
  const extra = structuredClone(assets.assets[0]);
  extra.assetId = extra.sha256 = 'f'.repeat(64);
  extra.location.key = `collections/${collectionId}/images/sha256/${extra.sha256}`;
  assets.assets.push(extra);
  assets.data.tables.meals[5].images.push({ kind: 'asset', assetId: extra.assetId });
  expect(() => parseSnapshot(assets)).toThrow();
  expect(() => workerParse(assets)).toThrow();
});
test('hidden menu-only asset is reachable independently, backups preserve it and invalid restore is atomic', async () => {
  const rid = await saveRestaurant(restaurant());
  const ref = await cacheImage(
    new File([image(), 'extra menu bytes'], 'menu.png', { type: 'image/png' })
  );
  await db.restaurants.update(rid, { menuImages: [ref] });
  expect(await db.restaurantItems.count()).toBe(0);
  expect(await getReferencedAssetIds()).toEqual(new Set([ref.assetId]));
  const { snapshot } = await freezeSnapshot(crypto.randomUUID(), crypto.randomUUID());
  expect(snapshot.assets.map((a) => a.assetId)).toEqual([ref.assetId]);
  expect(workerParse(snapshot).assets).toHaveLength(1);
  const backup = await getExportBlob();
  await db.restaurants.clear();
  await handleFileImport(backup);
  expect((await db.restaurants.get(rid)).menuImages).toEqual([ref]);
  const value = JSON.parse(await backup.text());
  const row = value.data.data.find((t) => t.tableName === 'restaurants').rows[0];
  delete row.id;
  const before = await db.restaurants.toArray();
  await expect(handleFileImport(new Blob([JSON.stringify(value)]))).rejects.toThrow('ID');
  expect(await db.restaurants.toArray()).toEqual(before);
});
test('failed rating save and newly added uncached image retain saved rows', async () => {
  const s = await seed();
  const before = await db.restaurantItems.get(s.itemId);
  await expect(
    saveDish({ ...before, name: 'Should roll back' }, [rating(s.sarah, 8), rating(s.sarah, 9)])
  ).rejects.toThrow();
  expect(await db.restaurantItems.get(s.itemId)).toEqual(before);
  await db.imageAssets.delete(s.ref.assetId);
  await expect(
    saveDish(
      {
        ...before,
        name: 'Should also roll back',
        images: [...before.images, { kind: 'asset', assetId: 'f'.repeat(64) }],
      },
      []
    )
  ).rejects.toThrow('Photo is missing');
  expect(await db.restaurantItems.get(s.itemId)).toEqual(before);
});

test('rated sorting uses personal scores, unrounded means, stable ties and pins within filters', () => {
  const restaurants = [
    restaurant({ id: 1, name: 'Pinned', isPinned: true }),
    restaurant({ id: 2, name: 'Z highest mean' }),
    restaurant({ id: 3, name: 'A lower mean' }),
    restaurant({ id: 4, name: 'Unrated' }),
  ];
  const items = [
    dish(1, { id: 1, name: 'First' }),
    dish(1, { id: 2, name: 'Second' }),
    dish(2, { id: 3 }),
    dish(3, { id: 4 }),
  ];
  const ratings = [
    rating(1, 9, { id: 1, itemId: 1 }),
    rating(2, 1, { id: 2, itemId: 1 }),
    rating(1, 8, { id: 3, itemId: 2 }),
    rating(2, 9, { id: 4, itemId: 2 }),
    ...[8, 8.5, 8.5].map((score, i) => rating(i + 1, score, { id: 10 + i, itemId: 3 })),
    ...[8, 8, 8.5, 8.5, 8.5].map((score, i) => rating(i + 1, score, { id: 20 + i, itemId: 4 })),
  ];
  const filters = { search: '', tags: [], sort: 'rated', threshold: false, minimum: 8 };
  const household = selectRestaurants(restaurants, items, ratings, [], filters);
  expect(household.map((r) => r.restaurant.id)).toEqual([1, 2, 3, 4]);
  expect(household[1].score.toFixed(1)).toBe(household[2].score.toFixed(1));
  expect(household[1].score).toBeGreaterThan(household[2].score);
  expect(
    selectRestaurants(restaurants, items, ratings, [], { ...filters, personId: 1 })[0].best.id
  ).toBe(1);
  expect(
    selectRestaurants(restaurants, items, ratings, [], { ...filters, personId: 2 })[0].best.id
  ).toBe(2);
  expect(
    selectRestaurants(restaurants, items, ratings, [], { ...filters, search: 'mean' }).map(
      (r) => r.restaurant.id
    )
  ).toEqual([2, 3]);
});

test('review R9: retained dish and hidden menu references allow offline edits and ratings without cached bytes', async () => {
  const s = await seed();
  await db.restaurants.update(s.rid, { menuImages: [s.ref] });
  await db.imageAssets.clear();
  await saveRestaurant({ ...(await db.restaurants.get(s.rid)), notes: 'Offline restaurant note' });
  await saveDish({ ...(await db.restaurantItems.get(s.itemId)), notes: 'Offline dish note' }, [
    rating(s.ben, 7.5),
  ]);
  expect((await db.restaurants.get(s.rid)).notes).toBe('Offline restaurant note');
  expect((await db.restaurants.get(s.rid)).menuImages).toEqual([s.ref]);
  expect((await db.restaurantItems.get(s.itemId)).notes).toBe('Offline dish note');
  expect((await db.restaurantItems.get(s.itemId)).images).toEqual([s.ref]);
  expect((await db.restaurantItemRatings.toArray())[0].score).toBe(7.5);
  await expect(freezeSnapshot(crypto.randomUUID(), crypto.randomUUID())).rejects.toThrow();
});
test('review R10: save, both snapshot validators and portable import reject future ordering dates without replacement', async () => {
  const s = await seed();
  const { snapshot } = await freezeSnapshot(crypto.randomUUID(), crypto.randomUUID());
  const backup = JSON.parse(await (await getExportBlob()).text());
  const before = await db.restaurantItems.get(s.itemId);
  snapshot.data.tables.restaurantItems[0].lastOrderedDate = '2999-01-01';
  backup.data.data.find((t) => t.tableName === 'restaurantItems').rows[0].lastOrderedDate =
    '2999-01-01';
  await expect(saveDish({ ...before, lastOrderedDate: '2999-01-01' }, [])).rejects.toThrow();
  expect(() => parseSnapshot(snapshot)).toThrow();
  expect(() => workerParse(snapshot)).toThrow();
  await expect(handleFileImport(new Blob([JSON.stringify(backup)]))).rejects.toThrow();
  expect(await db.restaurantItems.get(s.itemId)).toEqual(before);
});
test('review R10: UTC+14 calendar boundary permits retained dates from another timezone but rejects local future entry', async () => {
  const s = await seed();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-01T23:30:00.000Z'));
  try {
    const before = await db.restaurantItems.get(s.itemId);
    expect(itemSchema.safeParse({ ...before, lastOrderedDate: '2026-01-02' }).success).toBe(true);
    expect(itemSchema.safeParse({ ...before, lastOrderedDate: '2026-01-03' }).success).toBe(false);
    await expect(saveDish({ ...before, lastOrderedDate: '2026-01-02' }, [])).rejects.toThrow(
      'future'
    );
    await db.restaurantItems.update(s.itemId, { lastOrderedDate: '2026-01-02' });
    await saveDish({ ...(await db.restaurantItems.get(s.itemId)), notes: 'Retained from UTC+14' }, [
      rating(s.ben, 9),
    ]);
  } finally {
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
});
