import {spawnSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const state = mkdtempSync(join(tmpdir(),'gg-types-'));
const env = {...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:join(state,'wrangler.log'),
  XDG_CONFIG_HOME:join(state,'config'),XDG_CACHE_HOME:join(state,'cache'),XDG_DATA_HOME:join(state,'data'),TURBO_TELEMETRY_DISABLED:'1'};
// Turbo builds dependency exports before their consumers.
const commands = [['build'],
  ...['@go-groceries/backend','@go-groceries/frontend','go-groceries-images-api','go-groceries-youtube-api'].map(name=>['check-types','--workspace',name,'--','--force'])];
let failed = false;
for (const args of commands) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',['run',...args],{stdio:'inherit',env});
  console.log('TYPE GATE '+args.join(' ')+' exit_code='+result.status);
  if (result.status !== 0) {failed=true;break;}
}
process.exitCode = failed ? 1 : 0;
