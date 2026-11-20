import { createHash, randomUUID } from 'node:crypto';
// Implements the S3 commands used by the real Worker; all state is synthetic memory.
export function createStorage(base = 'http://127.0.0.1:18927') {
  const objects = new Map(), tickets = new Map(), events = [];
  const controls = {expireGet:0,corruptGet:0,failPublish:0};
  const env = {ENABLE_PASS:'true', PASS:'test-writer-pass', CAPABILITY_SECRET:'synthetic-server-only-capability-signing-key',
    R2_BUCKET_NAME:'synthetic-bucket',R2_ACCOUNT_ID:'synthetic-account',R2_ACCESS_KEY_ID:'synthetic-key',R2_ACCESS_KEY_SECRET:'synthetic-secret',
    CORS_ALLOWED_ORIGINS:'http://127.0.0.1:18926'};
  const etag = bytes => '"' + createHash('md5').update(bytes).digest('hex') + '"';
  const failure = status => Object.assign(new Error('Synthetic storage failure'),{$metadata:{httpStatusCode:status}});
  const metadata = object => ({ContentLength:object.bytes.length, ContentType:object.type, Metadata:object.metadata ?? {}, ETag:etag(object.bytes)});
  const client = {async send(command) {
    const {Key,Body,ContentType,Metadata,IfNoneMatch,IfMatch} = command.input;
    const name = command.constructor.name; events.push({action:name,key:Key});
    const object = objects.get(Key);
    if (name === 'HeadObjectCommand' || name === 'GetObjectCommand') {
      if (!object) throw failure(404);
      if (name === 'HeadObjectCommand') return metadata(object);
      const bytes = object.bytes.slice();
      return {...metadata(object),Body:{transformToWebStream:() => new ReadableStream({start(c) {c.enqueue(bytes);c.close();}})}};
    }
    if (name === 'PutObjectCommand') {
      if (IfNoneMatch === '*' && object || IfMatch && (!object || etag(object.bytes) !== IfMatch)) throw failure(412);
      const bytes = Uint8Array.from(Body);
      objects.set(Key,{bytes,type:ContentType,metadata:Metadata}); return {ETag:etag(bytes)};
    }
    if (name === 'DeleteObjectCommand') {objects.delete(Key); return {};}
    throw new Error('Unexpected S3 command: '+name);
  }};
  async function sign(_client, command, options) {
    const id = randomUUID(), method = command.constructor.name === 'PutObjectCommand' ? 'PUT' : 'GET';
    tickets.set(id,{key:command.input.Key,method,type:command.input.ContentType,expires:Date.now()+options.expiresIn*1000});
    return base+'/objects/'+encodeURIComponent(command.input.Key)+'?ticket='+id;
  }
  async function objectFetch(url, options = {}) {
    const key = decodeURIComponent(url.pathname.slice('/objects/'.length)), ticket = tickets.get(url.searchParams.get('ticket'));
    const method = options.method ?? 'GET';
    if (!ticket || ticket.key !== key || ticket.method !== method || ticket.expires <= Date.now()) return new Response('',{status:403});
    if (method === 'PUT') {
      if (new Headers(options.headers).get('Content-Type') !== ticket.type) return new Response('',{status:403});
      const bytes = new Uint8Array(await options.body.arrayBuffer()); objects.set(key,{bytes,type:ticket.type});
      events.push({action:'SIGNED_PUT',key}); return new Response('');
    }
    if (controls.expireGet > 0) {controls.expireGet--;ticket.expires = 0;return new Response('',{status:403});}
    const object = objects.get(key); if (!object) return new Response('',{status:404});
    const bytes = object.bytes.slice(); if (controls.corruptGet > 0) {controls.corruptGet--;bytes[bytes.length-1] ^= 1;}
    events.push({action:'SIGNED_GET',key}); return new Response(bytes,{headers:{'Content-Type':object.type}});
  }
  return {objects,tickets,events,controls,env,client,sign,objectFetch};
}
