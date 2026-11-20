import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
export default defineConfig({
  resolve: { alias: {
    '@go-groceries/backend/endpoints/error': root + 'libraries/shared-backend/src/endpoints/error.ts',
    '@go-groceries/backend/models': root + 'libraries/shared-backend/src/models/index.ts',
    ...Object.fromEntries(['image-assets', 'snapshot', 'file-upload', 'file-retrieval'].map(name =>
      ['@go-groceries/frontend/' + name, root + 'apps/frontend/src/shareable/' + name + '.ts'])),
  } },
  test: {
    include: ['tests/**/*.test.{ts,mjs}'],
    environment: process.cwd().endsWith('/frontend') ? 'jsdom' : 'node',
    setupFiles: [root + 'test/offline.mjs', ...(process.cwd().endsWith('/frontend') ? [root + 'test/dom.mjs'] : [])],
    env: { VITE_FILE_SYNC_BASE_URL: 'http://127.0.0.1:18927' },
    pool: 'forks', maxWorkers: 1, fileParallelism: false,
    testTimeout: 10000, hookTimeout: 10000,
  },
});
