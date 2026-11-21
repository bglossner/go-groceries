import { beforeEach, expect, test, vi } from 'vitest';
import { db } from '../src/db/db.ts';
import { cacheImage } from '../src/db/image-cache.ts';
import { getExportBlob } from '../src/util/db/export.ts';
import { syncTo } from '../src/util/sync.ts';
import { syncFromDb, saveSyncFromLocation, importSyncFile } from '../src/util/sync-from.ts';
import { hydrateSnapshot } from '../src/util/sync/hydrate.ts';
import { freezeSnapshot } from '../src/util/sync/snapshot-adapter.ts';
import { parseLocation, readPermission, consumeIncomingLocation } from '../src/util/sync/location.ts';
import { boundedJson, v2Post } from '../src/util/sync/api.ts';
import { createShareLink } from '../src/util/sync/share.ts';
import { createApp } from '../../go-groceries-images-meal-resolver/src/index.ts';
import { createStorage } from '../../../test/memory-storage.mjs';
import { cleanDatabase, meal, image } from './helpers.mjs';
cleanDatabase();
let storage, fetchMock;
beforeEach(async () => {
  storage = createStorage(); const app = createApp({client:()=>storage.client,sign:storage.sign,now:Date.now});
  fetchMock = vi.fn(async (input,options = {}) => {
    const url = new URL(String(input));
    if (url.origin !== 'http://127.0.0.1:18927') throw new Error('Unexpected test URL');
    if (url.pathname.startsWith('/objects/')) return storage.objectFetch(url,options);
    storage.events.push({action:'API',key:url.pathname});
    if (url.pathname === '/v2/snapshots/publish' && storage.controls.failPublish > 0) {storage.controls.failPublish--;return new Response('',{status:400});}
    return app.fetch(new Request(url,options),storage.env);
  });
  vi.stubGlobal('fetch',fetchMock);
  await db.settings.put({id:'youtubeApiPass',value:storage.env.PASS});
});
async function seed() {
  const ref = await cacheImage(image());
  await db.meals.put({...meal(),images:[{...ref,type:'asset',isThumbnail:true}]});
  await db.recipes.put({id:20,mealId:1,images:[ref,ref],url:'',notes:'Recipe'});
  return ref;
}
const published = () => [...storage.objects.entries()].filter(([key]) => key.includes('/snapshots/')).map(([,object]) => JSON.parse(new TextDecoder().decode(object.bytes))).at(-1);
test('v2 publishes verified unique images before metadata and latest, then deduplicates repeat sync', async () => {
  await seed(); await syncTo({automatic:false});
  const actions = storage.events.filter(e => e.action === 'API' || e.action === 'SIGNED_PUT').map(e => e.key);
  expect(actions[0]).toBe('/v2/images/prepare');
  expect(actions.indexOf('/v2/images/complete')).toBeLessThan(actions.indexOf('/v2/snapshots/commit'));
  expect(actions.indexOf('/v2/snapshots/commit')).toBeLessThan(actions.indexOf('/v2/snapshots/publish'));
  expect(storage.events.filter(e => e.action === 'SIGNED_PUT')).toHaveLength(1);
  const snapshot = published(); expect(snapshot.assets).toHaveLength(1); expect(JSON.stringify(snapshot)).not.toContain('test-writer-pass');
  expect(JSON.stringify(snapshot)).not.toContain('ticket=');
  await syncTo({automatic:false}); expect(storage.events.filter(e => e.action === 'SIGNED_PUT')).toHaveLength(1);
  expect((await db.syncs.where('type').equals('to').first()).pendingPublication).toBeUndefined();
});
test('failure before latest preserves pending snapshot for recovery and does not publish an incomplete head', async () => {
  await seed(); storage.controls.failPublish = 1;
  await expect(syncTo({automatic:false})).rejects.toThrow('400');
  const pending = (await db.syncs.where('type').equals('to').first()).pendingPublication;
  expect(pending).toBeDefined(); expect([...storage.objects.keys()].some(k => k.endsWith('/latest.json'))).toBe(false);
  await db.meals.update(1,{name:'Later edit'}); await syncTo({automatic:false});
  expect(published().data.tables.meals[0].name).toBe('Later edit');
  expect(storage.events.filter(e => e.action === 'SIGNED_PUT')).toHaveLength(1);
});
test('writer sync down stages diffs, atomically replaces metadata and hydrates bytes', async () => {
  const ref = await seed(); const url = await syncTo({automatic:false});
  await db.meals.clear(); await db.recipes.clear(); await db.imageAssets.clear();
  await saveSyncFromLocation(url); const incoming = await syncFromDb();
  expect(incoming.diffsResult.mealDiffs.toAdd.map(m => m.name)).toEqual(['Soup']);
  expect(await db.meals.count()).toBe(0);
  expect(await importSyncFile(incoming.blob)).toContain('1/1');
  expect((await db.meals.get(1)).name).toBe('Soup'); expect(await db.imageAssets.get(ref.assetId)).toBeDefined();
});
test('hydration renews expired GET links and then serves cached bytes without network', async () => {
  const ref = await seed(); await syncTo({automatic:false}); const snapshot = published();
  await db.imageAssets.clear(); storage.controls.expireGet = 1;
  expect(await hydrateSnapshot(snapshot,{pass:storage.env.PASS})).toEqual({cached:1,total:1,failures:[]});
  expect(storage.events.filter(e => e.action === 'API' && e.key === '/v2/images/download')).toHaveLength(2);
  expect(await db.imageAssets.get(ref.assetId)).toBeDefined();
  fetchMock.mockClear(); expect((await hydrateSnapshot(snapshot,{pass:storage.env.PASS})).cached).toBe(1); expect(fetchMock).not.toHaveBeenCalled();
});
test('corrupt hydration is rejected, retains metadata, and can be retried', async () => {
  const ref = await seed(); await syncTo({automatic:false}); const snapshot = published(); await db.imageAssets.clear();
  storage.controls.corruptGet = 1;
  const failed = await hydrateSnapshot(snapshot,{pass:storage.env.PASS});
  expect(failed.cached).toBe(0); expect(failed.failures[0]).toContain('SHA-256'); expect(await db.imageAssets.get(ref.assetId)).toBeUndefined();
  expect((await db.meals.get(1)).name).toBe('Soup');
  expect((await hydrateSnapshot(snapshot,{pass:storage.env.PASS})).cached).toBe(1);
});
test('read-only share imports without pass, does not query latest, and stores no bearer token', async () => {
  await seed(); await syncTo({automatic:false}); const writer = await db.syncs.where('type').equals('to').first();
  const url = await createShareLink(writer);
  await db.settings.clear(); await db.meals.clear(); await db.recipes.clear(); await db.imageAssets.clear();
  await saveSyncFromLocation(url); const sync = await db.syncs.where('type').equals('from').first();
  expect(sync.url).not.toContain('share='); expect(await readPermission(sync)).toHaveProperty('shareToken');
  storage.events.length = 0;
  const incoming = await syncFromDb(); expect(await importSyncFile(incoming.blob)).toContain('1/1');
  expect(storage.events.some(e => e.key === '/v2/snapshots/latest')).toBe(false);
  for (const [,options] of fetchMock.mock.calls.slice(-2)) if (options.method === 'POST') expect(options.body).not.toContain('pass');
  await expect(syncTo({automatic:false})).rejects.toThrow('writer pass');
});
test('share expiry shows authorization error and preserves local data', async () => {
  await seed(); await syncTo({automatic:false}); const writer = await db.syncs.where('type').equals('to').first();
  await saveSyncFromLocation(await createShareLink(writer)); storage.env.PASS = 'rotated-pass';
  await expect(syncFromDb()).rejects.toThrow('authorization expired'); expect((await db.meals.get(1)).name).toBe('Soup');
});
test('changed sync source refuses stale staged metadata', async () => {
  await seed(); const url = await syncTo({automatic:false}); await saveSyncFromLocation(url);
  const incoming = await syncFromDb(); const source = await db.syncs.where('type').equals('from').first();
  await db.syncs.update(source.id,{importGeneration:crypto.randomUUID()}); await db.meals.update(1,{name:'Retained local'});
  await expect(importSyncFile(incoming.blob)).rejects.toThrow('changed'); expect((await db.meals.get(1)).name).toBe('Retained local');
});
test.each([[400,'Invalid legacy sync filename'],[403,'Legacy retrieval pass rejected'],[404,'not found in storage'],[502,'storage lookup failed']])('legacy retrieval %s has actionable errors without changing data', async (status,message) => {
  await seed(); await saveSyncFromLocation('http://127.0.0.1:18927/legacy-'+status+'.json?X-Amz-Date=20200101T000000Z&X-Amz-Expires=300&X-Amz-Signature=synthetic');
  vi.stubGlobal('fetch',vi.fn(async () => new Response('',{status})));
  await expect(syncFromDb()).rejects.toThrow(message); expect((await db.meals.get(1)).name).toBe('Soup');
});
test('missing location, unavailable share session and malformed locations explain recovery', async () => {
  await expect(syncFromDb()).rejects.toThrow('No sync from location');
  const collectionId = crypto.randomUUID(), snapshotId = crypto.randomUUID();
  await expect(readPermission({access:'share',collectionId,snapshotId})).rejects.toThrow('Reopen the original shared link');
  for (const url of ['javascript:alert(1)','https://user:pass@localhost/old.json','https://localhost/%2fprivate','http://localhost/#collection=bad']) expect(() => parseLocation(url)).toThrow();
});
test('incoming share fragment is removed from DOM history and retained only in memory', () => {
  const collectionId = crypto.randomUUID(),snapshotId = crypto.randomUUID();
  window.history.replaceState(null,'','/settings#collection='+collectionId+'&snapshot='+snapshotId+'&share=synthetic-token');
  expect(consumeIncomingLocation()).toContain('share=synthetic-token'); expect(window.location.hash).toBe('');
});
test('bounded JSON rejects excessive bytes and malformed UTF-8/JSON', async () => {
  await expect(boundedJson(new Response('12345'),4)).rejects.toThrow('size limit');
  await expect(boundedJson(new Response('{'))).rejects.toThrow('Invalid sync JSON');
  await expect(boundedJson(new Response(Uint8Array.from([255])))).rejects.toThrow('Invalid sync JSON');
});
test('cloud conflict is not retried and temporary server errors are retried', async () => {
  const conflict = vi.fn(async () => new Response('',{status:409})); vi.stubGlobal('fetch',conflict);
  await expect(v2Post('snapshots/latest',{}, {pass:'fake'})).rejects.toThrow('Cloud sync conflict'); expect(conflict).toHaveBeenCalledTimes(1);
  const transient = vi.fn().mockResolvedValueOnce(new Response('',{status:503})).mockResolvedValueOnce(new Response('{}'));
  vi.stubGlobal('fetch',transient); expect(await v2Post('snapshots/latest',{}, {pass:'fake'})).toEqual({}); expect(transient).toHaveBeenCalledTimes(2);
});
test('unsupported/oversize local images block publishing and retain originals', async () => {
  const ref = await cacheImage(new Blob(['GIF89a'],{type:'image/gif'})); await db.recipes.put({id:1,mealId:1,images:[ref],url:'',notes:''});
  await expect(freezeSnapshot(crypto.randomUUID(),crypto.randomUUID())).rejects.toThrow('unsupported image type');
  expect(await db.imageAssets.get(ref.assetId)).toBeDefined(); expect(fetchMock).not.toHaveBeenCalled();
});

test('v1 sync import uses the portable importer and retains embedded bytes', async () => {
  const ref = await seed(); const backup = await getExportBlob();await db.meals.clear();await db.recipes.clear();await db.imageAssets.clear();
  expect(await importSyncFile(backup)).toContain('Legacy sync imported');
  expect((await db.meals.get(1)).name).toBe('Soup');expect(await db.imageAssets.get(ref.assetId)).toBeDefined();
});

test('schema15 pending first publication upgrades to16 without a head or lost local bytes', async()=>{
 await seed();const collectionId=crypto.randomUUID();const frozen=await freezeSnapshot(collectionId,crypto.randomUUID());const old=structuredClone(frozen.snapshot);old.data={schemaVersion:15,adapterVersion:1,tables:Object.fromEntries(Object.entries(old.data.tables).filter(([name])=>!['restaurants','restaurantTags','restaurantItems','people','restaurantItemRatings'].includes(name)))};
 await db.syncs.add({type:'to',format:'v2',collectionId,filename:collectionId,uploadType:'manual',createdAt:new Date(),automatic:false,pendingPublication:{snapshot:old,expectedRevision:null}});
 const before=await db.meals.toArray();await syncTo({automatic:false});expect(published().data.schemaVersion).toBe(16);expect(await db.meals.toArray()).toEqual(before);expect(await db.imageAssets.count()).toBe(1);await syncTo({automatic:false});expect(published().data.schemaVersion).toBe(16);
});
test('full snapshot share disclosure can cancel before capability creation', async()=>{
 const time='2020-01-01T00:00:00.000Z';await db.restaurants.add({name:'Private notebook',tags:[],notes:'<img src=x onerror=alert(1)>',isPinned:false,countryKey:'',regionKey:'',cityKey:'',createdAt:time,updatedAt:time});await syncTo({automatic:false});const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
 try{const writer=await db.syncs.where('type').equals('to').first();await expect(createShareLink(writer)).rejects.toThrow('cancelled');expect(confirm.mock.calls[0][0]).toContain('hidden advanced values');expect(storage.events.filter(e=>e.key==='/v2/snapshots/share')).toHaveLength(0);}finally{confirm.mockRestore();}
});

test('automatic schema16 removal requires confirmation and preserves live metadata',async()=>{
 const time='2020-01-01T00:00:00.000Z';await db.restaurants.add({name:'Keep local notebook',tags:[],notes:'',isPinned:false,countryKey:'',regionKey:'',cityKey:'',createdAt:time,updatedAt:time});const {snapshot}=await freezeSnapshot(crypto.randomUUID(),crypto.randomUUID());snapshot.data.tables.restaurants=[];const blob=new Blob([JSON.stringify(snapshot)]);await expect(importSyncFile(blob,{automatic:true})).rejects.toThrow('remove restaurant');expect(await db.restaurants.count()).toBe(1);
});


test.each([false, true])('coordinate-bearing schema16 pending publication refreshes without changing revision condition (head %s)', async (hasHead) => {
  await seed();
  const time = '2020-01-01T00:00:00.000Z';
  const rid = await db.restaurants.add({ name: 'Pending kitchen', tags: [], notes: '', isPinned: false,
    countryKey: '', regionKey: '', cityKey: '', googleMapsUrl: 'https://maps.google.com/?q=London', createdAt: time, updatedAt: time });
  if (hasHead) await syncTo({ automatic: false });
  let writer = await db.syncs.where('type').equals('to').first();
  const collectionId = writer?.collectionId ?? crypto.randomUUID();
  const { snapshot } = await freezeSnapshot(collectionId, crypto.randomUUID());
  Object.assign(snapshot.data.tables.restaurants[0], { latitude: 0, longitude: 0 });
  const expectedRevision = writer?.revision ?? null;
  await db.syncs.put({ ...writer, type: 'to', format: 'v2', collectionId, filename: collectionId,
    uploadType: 'manual', createdAt: new Date(), automatic: false, pendingPublication: { snapshot, expectedRevision } });
  await db.restaurants.update(rid, { notes: 'Later local edit' });
  fetchMock.mockClear();
  await syncTo({ automatic: false });
  const repaired = published();
  expect(repaired.snapshotId).not.toBe(snapshot.snapshotId);
  expect(repaired.data.tables.restaurants[0].notes).toBe('Later local edit');
  expect(repaired.data.tables.restaurants[0].googleMapsUrl).toBe('https://maps.google.com/?q=London');
  expect(repaired.data.tables.restaurants[0]).not.toHaveProperty('latitude');
  expect(repaired.data.tables.restaurants[0]).not.toHaveProperty('longitude');
  const publishes = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/v2/snapshots/publish'));
  expect(JSON.parse(publishes[0][1].body).expectedRevision).toBe(expectedRevision);
  writer = await db.syncs.where('type').equals('to').first();
  expect(writer.pendingPublication).toBeUndefined();
  expect(await db.imageAssets.count()).toBe(1);
});
