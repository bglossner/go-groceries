import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,mkdtemp,readdir,symlink} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import net from 'node:net';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url), root = resolve(import.meta.dirname,'..');
if (process.platform !== 'linux') throw new Error('The E2E launcher requires Linux /proc (Linux or WSL).');
// Resolve installed binaries before assigning a fresh browser home/cache.
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || require('@playwright/test').chromium.executablePath();
const artifacts = process.env.REGRESSION_ARTIFACT_DIR ? resolve(process.env.REGRESSION_ARTIFACT_DIR) : await mkdtemp(join(tmpdir(),'go-groceries-e2e-'));
await mkdir(artifacts,{recursive:true});
// Chromium uses Unix sockets in its temp directory; keep that path below 108 bytes.
const runtime = await mkdtemp(join(tmpdir(),'gg-e2e-'));
await mkdir(join(runtime,'browser-home'),{recursive:true});
await writeFile(join(artifacts,'runtime.json'),JSON.stringify({runtime}));
const env = {PATH:process.env.PATH,HOME:join(runtime,'browser-home'),LANG:'C.UTF-8',REGRESSION_ARTIFACT_DIR:artifacts,
  PLAYWRIGHT_CHROMIUM_EXECUTABLE:chromiumExecutable,
  REGRESSION_PHOTO_PATH:process.env.REGRESSION_PHOTO_PATH,
  VITE_FILE_SYNC_BASE_URL:'http://127.0.0.1:18927',VITE_YOUTUBE_API_PASS:'',VITE_YOUTUBE_API_BASE_URL:'http://127.0.0.1:18927',
  XDG_CACHE_HOME:join(runtime,'cache'),XDG_CONFIG_HOME:join(runtime,'config'),XDG_DATA_HOME:join(runtime,'data'),TMPDIR:runtime,
  npm_config_cache:join(artifacts,'npm-cache'),WRANGLER_SEND_METRICS:'false'};
const groups = [];
let stopping = false, shutdownPromise, signalExitCode;
async function identity(pid) {
  const cmdline = await readFile('/proc/'+pid+'/cmdline','utf8');
  const stat = await readFile('/proc/'+pid+'/stat','utf8');const fields = stat.slice(stat.lastIndexOf(')')+2).split(' ');
  return {pid,cmdline,startTicks:fields[19],group:Number(fields[2]),state:fields[0]};
}
async function free(port) {
  await new Promise((resolve,reject) => {const server=net.createServer();server.once('error',reject);server.listen(port,'127.0.0.1',()=>server.close(resolve));});
}
async function start(script,args,cwd,extraEnv={}) {
  if (stopping) throw new Error('Test run interrupted');
  const child = spawn(process.execPath,[script,...args],{cwd,env:{...env,...extraEnv},detached:true,stdio:'inherit'});
  child.exitCodeRecorded = null;
  child.done = new Promise(resolve => {
    child.once('exit',code => {child.exitCodeRecorded = code ?? 1;resolve(code ?? 1);});
    child.once('error',error => {console.error(error);child.exitCodeRecorded = 1;resolve(1);});
  });
  if (!child.pid) throw new Error('Own child failed to spawn');
  // Register the detached group before any asynchronous identity read. A fast
  // exiting leader must not make surviving descendants invisible to cleanup.
  const record = {child,saved:{pid:child.pid,group:child.pid},identityReady:null};
  groups.push(record);
  record.identityReady = identity(child.pid).then(saved=>Object.assign(record.saved,saved),
    error=>{record.saved.identityError=error.message;});
  await record.identityReady;
  await writeFile(join(artifacts,'process-groups.json'),JSON.stringify(groups.map(g=>g.saved),null,2));
  if (record.saved.identityError) throw new Error('Cannot verify own spawned group: '+record.saved.identityError);
  if (stopping) await stop(record);
  return child;
}
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function ready(url,child) {
  const deadline = Date.now()+30000;
  while (Date.now()<deadline) {
    if (stopping) throw new Error('Test run interrupted');
    if (child.exitCodeRecorded !== null) throw new Error('Own server exited: '+child.exitCodeRecorded);
    try {const response=await fetch(url,{signal:AbortSignal.timeout(1000)});if (response.ok) return;} catch { /* own server starting */ }
    await delay(100);
  }
  throw new Error('Own server did not become ready');
}
async function signalVerified(saved,signal) {
  let current;
  try {current = await identity(saved.pid);} catch (error) {if (error.code === 'ENOENT') return;throw error;}
  if (current.cmdline !== saved.cmdline || current.startTicks !== saved.startTicks || current.group !== saved.group || current.group !== saved.pid) {
    throw new Error('Own process identity changed; left untouched');
  }
  await writeFile(join(artifacts,'teardown.log'),JSON.stringify({verified:current,signal})+'\n',{flag:'a'});
  process.kill(-saved.group,signal);
}
async function groupMembers(group) {
  const members = [];
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = await readFile('/proc/'+name+'/stat','utf8');const fields = stat.slice(stat.lastIndexOf(')')+2).split(' ');
      if (Number(fields[2]) === group && fields[0] !== 'Z') members.push(await identity(Number(name)));
    } catch (error) {if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error;}
  }
  return members;
}
async function drained(group,timeout) {
  const deadline = Date.now()+timeout;
  do {if (!(await groupMembers(group)).length) return true;await delay(100);} while (Date.now()<deadline);
  return false;
}
async function stop(record) {
  await record.identityReady;
  const {child,saved} = record;
  if (saved.identityError) {
    if (await drained(saved.group,5000)) return;
    throw new Error('Unverifiable spawned group '+saved.group+' did not drain; left untouched');
  }
  // Record descendants while the original leader can still prove group ownership.
  let witnesses = [];
  if (child.exitCodeRecorded === null) {
    const leader = await identity(saved.pid).catch(error=>{if (error.code === 'ENOENT') return;throw error;});
    if (leader && leader.cmdline === saved.cmdline && leader.startTicks === saved.startTicks && leader.group === saved.group) {
      witnesses = await groupMembers(saved.group);
    }
    await signalVerified(saved,'SIGTERM');
  }
  if (await drained(saved.group,5000)) return;
  // The recorded group may outlive its leader. A previously recorded live member
  // must prove its continuity before that same group can receive escalation.
  let witness;
  for (const record of [saved,...witnesses]) {
    const current = await identity(record.pid).catch(error=>{if (error.code === 'ENOENT') return;throw error;});
    if (current && current.cmdline === record.cmdline && current.startTicks === record.startTicks && current.group === saved.group) {witness=current;break;}
  }
  if (!witness) throw new Error('Group did not drain; no verified original member remains. Left untouched.');
  await writeFile(join(artifacts,'teardown.log'),JSON.stringify({verified:witness,recordedGroup:saved.group,signal:'SIGKILL'})+'\n',{flag:'a'});
  process.kill(-saved.group,'SIGKILL');
  if (!await drained(saved.group,5000)) throw new Error('Own group did not drain after bounded cleanup');
}
async function remainingMembers() {
  return (await Promise.all(groups.map(({saved})=>groupMembers(saved.group)))).flat();
}
function shutdown() {
  stopping = true;
  return shutdownPromise ??= (async () => {
    const errors = [];
    for (const group of [...groups].reverse()) {try {await stop(group);} catch (error) {errors.push(error.message);}}
    // Never signal children discovered by scanning after a recorded leader has exited.
    const members = await remainingMembers();
    await writeFile(join(artifacts,'cleanup.json'),JSON.stringify({errors,remaining:members},null,2));
    if (members.length || errors.length) throw new Error('Cleanup incomplete: '+JSON.stringify({errors,members}));
  })();
}
for (const [signal,code] of [['SIGINT',130],['SIGTERM',143]]) process.on(signal,() => {
  signalExitCode = code;process.exitCode = code;
  void shutdown().catch(error=>{console.error(error);process.exitCode=1;});
});
async function runPwaUpdateReproduction() {
  const frontend = join(root, 'apps/frontend');
  const vite = join(dirname(require.resolve('vite/package.json', { paths: [frontend] })), 'bin/vite.js');
  const currentDist = join(runtime, 'current-dist');
  const firstDist = join(runtime, 'first-dist');
  const nextDist = join(runtime, 'next-dist');

  for (const [mode, outDir] of [['pwa-test', firstDist], ['pwa', nextDist]]) {
    const build = await start(vite, ['build', '--mode', mode, '--outDir', outDir], frontend);
    const result = await build.done;
    console.log(`PWA update ${mode} build exit_code=${result}`);
    if (result !== 0) return result;
  }

  await symlink(firstDist, currentDist);
  const server = await start(join(root, 'test/pwa-server.mjs'), [], root, { GG_PWA_DIST: currentDist });
  await ready('http://127.0.0.1:18926', server);
  const tests = await start(require.resolve('@playwright/test/cli'), [
    'test', '--config', join(root, 'test/playwright.config.mjs'), 'pwa-update.spec.mjs',
  ], root, { GG_PWA_UPDATE_CURRENT_DIST: currentDist, GG_PWA_UPDATE_FIRST_DIST: firstDist, GG_PWA_UPDATE_NEXT_DIST: nextDist });
  const result = await tests.done;
  console.log(`PWA update reproduction exit_code=${result}`);
  return result;
}

async function runRegression() {
  await free(18927);
  const worker = await start(join(root,'test/worker-stub.mjs'),[],root);await ready('http://127.0.0.1:18927/__state',worker);
  const vite = await start(join(dirname(require.resolve('vite/package.json',{paths:[join(root,'apps/frontend')]})),'bin/vite.js'),['--port','18926','--strictPort','--mode','regression'],join(root,'apps/frontend'));
  await ready('http://127.0.0.1:18926',vite);
  const tests = await start(require.resolve('@playwright/test/cli'),['test','--config',join(root,'test/playwright.config.mjs'),...(process.env.REGRESSION_GREP?['--grep',process.env.REGRESSION_GREP]:[])],root);
  const result = await tests.done;
  console.log('E2E UI exit_code='+result);
  process.exitCode = signalExitCode ?? result;
  if (result===0&&!stopping) {
    await stop(groups.find(record=>record.child===vite));
    await free(18926);
    const build=await start(join(dirname(require.resolve('vite/package.json',{paths:[join(root,'apps/frontend')]})),'bin/vite.js'),['build','--mode','pwa-test'],join(root,'apps/frontend'));
    const built=await build.done;console.log('E2E PWA build exit_code='+built);
    if(built!==0) process.exitCode=built;
    else {
      const server=await start(join(root,'test/pwa-server.mjs'),[],root);await ready('http://127.0.0.1:18926',server);
      const offline=await start(require.resolve('@playwright/test/cli'),['test','--config',join(root,'test/playwright.config.mjs'),'--grep','installed PWA offline'],root,{GG_PWA_PHASE:'true'});
      const code=await offline.done;console.log('E2E PWA tests exit_code='+code);process.exitCode=signalExitCode??code;
    }
  }
}

try {
  await free(18926);
  if (process.argv.includes('--pwa-update-only')) {
    const result = await runPwaUpdateReproduction();
    process.exitCode = signalExitCode ?? result;
  } else {
    await runRegression();
  }
} catch (error) {console.error(error);process.exitCode=signalExitCode ?? 1;}
finally {
  try {await shutdown();} catch (error) {console.error(error);process.exitCode=1;}
  console.log('E2E artifacts: '+artifacts);
}
