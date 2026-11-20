import { expect, test } from 'vitest';
test('committed migration harness: ambiguity, concurrent ownership, resumability and safe diagnostics', async () => {
  document.body.innerHTML = '<pre id="result"></pre>';
  await import('./image-migration.browser.ts');
  expect(document.title, document.querySelector('#result').textContent).toBe('Image migration regression PASSED');
});
