// Unit suites cannot make HTTP requests or open sockets, even if a mock is missing.
import { vi, afterEach } from 'vitest';
import net from 'node:net';
const nativeFetch = globalThis.fetch;
const offlineFetch = (input, options) => {
  if (String(input).startsWith('data:image/')) return nativeFetch(input, options);
  throw new Error('Network forbidden in unit tests');
};
vi.stubGlobal('fetch', offlineFetch);
vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(() => {
  throw new Error('Sockets forbidden in unit tests');
});
afterEach(() => { vi.unstubAllEnvs(); vi.stubGlobal('fetch', offlineFetch); });
