import Dexie from 'dexie';
import { exportDB } from 'dexie-export-import';
import { expect, test, vi } from 'vitest';
import { db, MySubClassedDexie, INCLUDE_TABLES } from '../src/db/db.ts';
import { cacheImage, runImageMigration, verifyCachedAsset, normalizeRecipeImages, hashBlob } from '../src/db/image-cache.ts';
import { mealThumbnail } from '../src/db/meal-images.ts';
import { getExportBlob, exportBlobToFile } from '../src/util/db/export.ts';
import { handleFileImport } from '../src/util/db/import.ts';
import { saveMeal } from '../src/db/save-meal.ts';
import { cleanDatabase, date, meal, image, png } from './helpers.mjs';
cleanDatabase();
test('schema has all fourteen stores and version 15', async () => {
  expect(db.verno).toBe(15);
  expect(db.tables.map(table => table.name).sort()).toEqual(['meals','recipes','pendingRecipes','groceryLists','groceryListStates','tags','customIngredients','settings','stores','ingredientStores','syncs','imageAssets','imageMigrationJobs','imageUploadJobs'].sort());
});
test('v14 -> v15 adds stores without rewriting bytes, then migration resumes and deduplicates', async () => {
  const current = new MySubClassedDexie(true); const old = new Dexie(current.name);
  old.version(14).stores(Object.fromEntries(db.tables.filter(t => !t.name.startsWith('image')).map(t => [t.name,t.schema.primKey.src + (t.schema.indexes.length ? ',' + t.schema.indexes.map(i => i.src).join(',') : '')])));
  await old.open(); await old.table('meals').put({...meal(10),images:[{type:'recipeImage',recipeId:10,imageIndex:0,isThumbnail:true}]});
  await old.table('recipes').put({id:100,mealId:10,images:[image(),image()],url:'',notes:'retained'});
  old.close();
  try {
    await current.open(); expect(current.verno).toBe(15);
    expect(new Uint8Array(await (await current.recipes.get(100)).images[0].arrayBuffer())).toEqual(png);
    expect(await current.imageMigrationJobs.get('scan')).toBeDefined();
    expect((await runImageMigration(current,{maxRows:1})).interrupted).toBe(true);
    await runImageMigration(current);
    const recipe = await current.recipes.get(100); expect(recipe.notes).toBe('retained');
    expect(recipe.images[0].assetId).toBe(recipe.images[1].assetId); expect(await current.imageAssets.count()).toBe(1);
    expect(new Uint8Array(await (await current.imageAssets.toArray())[0].blob.arrayBuffer())).toEqual(png);
    expect((await current.meals.get(10)).images[0].recipeId).toBe(100);
    expect((await runImageMigration(current)).converted).toBe(0);
  } finally { await current.delete(); }
});
test('thumbnail repair preserves a uniquely owned legacy thumbnail', async () => {
  const m = {...meal(22),images:[{type:'recipeImage',recipeId:22,imageIndex:0,isThumbnail:true}]};
  await db.meals.put(m); await db.recipes.put({id:123,mealId:22,images:[image()],url:'',notes:''});
  await runImageMigration();
  const recipes = await db.recipes.toArray(); const thumb = mealThumbnail(await db.meals.get(22),recipes);
  expect(thumb).toEqual(recipes[0].images[0]); expect(await db.imageAssets.get(thumb.assetId)).toBeDefined();
  expect((await db.meals.get(22)).images[0].recipeId).toBe(123);
});
test('image cache preserves File metadata, deduplicates bytes and detects corruption', async () => {
  const ref = await cacheImage(new File([png],'camera.png',{type:'image/png',lastModified:123}));
  expect(ref).toMatchObject({name:'camera.png',lastModified:123});
  expect((await cacheImage(image())).assetId).toBe(ref.assetId);
  expect(await db.imageAssets.count()).toBe(1); expect(await db.imageUploadJobs.count()).toBe(1);
  const asset = await db.imageAssets.get(ref.assetId);
  await expect(verifyCachedAsset({...asset,blob:new Blob(['bad'],{type:'image/png'})})).rejects.toThrow('Invalid cached image bytes');
});
test('normalization retains remote URLs, decodes inline bytes and rejects temporary URLs', async () => {
  const result = await normalizeRecipeImages(['https://example.invalid/p.png','data:image/png;base64,'+Buffer.from(png).toString('base64')]);
  expect(result[0]).toBe('https://example.invalid/p.png'); expect(result[1].assetId).toBe(await hashBlob(image()));
  await expect(normalizeRecipeImages(['blob:expired'])).rejects.toThrow('Unrecoverable');
});
async function seedBackup() {
  const ref = await cacheImage(image());
  await db.meals.put({...meal(),tags:[1],images:[{...ref,type:'asset',isThumbnail:true}]});
  await db.recipes.put({id:20,mealId:1,images:[ref],url:'',notes:'Recipe'});
  await db.tags.put({id:1,name:'vegan'});
  await db.groceryLists.put({id:1,name:'Weekly',meals:[1],customIngredients:[{name:'soap',quantity:1}],createdAt:date});
  await db.groceryListStates.put({id:1,groceryListId:1,checkedIngredients:['carrot']});
  await db.customIngredients.put({id:1,name:'soap',usageCount:1});
  await db.stores.put({id:1,name:'Market',color:'#112233'});
  await db.ingredientStores.put({id:1,ingredientName:'carrot',storeId:1});
  await db.settings.put({id:'youtubeApiPass',value:'private-test-pass'});
  return ref;
}
const backupRows = value => Object.fromEntries(value.data.data.map(table => [table.tableName,table.rows]));
test('portable export/import round trip retains rows and bytes and excludes private settings', async () => {
  const ref = await seedBackup(); const exported = await getExportBlob(); const expected = backupRows(JSON.parse(await exported.text()));
  expect(expected.settings).toEqual([]); expect(expected.syncs).toEqual([]);
  await Promise.all(INCLUDE_TABLES.map(name => db.table(name).clear()));
  expect(await db.tags.count()).toBe(0); expect(await db.groceryLists.count()).toBe(0);
  await handleFileImport(exported);
  const actual = backupRows(JSON.parse(await (await getExportBlob()).text()));
  expect(actual).toEqual(expected);
  expect(new Uint8Array(await (await db.imageAssets.get(ref.assetId)).blob.arrayBuffer())).toEqual(png);
  expect((await db.settings.get('youtubeApiPass')).value).toBe('private-test-pass');
});
test('backup frozen-snapshot race completes despite a queued writer and excludes orphan bytes', async () => {
  await seedBackup(); const orphan = await cacheImage(new Blob(['orphan'],{type:'image/png'}));
  let queued; let started = false;
  const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
  const digest = vi.spyOn(crypto.subtle,'digest').mockImplementation(async (...args) => {
    if (!started) {
      started = true;
      // Queue a real write behind the export read transaction. Never await that write here.
      queued = Dexie.ignoreTransaction(() => db.transaction('rw',db.meals, async () => {
        await db.meals.update(1,{name:'Concurrent edit',images:[{...orphan,type:'asset',isThumbnail:true}]});
      }));
    }
    return nativeDigest(...args);
  });
  try {
    const backup = backupRows(JSON.parse(await (await getExportBlob()).text()));
    await queued;
    expect(started).toBe(true); expect(backup.meals[0].name).toBe('Soup');
    expect(backup.imageAssets).toHaveLength(1); expect(backup.imageAssets[0].assetId).not.toBe(orphan.assetId);
    expect((await db.meals.get(1)).name).toBe('Concurrent edit');
  } finally { digest.mockRestore(); }
});
test.each(['missing-bytes','corrupt-bytes','blob-url'])('invalid backup %s fails without replacing local data', async kind => {
  const ref = await seedBackup(); const good = await getExportBlob(); const value = JSON.parse(await good.text());
  if (kind === 'missing-bytes') value.data.data.find(t => t.tableName === 'imageAssets').rows = [];
  else if (kind === 'blob-url') value.data.data.find(t => t.tableName === 'recipes').rows[0].images = ['blob:expired'];
  else await db.imageAssets.update(ref.assetId,{blob:new Blob(['bad'],{type:'image/png'})});
  if (kind === 'corrupt-bytes') await expect(getExportBlob()).rejects.toThrow('Invalid cached image bytes');
  else await expect(handleFileImport(new Blob([JSON.stringify(value)]))).rejects.toThrow();
  expect((await db.meals.get(1)).name).toBe('Soup');
});
test('v1 portable import upgrades embedded blobs and preserves thumbnail ownership', async () => {
  const legacy = new MySubClassedDexie(true);
  try {
    await legacy.meals.put({...meal(22),images:[{type:'recipeImage',recipeId:22,imageIndex:0,isThumbnail:true}]});
    await legacy.recipes.put({id:123,mealId:22,images:[image()],url:'',notes:'Legacy'});
    const value = JSON.parse(await (await exportDB(legacy)).text());
    value.data.databaseVersion = 14; value.data.tables = value.data.tables.filter(t => !t.name.startsWith('image'));
    value.data.data = value.data.data.filter(t => !t.tableName.startsWith('image'));
    await handleFileImport(new Blob([JSON.stringify(value)]));
    expect((await db.meals.get(22)).images[0].recipeId).toBe(123); expect(await db.imageAssets.count()).toBe(1);
  } finally { await legacy.delete(); }
});
test('saveMeal atomically creates recipe, real thumbnail key and pending recipe', async () => {
  const id = await saveMeal({...meal(),id:undefined}, {id:crypto.randomUUID(),sourceUrl:'',content:'Boil',images:[{type:'blob',blob:image()}],createRecipe:true});
  const recipe = await db.recipes.where('mealId').equals(id).first(); const saved = await db.meals.get(id);
  expect(saved.images[0].recipeId).toBe(recipe.id); expect(recipe.notes).toBe('Boil'); expect(await db.imageAssets.count()).toBe(1);
  const pendingId = crypto.randomUUID();
  const second = await saveMeal({...meal(),id:undefined}, {id:pendingId,sourceUrl:'',content:'Later',images:[],createRecipe:false});
  expect((await db.meals.get(second)).pendingRecipeId).toBe(pendingId); expect((await db.pendingRecipes.get(pendingId)).content).toBe('Later');
});
test('DOM backup download creates and removes its link and releases object URL', () => {
  const create = vi.fn(() => 'blob:synthetic'); const revoke = vi.fn();
  vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:create,revokeObjectURL:revoke}));
  const click = vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function () { expect(this.download).toBe('backup.json'); expect(document.body.contains(this)).toBe(true); });
  try { exportBlobToFile('backup.json',new Blob(['{}'])); expect(create).toHaveBeenCalledTimes(1); expect(revoke).toHaveBeenCalledWith('blob:synthetic'); expect(document.querySelector('a')).toBeNull(); }
  finally { click.mockRestore(); }
});
