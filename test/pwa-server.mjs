import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '../apps/frontend/dist');
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
createServer(async (req, res) => {
  try {
    let path = resolve(
      root,
      '.' + decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname),
    );
    if (!path.startsWith(root + '/')) path = resolve(root, 'index.html');
    try {
      if (!(await stat(path)).isFile()) path = resolve(root, 'index.html');
    } catch {
      path = resolve(root, 'index.html');
    }
    res.writeHead(200, {
      'Content-Type': types[extname(path)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(await readFile(path));
  } catch {
    res.writeHead(500);
    res.end('Local test server error');
  }
}).listen(18926, '127.0.0.1', () => console.log('Own built PWA test server on loopback 18926'));
