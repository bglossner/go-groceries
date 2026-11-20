// @vitest-environment node
import {test,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const frontend = resolve(import.meta.dirname,'..');

test('a clean build-node emits every package export at its declared path', () => {
  const output = mkdtempSync(join(tmpdir(),'gg-export-build-'));
  try {
    // A new output directory ensures stale build/shareable files cannot mask a
    // changed TypeScript source root. Use the real package build configuration.
    const result = spawnSync(process.execPath,[require.resolve('typescript/bin/tsc'),
      '-p',join(frontend,'tsconfig.build.json'),'--outDir',output],
    {cwd:frontend,encoding:'utf8',timeout:20000});
    expect(result.error).toBeUndefined();
    expect(result.status,result.stdout + result.stderr).toBe(0);
    const manifest = JSON.parse(readFileSync(join(frontend,'package.json'),'utf8'));
    let runtimeTargets = 0;
    const check = (value) => {
      if (typeof value === 'string') {
        const generated = value.startsWith('./build/');
        const target = generated ? join(output,value.slice('./build/'.length)) : resolve(frontend,value);
        if (generated) runtimeTargets++;
        expect(existsSync(target),'Missing export target: '+value).toBe(true);
      } else {
        for (const target of Object.values(value)) check(target);
      }
    };
    check(manifest.exports);
    expect(runtimeTargets).toBeGreaterThan(0);
  } finally {
    rmSync(output,{recursive:true,force:true});
  }
},30000);
