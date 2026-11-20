import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {createStorage} from './memory-storage.mjs';
const root = resolve(import.meta.dirname,'..'), output = process.env.REGRESSION_ARTIFACT_DIR;
if (!output) throw new Error('Missing isolated artifact directory');
const base = 'http://127.0.0.1:18927', storage = createStorage(base);
const bundle = join(output,'worker-stub.cjs');
await build({entryPoints:[join(root,'apps/go-groceries-images-meal-resolver/src/index.ts')],bundle:true,platform:'node',format:'cjs',packages:'external',outfile:bundle,
  alias:Object.fromEntries([
    ['@go-groceries/backend/endpoints/error','libraries/shared-backend/src/endpoints/error.ts'],
    ...['image-assets','snapshot','file-upload'].map(name => ['@go-groceries/frontend/'+name,'apps/frontend/src/shareable/'+name+'.ts']),
  ].map(([name,path]) => [name,join(root,path)]))});
// Resolve external packages from this worktree rather than the temporary bundle directory.
const {Module} = createRequire(import.meta.url)('node:module');
const loaded = new Module(bundle);loaded.filename = bundle;loaded.paths = Module._nodeModulePaths(root);
loaded._compile(await readFile(bundle,'utf8'),bundle);
const app = loaded.exports.createApp({client:()=>storage.client,sign:storage.sign,now:Date.now});
const server = http.createServer(async (request,response) => {
  try {
    const url = new URL(request.url,base);const chunks = [];let length = 0;
    for await (const chunk of request) {length += chunk.length;if (length > 5*1024*1024) throw new Error('Test body too large');chunks.push(chunk);}
    const bytes = Buffer.concat(chunks);
    let result;
    if (url.pathname === '/__state') result = Response.json({events:storage.events,snapshots:[...storage.objects].filter(([key])=>key.includes('/snapshots/')).map(([,object])=>JSON.parse(new TextDecoder().decode(object.bytes)))});
    else if (url.pathname.startsWith('/objects/')) {
      const origin = request.headers.origin;
      if (request.method === 'OPTIONS') result = new Response(null,{status:204});
      else result = await storage.objectFetch(url,{method:request.method,headers:request.headers,body:new Blob([bytes],{type:request.headers['content-type']})});
      if (origin === 'http://127.0.0.1:18926') result.headers.set('Access-Control-Allow-Origin',origin);
      result.headers.set('Access-Control-Allow-Methods','GET,PUT,OPTIONS');result.headers.set('Access-Control-Allow-Headers','Content-Type');
    } else result = await app.fetch(new Request(url,{method:request.method,headers:request.headers,...(bytes.length ? {body:bytes}: {})}),storage.env);
    response.writeHead(result.status,Object.fromEntries(result.headers));response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {console.error(error.message);response.writeHead(500);response.end('Synthetic stub failure');}
});
server.listen(18927,'127.0.0.1',() => console.log('Synthetic Worker/R2 ready on loopback 18927'));
