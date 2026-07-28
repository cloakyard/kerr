#!/usr/bin/env node
/**
 * Build: bundle src/main.js, fold it plus the stylesheet and the vendored
 * three.js into one self-contained file in dist/, then copy public/ alongside.
 *
 * The source is a module tree; the artefact is a single document. Those are
 * separate decisions and both are deliberate. Modules are how the thing stays
 * maintainable — layers, explicit imports, shaders in files a validator can
 * read. One document is what the thing *is*: open it and it runs, offline,
 * forever, and the CSP can forbid every external origin outright because
 * after load there is nothing left to fetch.
 *
 *   node scripts/build.mjs           minified, what ships
 *   node scripts/build.mjs --dev     readable, with an inline sourcemap
 */
import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as esbuild from 'esbuild';
import { externalLoads } from './external.mjs';
import { glsl } from './glsl.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src');
const VENDOR = join(root, 'vendor', 'three.bundle.js');
const PUBLIC = join(root, 'public');
const DIST = join(root, 'dist');

const kb = (n) => (n / 1024).toFixed(1) + ' KB';

/* The three tags the build replaces. They are matched exactly rather than by
 * a loose pattern, so renaming or moving any of them fails here, loudly,
 * instead of silently shipping a page that fetches paths production does not
 * have. */
const CSS_TAG = '<link rel="stylesheet" href="styles.css">';
const THREE_TAG = '<script src="../vendor/three.bundle.js"></script>';
const MAIN_TAG = '<script type="module" src="main.js"></script>';

// `</script>` anywhere inside a payload would close the tag early.
const safe = (js) => js.replace(/<\/script>/gi, '<\\/script>');

/**
 * @param {{dev?: boolean, outDir?: string}} opts
 *   dev     unminified, with an inline sourcemap
 *   outDir  where to write. Defaults to dist/. The tests pass a temp directory
 *           so two suites can build concurrently without one wiping the
 *           other's output from under it.
 */
export async function build({ dev = false, outDir = DIST } = {}) {
  const out = await esbuild.build({
    entryPoints: [join(SRC, 'main.js')],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    minify: !dev,
    sourcemap: dev ? 'inline' : false,
    legalComments: 'none',
    plugins: [glsl],
    write: false,
    logLevel: 'silent',
  });
  const app = out.outputFiles[0].text;

  const html = await readFile(join(SRC, 'index.html'), 'utf8');
  const css = await readFile(join(SRC, 'styles.css'), 'utf8');
  const three = await readFile(VENDOR, 'utf8');

  for (const [name, tag] of [
    ['stylesheet', CSS_TAG],
    ['vendor script', THREE_TAG],
    ['app script', MAIN_TAG],
  ]) {
    if (!html.includes(tag))
      throw new Error(`${name} tag not found in src/index.html — did the path change?\n  expected: ${tag}`);
  }
  if (/<\/style/i.test(css)) throw new Error('src/styles.css contains "</style" and cannot be inlined');

  const page = html
    .replace(CSS_TAG, `<style>\n${css}</style>`)
    .replace(THREE_TAG, `<script>\n${safe(three)}\n</script>`)
    .replace(MAIN_TAG, `<script>\n${safe(app)}</script>`);

  const stray = externalLoads(page);
  if (stray.length) throw new Error('external references would break the CSP:\n  ' + stray.join('\n  '));

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'index.html'), page);
  if (existsSync(PUBLIC)) await cp(PUBLIC, outDir, { recursive: true });

  return page;
}

/* Run directly — scripts/dev.mjs imports build() instead. */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dev = process.argv.includes('--dev');
  try {
    const page = await build({ dev });
    const raw = Buffer.byteLength(page);
    console.log('✓ dist/index.html' + (dev ? '  (dev — unminified, inline sourcemap)' : ''));
    if (dev) {
      console.log(`  raw ${kb(raw)}`);
    } else {
      const gz = gzipSync(page, { level: 9 }).length;
      const br = brotliCompressSync(page, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
      console.log(`  raw ${kb(raw)}  ·  gzip ${kb(gz)}  ·  brotli ${kb(br)}  (what Cloudflare serves)`);
    }
  } catch (e) {
    console.error('✗ ' + (e.message || e));
    process.exit(1);
  }
}
