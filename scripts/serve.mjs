#!/usr/bin/env node
/**
 * Static dev server. No build step in development — `src/index.html` runs
 * straight from disk against the vendored three.js.
 *
 *   node scripts/serve.mjs        serve the repo (edit + reload)
 *   node scripts/serve.mjs dist   serve the built output
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] === 'dist' ? 'dist' : 'src';
const root = mode === 'dist' ? join(repo, 'dist') : repo;
const entry = mode === 'dist' ? 'index.html' : 'src/index.html';
const port = Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/' || path === '') path = '/' + entry;

  // normalize() collapses ".." so a request cannot climb out of root
  const file = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(root)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  // In dev the repo root is served, so assets the build copies out of public/
  // (favicon, _headers) are not at the path the page asks for — fall back
  // there rather than 404ing on things production serves fine.
  const candidates =
    mode === 'dist' ? [file] : [file, join(root, 'public', path.replace(/^\/+/, ''))];

  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isDirectory()) continue;
      const body = await readFile(candidate);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(candidate)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
      return;
    } catch { /* try the next candidate */ }
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
}).listen(port, () => {
  console.log(`KERR  ·  serving ${mode}  ·  http://localhost:${port}`);
});
