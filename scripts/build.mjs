#!/usr/bin/env node
/**
 * Build: fold src/index.html plus the vendored three.js into one
 * self-contained file in dist/, then copy anything in public/ alongside it.
 *
 * There is no bundler here on purpose. The project is a single page with one
 * canvas — no routes, no components, no imports to resolve. Inlining keeps the
 * defining property of the thing (open the file, it runs, offline, forever)
 * and lets the CSP forbid every external origin outright.
 */
import { readFile, writeFile, mkdir, rm, cp, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { externalLoads } from './external.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src', 'index.html');
const VENDOR = join(root, 'vendor', 'three.bundle.js');
const PUBLIC = join(root, 'public');
const DIST = join(root, 'dist');

const kb = (n) => (n / 1024).toFixed(1) + ' KB';

const html = await readFile(SRC, 'utf8');
const three = await readFile(VENDOR, 'utf8');

// The one external <script> becomes an inline one. Anything else pointing off
// this origin is a mistake we want to hear about rather than ship.
const TAG = /<script src="\.\.\/vendor\/three\.bundle\.js"><\/script>/;
if (!TAG.test(html)) {
  console.error('✗ vendor script tag not found in src/index.html — did the path change?');
  process.exit(1);
}

// `</script>` anywhere inside the payload would close the tag early.
const safeThree = three.replace(/<\/script>/gi, '<\\/script>');
let out = html.replace(TAG, `<script>\n${safeThree}\n</script>`);

const stray = externalLoads(out);
if (stray.length) {
  console.error('✗ external references would break the CSP:\n  ' + stray.join('\n  '));
  process.exit(1);
}

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await writeFile(join(DIST, 'index.html'), out);
if (existsSync(PUBLIC)) await cp(PUBLIC, DIST, { recursive: true });

const raw = Buffer.byteLength(out);
const gz = gzipSync(out, { level: 9 }).length;
const br = brotliCompressSync(out, {
  params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
}).length;

console.log('✓ dist/index.html');
console.log(`  raw ${kb(raw)}  ·  gzip ${kb(gz)}  ·  brotli ${kb(br)}  (what Cloudflare serves)`);
