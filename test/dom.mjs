import 'fake-indexeddb/auto';
import { Blob, File } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { vi } from 'vitest';
// Use one binary realm; fake IndexedDB clones Node Blobs byte-for-byte.
vi.stubGlobal('Blob', Blob);
vi.stubGlobal('File', File);
vi.stubGlobal('crypto', webcrypto);
vi.stubGlobal('FileReader', class {
  result = null;
  error = null;
  readAsArrayBuffer(blob) { this.read(blob, bytes => bytes); }
  readAsText(blob) { this.read(blob, bytes => new TextDecoder().decode(bytes)); }
  readAsDataURL(blob) { this.read(blob, bytes => 'data:' + blob.type + ';base64,' + Buffer.from(bytes).toString('base64')); }
  read(blob, convert) {
    blob.arrayBuffer().then(bytes => { this.result = convert(bytes); this.onload?.({ target: this }); this.onloadend?.({ target: this }); },
      error => { this.error = error; this.onerror?.({ target: this }); });
  }
});
// jsdom has no pixel decoder. Browser e2e exercises decoding and canvas encoding.
vi.stubGlobal('createImageBitmap', async () => ({ width: 1, height: 1, close() {} }));
