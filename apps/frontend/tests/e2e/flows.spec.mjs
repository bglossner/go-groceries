import {test,expect} from '@playwright/test';
import {join} from 'node:path';
const base = 'http://127.0.0.1:18926';
// Keep this contract independent of the exporter's production allowlist.
const portableTables = ['meals','groceryLists','groceryListStates','recipes','tags','customIngredients','pendingRecipes','stores','ingredientStores','imageAssets','restaurants','restaurantTags','restaurantItems','people','restaurantItemRatings'];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=','base64');
async function guard(context) {
  const unexpected = [];
  await context.route('**/*',route => {
    const url = new URL(route.request().url());
    if (['http:','https:'].includes(url.protocol) && ![base,'http://127.0.0.1:18927'].includes(url.origin)) {
      // The bundled compressor tries its optional CDN Worker, then falls back locally.
      if (!(url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('browser-image-compression'))) unexpected.push(url.origin);
      return route.abort();
    }
    return route.continue();
  });
  await context.routeWebSocket('**/*',socket=>socket.close());
  return unexpected;
}
async function createMeal(page) {
  await page.goto('/meals');await page.getByRole('button',{name:'Create New Meal',exact:true}).click();
  await page.getByRole('button',{name:'Manual Creation',exact:true}).click();
  await page.getByRole('textbox',{name:'Meal Name',exact:true}).fill('Browser soup');
  await page.getByLabel('Ingredient Name',{exact:true}).first().fill('Carrot');
  await page.getByLabel('Quantity',{exact:true}).first().fill('2');
  await page.getByRole('button',{name:'Create',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const id = await page.evaluate(async () => {const {db}=await import('/src/db/db.ts');return (await db.meals.toCollection().first()).id;});
  await page.goto('/recipe/'+id);
  await page.locator('#file-input').setInputFiles({name:'tiny.png',mimeType:'image/png',buffer:png});
  await expect(page.getByAltText('recipe-0')).toBeVisible();
  await page.getByLabel('Thumbnail',{exact:true}).check();await page.getByLabel('Notes',{exact:true}).fill('Boil carrots');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByText('Boil carrots',{exact:true})).toBeVisible();
  await expect.poll(()=>page.getByAltText('recipe-0').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
  await page.goto('/meals');await expect(page.getByAltText('thumbnail')).toBeVisible();
  await expect.poll(()=>page.getByAltText('thumbnail').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
  return id;
}
async function state(page) {
  const result = await page.evaluate(async (portableTables) => {
    const {db}=await import('/src/db/db.ts');const {hashBlob}=await import('/src/db/image-cache.ts');
    const {INCLUDE_TABLES}=await import('/src/db/db.ts');
    const tables = Object.fromEntries(await Promise.all(portableTables.filter(name=>name!=='imageAssets').map(async name=>[name,await db.table(name).toArray()])));
    return {inventory:[...INCLUDE_TABLES].sort(),tables,assets:await Promise.all((await db.imageAssets.toArray()).map(async a=>({id:a.assetId,hash:await hashBlob(a.blob),size:a.byteLength,mime:a.mimeType})))};
  },portableTables);
  expect(result.inventory).toEqual([...portableTables].sort());
  return result;
}
async function setPass(page) {
  await page.goto('/settings');await page.getByLabel('YouTube API Pass',{exact:true}).fill('test-writer-pass');
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Save YouTube API Pass',exact:true}).click();
  await expect.poll(()=>page.evaluate(async()=>{const {db}=await import('/src/db/db.ts');return (await db.settings.get('youtubeApiPass'))?.value;})).toBe('test-writer-pass');
}
test('create meal with thumbnail, recipe image, grocery list partitioning and persistent checklist', async ({page,context}) => {
  const unexpected = await guard(context);const id = await createMeal(page);
  await page.screenshot({path:join(process.env.REGRESSION_ARTIFACT_DIR,'meal-thumbnail.png'),fullPage:true});
  await page.goto('/grocery-list');await page.getByRole('button',{name:'Create New Grocery List',exact:true}).click();
  await page.getByLabel('Grocery List Name',{exact:true}).fill('Weekly');
  await page.getByRole('dialog').getByText('Browser soup',{exact:true}).click();
  await page.getByLabel('Ingredient Name',{exact:true}).first().fill('Soap');
  await page.getByRole('button',{name:'Create',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  const listId = await page.evaluate(async () => {
    const {db}=await import('/src/db/db.ts');await db.stores.add({name:'Test market',color:'#112233'});
    const store = await db.stores.toCollection().first();await db.ingredientStores.add({ingredientName:'carrot',storeId:store.id});
    return (await db.groceryLists.toCollection().first()).id;
  });
  await page.goto('/go-grocery?groceryListId='+listId);await expect(page.getByText('Carrot: 2',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'partition by store',exact:true}).click();
  await expect(page.getByText('Test market',{exact:true})).toBeVisible();await expect(page.getByText('Uncategorized',{exact:true})).toBeVisible();
  await page.locator('li').filter({hasText:'Carrot: 2'}).getByRole('checkbox').click();
  await expect.poll(()=>page.evaluate(async()=>{const {db}=await import('/src/db/db.ts');return (await db.groceryListStates.toCollection().first())?.checkedIngredients;})).toEqual(['carrot']);
  await page.reload();await expect(page.locator('li').filter({hasText:'Carrot: 2'}).getByRole('checkbox')).toBeChecked();
  expect((await state(page)).tables.meals[0].id).toBe(id);expect(unexpected).toEqual([]);
});
test('UI export imports in a fresh browser context with identical metadata and image bytes', async ({page,context,browser}) => {
  const unexpected = await guard(context);await createMeal(page);
  await page.evaluate(async () => {
    const {db}=await import('/src/db/db.ts');const now=new Date('2020-01-01T00:00:00Z');
    await db.tags.put({id:1,name:'vegan'});await db.meals.update(1,{tags:[1]});
    await db.groceryLists.put({id:1,name:'Weekly',meals:[1],customIngredients:[{name:'soap',quantity:2}],createdAt:now});
    await db.groceryListStates.put({id:1,groceryListId:1,checkedIngredients:['carrot']});
    await db.customIngredients.put({id:1,name:'soap',usageCount:1});
    await db.pendingRecipes.put({id:crypto.randomUUID(),content:'Pending recipe',sourceUrl:'',createdAt:now,images:[]});
    await db.stores.put({id:1,name:'Market',color:'#112233'});await db.ingredientStores.put({id:1,ingredientName:'carrot',storeId:1});
  });
  const expected = await state(page);await page.goto('/');
  const downloadPromise = page.waitForEvent('download');await page.getByRole('button',{name:'Export Groceries',exact:true}).click();
  const download = await downloadPromise;const file = join(process.env.REGRESSION_ARTIFACT_DIR,'portable-backup.json');await download.saveAs(file);
  const fresh = await browser.newContext();const freshUnexpected = await guard(fresh);
  try {
    const imported = await fresh.newPage();await imported.goto(base+'/');await imported.getByRole('button',{name:'Import Groceries',exact:true}).click();
    const chooserPromise = imported.waitForEvent('filechooser');await imported.getByRole('button',{name:'Yes',exact:true}).click();await (await chooserPromise).setFiles(file);
    await expect(imported.getByText('Import Succeeded!',{exact:true})).toBeVisible();expect(await state(imported)).toEqual(expected);
    await imported.getByRole('button',{name:'Close',exact:true}).click();await imported.goto(base+'/meals');await expect(imported.getByAltText('thumbnail')).toBeVisible();
    expect(unexpected).toEqual([]);expect(freshUnexpected).toEqual([]);
  } finally {await fresh.close();}
});
test('UI sync uploads to local Worker/R2 then a fresh context imports and hydrates the thumbnail', async ({page,context,browser}) => {
  const unexpected = await guard(context);await createMeal(page);const expected = await state(page);await setPass(page);
  await page.getByRole('button',{name:'Sync To Cloud',exact:true}).click();await page.getByRole('button',{name:'Confirm',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Synced metadata'})).toBeVisible();
  const url = await page.evaluate(async()=>{const {db}=await import('/src/db/db.ts');return (await db.syncs.where('type').equals('to').first()).url;});
  const fresh = await browser.newContext();const freshUnexpected = await guard(fresh);
  try {
    const down = await fresh.newPage();await down.goto(base+'/settings');await setPass(down);
    await down.getByLabel('Sync From URL',{exact:true}).fill(url);await down.getByRole('button',{name:'Save New Sync Location',exact:true}).click();
    await down.getByRole('button',{name:'Sync DB',exact:true}).click();await down.getByRole('button',{name:'Confirm Import',exact:true}).click();
    await expect(down.getByRole('dialog')).toHaveCount(0);expect(await state(down)).toEqual(expected);
    await down.goto(base+'/meals');await expect(down.getByAltText('thumbnail')).toBeVisible();
    await expect.poll(()=>down.getByAltText('thumbnail').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
    expect(unexpected).toEqual([]);expect(freshUnexpected).toEqual([]);
  } finally {await fresh.close();}
});
