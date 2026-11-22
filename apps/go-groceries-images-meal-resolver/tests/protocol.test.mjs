import assert from 'node:assert/strict';
import { createHash, createHmac, webcrypto } from 'node:crypto';
import * as sdk from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { test as vitest, afterAll, vi } from 'vitest';
import { createApp } from '../src/index.ts';
import { memoryR2Bucket } from '../../../test/memory-storage.mjs';
vi.stubGlobal('crypto', webcrypto);
const collectionId = '11111111-1111-4111-8111-111111111111';
const otherCollection = '22222222-2222-4222-8222-222222222222';
const snapshotId = '33333333-3333-4333-8333-333333333333';
const otherSnapshot = '44444444-4444-4444-8444-444444444444';
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const etag = bytes => '"' + createHash('md5').update(bytes).digest('hex') + '"';
const input = { sha256: hash(png), mimeType: 'image/png', byteLength: png.length };
const finalKey = `collections/${collectionId}/images/sha256/${input.sha256}`;
let now = Date.parse('2026-11-19T12:00:00.125Z');
const objects = new Map();
const calls = [];
let failHead = null;
let failPutAfterWrite = false;
let mutateStagingOnGet = false;
let raceFinalWrite = false;
const storageError = status => Object.assign(new Error('stub storage failure'), { $metadata: { httpStatusCode: status } });
const metadata = object => ({ ContentLength: object.reportedLength ?? object.bytes.length,
  ContentType: object.mimeType, Metadata: object.metadata ?? {}, ETag: etag(object.bytes) });
async function send(command) {
  const { Key, Body, ContentType, Metadata, IfNoneMatch, IfMatch } = command.input;
  const name = command.constructor.name;
  calls.push({ name, key: Key, input: command.input });
  if (name === 'HeadObjectCommand') {
    if (failHead) throw storageError(failHead);
    if (!objects.has(Key)) throw storageError(404);
    return metadata(objects.get(Key));
  }
  if (name === 'GetObjectCommand') {
    if (!objects.has(Key)) throw storageError(404);
    const object = objects.get(Key);
    const bytes = object.bytes.slice();
    if (mutateStagingOnGet && Key.includes('/staging/')) objects.set(Key, { ...object, bytes: new Uint8Array([99,98,97]) });
    return { ...metadata(object), Body: { transformToWebStream: () => new ReadableStream({
      start(controller) { for (let offset = 0; offset < bytes.length; offset += 65536) controller.enqueue(bytes.slice(offset, offset + 65536)); controller.close(); },
    }) } };
  }
  if (name === 'PutObjectCommand') {
    if (raceFinalWrite && Key.includes('/images/sha256/')) { raceFinalWrite=false; objects.set(Key,{bytes:Uint8Array.from(Body),mimeType:ContentType,metadata:Metadata}); }
    if (IfNoneMatch === '*' && objects.has(Key)) throw storageError(412);
    if (IfMatch && (!objects.has(Key) || etag(objects.get(Key).bytes) !== IfMatch)) throw storageError(412);
    const bytes = Uint8Array.from(Body);
    objects.set(Key, { bytes, mimeType: ContentType, metadata: Metadata });
    if (failPutAfterWrite) { failPutAfterWrite = false; throw storageError(503); }
    return { ETag: etag(bytes) };
  }
  if (name === 'DeleteObjectCommand') { objects.delete(Key); return {}; }
  throw new Error('Unexpected command: ' + name);
}
const env = { PASS: 'synthetic-writer-secret', ENABLE_PASS: 'true', R2_BUCKET_NAME: 'synthetic-bucket',
 R2_ACCOUNT_ID: 'synthetic-account', R2_ACCESS_KEY_ID: 'synthetic-access', R2_ACCESS_KEY_SECRET: 'synthetic-secret',
 CORS_ALLOWED_ORIGINS: 'https://app.example,http://localhost:5173',
 IMAGES_BUCKET: memoryR2Bucket(objects, object => object.mimeType),
 CAPABILITY_SECRET: 'synthetic-server-only-capability-key-not-a-real-secret' };
const client = new sdk.S3Client({ region: 'auto', endpoint: 'https://synthetic-account.r2.cloudflarestorage.com',
 credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_ACCESS_KEY_SECRET } });
client.send = send;
// Legacy routes retain their client factory; all of its storage traffic is also stubbed.
const originalSend = sdk.S3Client.prototype.send;
sdk.S3Client.prototype.send = send;
let app;
async function api(route, body, expected = 200, headers = {}, overrides = {}) {
 const response = await app.fetch(new Request('https://worker.example/' + route, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
 }), { ...env, ...overrides });
 const value = await response.json();
 assert.equal(response.status, expected, JSON.stringify({ route, value }));
 if (route.startsWith('v2/')) { assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(response.headers.get('referrer-policy'), 'no-referrer'); }
 return value;
}
const writer = body => ({ pass: env.PASS, ...body });
async function prepareImage(image = input, collection = collectionId) {
 return (await api('v2/images/prepare', writer({ collectionId: collection, images: [image] }))).images[0];
}
function stage(prepared, bytes = png, reportedLength) {
 objects.set(prepared.transfer.key, { bytes: bytes.slice(), mimeType: input.mimeType, reportedLength });
}
const emptyTables = () => Object.fromEntries(['meals','groceryLists','groceryListStates','recipes','tags','customIngredients','pendingRecipes','stores','ingredientStores'].map(name => [name, []]));
function makeSnapshot(asset, id = snapshotId) {
 const tables = emptyTables();
 tables.recipes = [{ id: 2, mealId: 99, images: [{ kind: 'asset', assetId: asset.assetId, name: 'same-image.png', lastModified: 10 }], url: '', notes: 'metadata only' }];
 return { format: 'go-groceries-snapshot', version: 2, collectionId, snapshotId: id, assets: [asset], data: { schemaVersion: 15, adapterVersion: 1, tables } };
}
const steps = [];
const test = (name, fn) => steps.push([name, fn]);
let prepared, asset, snapshot, share;

test('writer pass rejection before storage; legacy override does not disable v2 auth', async () => {
 const before = calls.length;
 await api('v2/images/prepare', { pass: 'wrong', collectionId, images: [input] }, 403);
 await api('v2/images/prepare', { pass: '', collectionId, images: [input] }, 403, {}, { ENABLE_PASS: 'false' });
 await api('v2/images/prepare', writer({ collectionId, images: [input] }), 503, {}, { PASS: '' });
 assert.equal(calls.length, before);
});
test('collection, hash, size, MIME and batch validation', async () => {
 for (const collection of ['../collections', collectionId.toUpperCase().replace('1','A'), collectionId + '/x', '%2f' + collectionId]) {
  await api('v2/images/prepare', writer({ collectionId: collection, images: [input] }), 400);
 }
 for (const image of [{...input,sha256:'a'.repeat(63)}, {...input,sha256:'A'.repeat(64)}, {...input,sha256:input.sha256+'/x'},
  {...input,byteLength:0}, {...input,byteLength:4*1024*1024+1}, {...input,mimeType:'image/svg+xml'}]) {
  await api('v2/images/prepare', writer({ collectionId, images: [image] }), 400);
 }
 await api('v2/images/prepare', writer({ collectionId, images: Array(17).fill(input) }), 400);
});
test('legacy GET/PUT reject reserved namespaces, encoding and traversal; retain old keys', async () => {
 for (const name of ['collections/' + collectionId + '/latest.json','collections%2f'+collectionId,'%252fcollections','../x','a/../b','/x','a\\b','x?foo=y','x#y','',123,null]) {
  await api('file-upload', writer({fileUploadType:'R2',fileName:name,contentType:'application/json'}),400);
  await api('file-retrieval', writer({uploadedType:'R2',fileName:name}),400);
 }
 const name = 'groceries_backup_' + collectionId;
 const uploaded = await api('file-upload', writer({fileUploadType:'R2',fileName:name,contentType:'application/json'}));
 assert.equal(new URL(uploaded.url).searchParams.get('X-Amz-Expires'),'300');
 objects.set(name,{bytes:new Uint8Array([1]),mimeType:'application/json'});
 const retrieved = await api('file-retrieval', writer({uploadedType:'R2',fileName:name}));
 assert.equal(new URL(retrieved.url).searchParams.get('X-Amz-Expires'),'86400');
 await api('file-upload',{pass:'wrong',fileUploadType:'R2',fileName:name,contentType:'application/json'},403);
 await api('file-retrieval',{pass:'wrong',uploadedType:'R2',fileName:name},403);
 await api('file-upload',null,400); await api('file-retrieval',null,400);
});
test('signed staging PUT is limited to a random key, 300 seconds and Content-Type', async () => {
 prepared = await prepareImage();
 assert.equal(prepared.status,'upload');
 assert.ok(prepared.transfer.key.startsWith(`collections/${collectionId}/staging/`));
 assert.notEqual(prepared.transfer.key,finalKey);
 const url = new URL(prepared.transfer.url);
 assert.equal(url.searchParams.get('X-Amz-Expires'),'300');
 assert.ok(url.searchParams.get('X-Amz-SignedHeaders').includes('content-type'));
 assert.equal(Date.parse(prepared.transfer.expiresAt)-now,300000);
});
test('completion refuses missing bytes, wrong hash, malformed container and excessive pixels', async () => {
 await api('v2/images/complete',writer({uploadToken:prepared.uploadToken}),404);
 stage(prepared,new Uint8Array(png.length));
 await api('v2/images/complete',writer({uploadToken:prepared.uploadToken}),400);
 assert.ok(!objects.has(finalKey));
 const bad = new Uint8Array(70);
 const badPreparation = await prepareImage({sha256:hash(bad),mimeType:'image/png',byteLength:bad.length});
 stage(badPreparation,bad);
 await api('v2/images/complete',writer({uploadToken:badPreparation.uploadToken}),400);
 const huge = png.slice(); new DataView(huge.buffer).setUint32(16,8193);
 const hugePreparation = await prepareImage({sha256:hash(huge),mimeType:'image/png',byteLength:huge.length});
 stage(hugePreparation,huge);
 await api('v2/images/complete',writer({uploadToken:hugePreparation.uploadToken}),400);
});
test('actual streaming size bound rejects forged Content-Length', async () => {
 const bad = new Uint8Array(4*1024*1024+1);
 const prep = await prepareImage({sha256:hash(bad),mimeType:'image/png',byteLength:4*1024*1024});
 stage(prep,bad,1);
 await api('v2/images/complete',writer({uploadToken:prep.uploadToken}),413);
});
test('tampered tokens are rejected before object lookup', async () => {
 const before = calls.length;
 const parts = prepared.uploadToken.split('.');
 const parsed = JSON.parse(Buffer.from(parts[0],'base64url').toString()); parsed.collectionId = otherCollection;
 const spoof = Buffer.from(JSON.stringify(parsed)).toString('base64url') + '.' + parts[1];
 await api('v2/images/complete',writer({uploadToken:spoof}),403);
 assert.equal(calls.length,before);
});
test('promotion writes exactly verified bytes despite staging mutation; retry/dedup are idempotent', async () => {
 stage(prepared); mutateStagingOnGet = true;
 asset = (await api('v2/images/complete',writer({uploadToken:prepared.uploadToken}))).asset;
 mutateStagingOnGet = false;
 assert.deepEqual(objects.get(finalKey).bytes,png);
 const finalWrite = calls.find(call => call.name==='PutObjectCommand' && call.key===finalKey);
 assert.equal(finalWrite.input.IfNoneMatch,'*');
 assert.equal(finalWrite.input.Metadata['verified-sha256'],input.sha256);
 assert.ok(!objects.has(prepared.transfer.key));
 const count = calls.filter(c=>c.name==='PutObjectCommand'&&c.key===finalKey).length;
 await api('v2/images/complete',writer({uploadToken:prepared.uploadToken}));
 assert.equal(calls.filter(c=>c.name==='PutObjectCommand'&&c.key===finalKey).length,count);
 assert.equal((await prepareImage()).status,'existing');
 await api('v2/images/prepare',writer({collectionId,images:[{...input,byteLength:input.byteLength+1}]}),409);
});
test('concurrent verified promotions reconcile conditional-create conflicts',async()=>{
 const different=png.slice(); different[45]^=1;
 const descriptor={sha256:hash(different),mimeType:'image/png',byteLength:different.length};
 const prep=await prepareImage(descriptor);stage(prep,different);
 raceFinalWrite=true;
 const completed=await api('v2/images/complete',writer({uploadToken:prep.uploadToken}));
 assert.equal(completed.asset.sha256,descriptor.sha256);
 assert.deepEqual(objects.get(completed.asset.location.key).bytes,different);
});
test('static JPEG/WebP accepted; truncated containers, animated and mismatched WebP rejected',async()=>{
 // Minimal structural fixtures; the validator intentionally does not decode pixels.
 const jpeg=Uint8Array.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,218,0,8,1,1,0,0,63,0,1,255,217]);
 const webp=Uint8Array.from(Buffer.concat([Buffer.from('RIFF'),Buffer.from([24,0,0,0]),Buffer.from('WEBPVP8 '),Buffer.from([11,0,0,0]),Buffer.from([0,0,0,157,1,42,1,0,1,0,0,0])]));
 for(const [bytes,mimeType] of [[jpeg,'image/jpeg'],[webp,'image/webp']]){
  const prep=await prepareImage({sha256:hash(bytes),mimeType,byteLength:bytes.length});stage(prep,bytes);
  await api('v2/images/complete',writer({uploadToken:prep.uploadToken}));
 }
 const headerOnly=Uint8Array.from(Buffer.concat([Buffer.from('RIFF'),Buffer.from([22,0,0,0]),Buffer.from('WEBPVP8X'),Buffer.from([10,0,0,0]),Buffer.alloc(10)]));
 const animated=headerOnly.slice();animated[20]=2;
 const extended=Uint8Array.from(Buffer.concat([Buffer.from('RIFF'),Buffer.from([42,0,0,0]),Buffer.from('WEBPVP8X'),Buffer.from([10,0,0,0]),Buffer.from([0,0,0,0,1,0,0,0,0,0]),Buffer.from(webp.subarray(12))]));
 for(const bytes of [headerOnly,animated,extended]){
  const prep=await prepareImage({sha256:hash(bytes),mimeType:'image/webp',byteLength:bytes.length});stage(prep,bytes);
  await api('v2/images/complete',writer({uploadToken:prep.uploadToken}),400);
 }
 const zeroComponents=Uint8Array.from(Buffer.from('ffd8ffc00008080001000100ffda00060000000000ffd9','hex'));
 const badPrep=await prepareImage({sha256:hash(zeroComponents),mimeType:'image/jpeg',byteLength:zeroComponents.length});stage(badPrep,zeroComponents);
 await api('v2/images/complete',writer({uploadToken:badPrep.uploadToken}),400);
 const swallowedEOI=Uint8Array.from(Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0000ffe00004ffd9','hex'));
 const eoiPrep=await prepareImage({sha256:hash(swallowedEOI),mimeType:'image/jpeg',byteLength:swallowedEOI.length});stage(eoiPrep,swallowedEOI);
 await api('v2/images/complete',writer({uploadToken:eoiPrep.uploadToken}),400);
 const noScan=jpeg.slice(0,15);const badJPEG=Uint8Array.from([...noScan,255,217]);
 const prep=await prepareImage({sha256:hash(badJPEG),mimeType:'image/jpeg',byteLength:badJPEG.length});stage(prep,badJPEG);
 await api('v2/images/complete',writer({uploadToken:prep.uploadToken}),400);
});
test('upstream HEAD failures remain 502; genuine misses remain 404', async () => {
 failHead=403;
 await api('v2/images/prepare',writer({collectionId,images:[input]}),502);
 await api('file-retrieval',writer({uploadedType:'R2',fileName:'valid-name'}),502);
 failHead=429;
 await api('v2/images/download',writer({collectionId,assetIds:[input.sha256]}),502);
 failHead=null;
 await api('v2/images/download',writer({collectionId,assetIds:['0'.repeat(64)]}),404);
});
test('writer download performs HEAD and renews the canonical key with a fresh 300-second URL', async () => {
 const first = (await api('v2/images/download',writer({collectionId,assetIds:[input.sha256]}))).images[0];
 assert.equal(first.key,finalKey);
 assert.equal(new URL(first.url).searchParams.get('X-Amz-Expires'),'300');
 now+=301000;
 const second = (await api('v2/images/download',writer({collectionId,assetIds:[input.sha256]}))).images[0];
 assert.notEqual(first.url,second.url); assert.equal(second.key,first.key);
 assert.ok(Date.parse(second.expiresAt)>Date.parse(first.expiresAt));
});
test('snapshot runtime validation rejects versions, foreign keys, embedded images, missing inventory, dates and duplicate IDs', async () => {
 snapshot=makeSnapshot(asset);
 const invalid=[];
 invalid.push({...snapshot,version:3});
 invalid.push({...snapshot,assets:[{...asset,location:{provider:'r2',key:`collections/${otherCollection}/images/sha256/${input.sha256}`}}]});
 invalid.push({...snapshot,assets:[{...asset,assetId:'0'.repeat(64)}]});
 invalid.push({...snapshot,assets:[]});
 invalid.push({...snapshot,data:{...snapshot.data,tables:{...snapshot.data.tables,recipes:[{...snapshot.data.tables.recipes[0],images:[{type:'base64',base64:'AAAA'}]}]}}});
 invalid.push({...snapshot,data:{...snapshot.data,tables:{...snapshot.data.tables,recipes:[{...snapshot.data.tables.recipes[0],images:[{kind:'externalUrl',url:'data:image/png;base64,AAAA'}]}]}}});
 invalid.push({...snapshot,data:{...snapshot.data,tables:{...snapshot.data.tables,recipes:[{...snapshot.data.tables.recipes[0],images:[{kind:'externalUrl',url:'https://example/?X-Amz-Signature=private'}]}]}}});
 invalid.push({...snapshot,data:{...snapshot.data,tables:{...snapshot.data.tables,recipes:[{...snapshot.data.tables.recipes[0],images:[{kind:'externalUrl',url:'https://example/?%58-Amz-Signature=private&%58-Amz-Credential=secret'}]}]}}});
 invalid.push({...snapshot,data:{...snapshot.data,tables:{...snapshot.data.tables,recipes:[snapshot.data.tables.recipes[0],snapshot.data.tables.recipes[0]]}}});
 invalid.push({...snapshot,data:{...snapshot.data,tables:{...snapshot.data.tables,pendingRecipes:[{id:snapshotId,createdAt:'yesterday',sourceUrl:''}]}}});
 invalid.push({...snapshot,data:{...snapshot.data,tables:{...snapshot.data.tables,settings:[]}}});
 for(const value of invalid) await api('v2/snapshots/commit',writer({snapshot:value}),400);
 const missing=makeSnapshot({...asset,assetId:'0'.repeat(64),sha256:'0'.repeat(64),location:{provider:'r2',key:`collections/${collectionId}/images/sha256/${'0'.repeat(64)}`}});
 await api('v2/snapshots/commit',writer({snapshot:missing}),404);
});
test('immutable manifest commit retries reconcile ambiguity and reject replacement', async () => {
 failPutAfterWrite=true;
 await api('v2/snapshots/commit',writer({snapshot}),502);
 await api('v2/snapshots/commit',writer({snapshot}));
 await api('v2/snapshots/commit',writer({snapshot:{data:snapshot.data,assets:snapshot.assets,snapshotId,collectionId,version:2,format:snapshot.format}}));
 const changed=structuredClone(snapshot); changed.data.tables.recipes[0].notes='changed';
 await api('v2/snapshots/commit',writer({snapshot:changed}),409);
 assert.deepEqual((await api('v2/snapshots/read',writer({collectionId,snapshotId}))).snapshot,snapshot);
 await api('v2/snapshots/read',writer({collectionId,snapshotId:otherSnapshot}),404);
});
test('latest publication uses CAS; retries and competing publishers behave correctly', async () => {
 const pointer=await api('v2/snapshots/publish',writer({collectionId,snapshotId,expectedRevision:null}));
 assert.equal(pointer.snapshotId,snapshotId);
 assert.equal((await api('v2/snapshots/latest',writer({collectionId}))).revision,pointer.revision);
 const retry=await api('v2/snapshots/publish',writer({collectionId,snapshotId,expectedRevision:null})); assert.deepEqual(retry,pointer);
 await api('v2/snapshots/commit',writer({snapshot:makeSnapshot(asset,otherSnapshot)}));
 await api('v2/snapshots/publish',writer({collectionId,snapshotId:otherSnapshot,expectedRevision:null}),409);
 failPutAfterWrite=true;
 await api('v2/snapshots/publish',writer({collectionId,snapshotId:otherSnapshot,expectedRevision:pointer.revision}),502);
 const next=await api('v2/snapshots/publish',writer({collectionId,snapshotId:otherSnapshot,expectedRevision:pointer.revision}));
 assert.notEqual(next.revision,pointer.revision);
 await api('v2/snapshots/publish',writer({collectionId,snapshotId,expectedRevision:pointer.revision}),409);
 const puts=calls.filter(call=>call.name==='PutObjectCommand'&&call.key.endsWith('/latest.json'));
 assert.ok(puts.some(call=>call.input.IfNoneMatch==='*'));
 assert.ok(puts.some(call=>call.input.IfMatch===pointer.revision));
});
test('share capabilities read only one immutable snapshot and members; URLs end before share expiry', async () => {
 share=await api('v2/snapshots/share',writer({collectionId,snapshotId,expiresIn:61}));
 const headers={Authorization:'Bearer '+share.shareToken};
 await api('v2/snapshots/read',{collectionId,snapshotId},200,headers);
 const download=await api('v2/images/download',{collectionId,snapshotId,assetIds:[input.sha256]},200,headers);
 assert.ok(Date.parse(download.images[0].expiresAt)<=Date.parse(share.expiresAt));
 assert.ok(Number(new URL(download.images[0].url).searchParams.get('X-Amz-Expires'))<=61);
 const before=calls.length;
 await api('v2/snapshots/read',{collectionId,snapshotId:otherSnapshot},403,headers);
 await api('v2/snapshots/read',{collectionId:otherCollection,snapshotId},403,headers);
 await api('v2/images/download',{collectionId,assetIds:[input.sha256]},403,headers);
 assert.equal(calls.length,before);
 const readBefore=calls.length;
 await api('v2/images/download',{collectionId,snapshotId,assetIds:['0'.repeat(64)]},403,headers);
 assert.ok(calls.slice(readBefore).every(call=>call.name!=='HeadObjectCommand'));
 for (const [route,body] of [['v2/images/prepare',{collectionId,images:[input]}],['v2/snapshots/commit',{snapshot}],
  ['v2/snapshots/publish',{collectionId,snapshotId,expectedRevision:null}],['v2/snapshots/share',{collectionId,snapshotId,expiresIn:61}],
  ['v2/snapshots/latest',{collectionId}],['v2/images/complete',{uploadToken:share.shareToken}]]) {
  await api(route,{pass:share.shareToken,...body},403,headers);
 }
 await api('v2/images/complete',writer({uploadToken:share.shareToken}),403);
 await api('v2/snapshots/share',writer({collectionId,snapshotId,expiresIn:604801}),400);
 now=Date.parse(share.expiresAt);
 await api('v2/snapshots/read',{collectionId,snapshotId},403,headers);
 await api('v2/images/download',{collectionId,snapshotId,assetIds:[input.sha256]},403,headers);
});
test('upload capabilities expire; pass rotation invalidates existing capabilities',async()=>{
 const oldNow=now;
 now=Date.parse('2026-11-19T13:01:00.000Z');
 await api('v2/images/complete',writer({uploadToken:prepared.uploadToken}),403);
 now=oldNow;
 const freshShare=await api('v2/snapshots/share',writer({collectionId,snapshotId,expiresIn:300}));
 await api('v2/snapshots/read',{collectionId,snapshotId},200,{Authorization:'Bearer '+freshShare.shareToken});
 await api('v2/snapshots/read',{collectionId,snapshotId},403,{Authorization:'Bearer '+freshShare.shareToken},{PASS:'rotated-synthetic-pass'});
});
test('capability signing requires a server-only secret; writer pass cannot forge tokens',async()=>{
 await api('v2/snapshots/share',writer({collectionId,snapshotId,expiresIn:300}),503,{}, {CAPABILITY_SECRET:undefined});
 await api('v2/snapshots/share',writer({collectionId,snapshotId,expiresIn:300}),503,{}, {CAPABILITY_SECRET:env.PASS});
 const payload=Buffer.from(JSON.stringify({kind:'share',collectionId,snapshotId,expiresAt:Math.floor(now/1000)+99999999})).toString('base64url');
 // Reproduce the original defect: a writer knows PASS and could mint arbitrary-expiry tokens.

 const signature=createHmac('sha256','go-groceries:v2:capabilities:'+env.PASS).update(payload).digest('base64url');
 await api('v2/snapshots/read',{collectionId,snapshotId},403,{Authorization:'Bearer '+payload+'.'+signature});
});
test('installed S3 SDK serializes immutable-create and latest CAS headers without network',async()=>{
 const requests=[];
 const wireClient=new sdk.S3Client({region:'auto',endpoint:'https://synthetic-account.r2.cloudflarestorage.com',
  credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_ACCESS_KEY_SECRET},
  requestChecksumCalculation:'WHEN_REQUIRED',requestHandler:{handle:async request=>{
   requests.push(request);
   return {response:{statusCode:200,headers:{etag:'"0123456789abcdef0123456789abcdef"'},body:new Uint8Array()}};
  }}});
 try{
  await originalSend.call(wireClient,new sdk.PutObjectCommand({Bucket:env.R2_BUCKET_NAME,Key:finalKey,Body:png,IfNoneMatch:'*'}));
  await originalSend.call(wireClient,new sdk.PutObjectCommand({Bucket:env.R2_BUCKET_NAME,Key:`collections/${collectionId}/latest.json`,Body:png,IfMatch:'"0123456789abcdef0123456789abcdef"'}));
  assert.equal(requests[0].headers['if-none-match'],'*');
  assert.equal(requests[1].headers['if-match'],'"0123456789abcdef0123456789abcdef"');
 }finally{wireClient.destroy();}
});
test('malformed and oversized JSON bodies are bounded',async()=>{
 for(const body of ['{', 'x'.repeat(2*1024*1024+4097)]) {
  const response=await app.fetch(new Request('https://worker.example/v2/images/prepare',{method:'POST',body}),env);
  assert.equal(response.status,body==='{'?400:413);
 }
});
test('v2 preflight allows exact configured origins and Authorization; legacy wildcard remains',async()=>{
 const request=origin=>new Request('https://worker.example/v2/images/download',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}});
 const allowed=await app.fetch(request('https://app.example'),env);
 assert.equal(allowed.status,204);assert.equal(allowed.headers.get('access-control-allow-origin'),'https://app.example');
 assert.ok(allowed.headers.get('access-control-allow-headers').includes('Authorization'));assert.equal(allowed.headers.get('vary'),'Origin');
 const denied=await app.fetch(request('https://evil.example'),env);assert.equal(denied.headers.get('access-control-allow-origin'),null);
 const unset=await app.fetch(request('https://app.example'),{...env,CORS_ALLOWED_ORIGINS:undefined});assert.equal(unset.headers.get('access-control-allow-origin'),null);
 const legacy=await app.fetch(new Request('https://worker.example/file-upload',{method:'OPTIONS'}),env);
 assert.equal(legacy.headers.get('access-control-allow-origin'),'*');
 await api('v2/images/download',writer({collectionId,assetIds:[input.sha256]}),200,{Origin:'https://app.example'});
});


app = createApp({client: () => client, sign: getSignedUrl, now: () => now});
vitest('offline image, snapshot, CAS and capability lifecycle (23 protocol checks)', async () => {
  for (const [name, fn] of steps) {
    try { await fn(); } catch (error) { throw new Error(name, {cause: error}); }
  }
});
vitest.each([403, 429, 500, 503])('legacy storage %s maps to 502 and logs no private data', async status => {
  const logging = vi.spyOn(console, 'error').mockImplementation(() => {});
  failHead = status;
  try {
    await api('file-retrieval', writer({uploadedType:'R2',fileName:'valid-name'}), 502);
    const text = JSON.stringify(logging.mock.calls);
    assert.ok(!text.includes(env.PASS));
    assert.ok(!text.includes(env.R2_ACCESS_KEY_SECRET));
    assert.ok(!text.includes('stub storage failure'));
    assert.ok(logging.mock.calls.length > 0);
  } finally { failHead = null; logging.mockRestore(); }
});
vitest('legacy genuine missing object maps to 404', async () => {
  await api('file-retrieval', writer({uploadedType:'R2',fileName:'missing-object'}), 404);
});
afterAll(() => { sdk.S3Client.prototype.send = originalSend; client.destroy(); });
