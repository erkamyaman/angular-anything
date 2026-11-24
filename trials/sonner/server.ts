import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

const roots = { original: [4301, join(import.meta.dirname, 'react', 'dist')], port: [4302, join(import.meta.dirname, 'angular', 'dist')] } as const;

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

for (const [name, [port, root]] of Object.entries(roots)) {
  createServer(async (request, response) => {
    const { pathname } = new URL(`http://localhost${request.url}`);
    if (request.method === 'POST' && pathname === '/api/save') {
      request.resume();
      setTimeout(() => response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name: 'draft' })), 300);
      return;
    }
    const path = pathname === '/' ? '/index.html' : pathname;
    const body = request.method === 'GET' && !path.includes('..') ? await readFile(join(root, path)).catch(() => undefined) : undefined;
    if (body === undefined) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`Not found: ${request.method} ${path}\n`);
      return;
    }
    response.writeHead(200, { 'content-type': contentTypes[extname(path)] ?? 'application/octet-stream' }).end(body);
  }).listen(port, '127.0.0.1', () => console.log(`${name.padEnd(9)} http://localhost:${port}`));
}
