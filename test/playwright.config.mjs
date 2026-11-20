import {join} from 'node:path';
import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'../apps/frontend/tests/e2e', testMatch:'**/*.spec.mjs',
  outputDir:join(process.env.REGRESSION_ARTIFACT_DIR,'test-results'), workers:1, retries:0, timeout:60000,
  reporter:'list', use:{baseURL:'http://127.0.0.1:18926',viewport:{width:1100,height:950},actionTimeout:10000,
    launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,args:['--no-sandbox']},
    screenshot:'only-on-failure', trace:'retain-on-failure'},
});
