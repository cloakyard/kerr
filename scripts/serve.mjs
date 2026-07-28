#!/usr/bin/env node
/**
 * Static server for dist/.
 *
 * It only ever serves the built output. Development used to run src/ straight
 * from disk, which stopped being possible when the shaders became files a
 * browser cannot import — and serving a source tree that no longer boots
 * would be worse than not offering it at all. scripts/dev.mjs rebuilds on
 * change and points this at the result, so dev and production run identical
 * code.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(repo, 'dist');
const port = Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/' || path === '') path = '/index.html';

  // normalize() collapses ".." so a request cannot climb out of root
  const file = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(root)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    if ((await stat(file)).isDirectory()) throw new Error('directory');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  }
}).listen(port, () => {
  console.log(`KERR  ·  http://localhost:${port}`);
});
