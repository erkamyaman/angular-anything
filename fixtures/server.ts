import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { parseArgs } from 'node:util';

const ports = { react: 4101, vue: 4102, angularjs: 4103, angular: 4104, stub: 4105 };
type Name = keyof typeof ports;

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const stubPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Tasks</title>
    <link rel="stylesheet" href="/shared/fixture.css">
  </head>
  <body>
    <div id="root"><main class="app"></main></div>
  </body>
</html>
`;

const fixtures = import.meta.dirname;

function serve(name: Name): void {
  const server = createServer(async (request, response) => {
    const { pathname } = new URL(`http://localhost${request.url}`);
    const path = pathname === '/' ? '/index.html' : pathname;
    const route = `${request.method} ${path}`;

    if (route === 'POST /api/tasks') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk);
      response.writeHead(201, { 'content-type': 'application/json' }).end(Buffer.concat(chunks));
      return;
    }

    if (route === 'GET /api/suggestions') {
      setTimeout(() => {
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify(['Call the bank', 'Water the plants']));
      }, 150);
      return;
    }

    if (name === 'stub' && route === 'GET /index.html') {
      response.writeHead(200, { 'content-type': contentTypes['.html'] }).end(stubPage);
      return;
    }

    let body: Buffer | undefined;
    if (request.method === 'GET') {
      const file =
        path === '/shared/fixture.css'
          ? join(fixtures, 'shared', 'fixture.css')
          : join(fixtures, name, 'dist', path);
      body = await readFile(file).catch(() => undefined);
    }
    if (body === undefined) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`Not found: ${route}\n`);
      return;
    }
    response
      .writeHead(200, { 'content-type': contentTypes[extname(path)] ?? 'application/octet-stream' })
      .end(body);
  });

  server.listen(ports[name], '127.0.0.1', () => {
    console.log(`${name.padEnd(9)} http://localhost:${ports[name]}`);
  });
}

const names = Object.keys(ports) as Name[];
const { only } = parseArgs({ options: { only: { type: 'string' } } }).values;
const selected = only === undefined ? names : names.filter((name) => name === only);

if (selected.length === 0) {
  console.error(`Unknown fixture "${only}". Use one of: ${names.join(', ')}.`);
  process.exit(2);
}

for (const name of selected) serve(name);
