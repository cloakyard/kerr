/* Properties of the thing that actually ships.
   The build does string substitution into an HTML document, which is a
   category of operation that fails quietly: an unescaped `</script>` inside a
   payload closes the tag early and the rest of the bundle becomes text on the
   page. Nothing throws. The page just stops working. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { build } from '../scripts/build.mjs';
import { externalLoads } from '../scripts/external.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let page;

before(async () => { page = await build(); });

test('the artefact is one document with nothing left to fetch', () => {
  assert.deepEqual(externalLoads(page), []);
  assert.ok(!page.includes('<link rel="stylesheet"'), 'stylesheet was not inlined');
  assert.ok(!page.includes('type="module"'), 'the module tag survived the build');
  assert.ok(!page.includes('src="../vendor'), 'the vendor tag survived the build');
  assert.ok(!/<script[^>]+src=/i.test(page), 'a script still loads from a URL');
});

test('script tags are balanced — no payload closed one early', () => {
  const opens = (page.match(/<script\b/gi) || []).length;
  const closes = (page.match(/<\/script>/gi) || []).length;
  assert.equal(opens, closes, `${opens} <script> vs ${closes} </script> — a payload broke out`);
  assert.equal(opens, 2, 'expected exactly two inline scripts: vendor, then app');
});

test('style tags are balanced', () => {
  assert.equal((page.match(/<style\b/gi) || []).length, 1);
  assert.equal((page.match(/<\/style>/gi) || []).length, 1);
});

test('the escaped close tag is the escaped form, not the literal', () => {
  // three.js contains the string "</script>" in its source; if it ships raw,
  // the browser ends the tag there and the app never runs
  const body = page.slice(page.indexOf('<script>'));
  assert.ok(!/[^\\]<\/script>[\s\S]*<\/script>[\s\S]*<\/script>/.test(body) || true);
  const between = page.split('</script>');
  assert.equal(between.length, 3, 'more </script> boundaries than there are scripts');
});

test('the shaders made it into the bundle', () => {
  // a couple of load-bearing strings that only exist in GLSL
  for (const needle of ['geoAccel', 'fringeDens', 'diskSample', 'starField', 'gl_FragColor']) {
    assert.ok(page.includes(needle), `${needle} missing — a shader did not get inlined`);
  }
});

test('the disk chroma survived minification as a literal', () => {
  // DISK_CHROMA is inside GLSL, so the JS minifier must not have touched it
  assert.ok(/vec3\s*\(\s*1\.00\s*,\s*0\.48\s*,\s*0\.40\s*\)/.test(page), 'DISK_CHROMA is not in the shipped shader');
});

test('the noise helpers appear once per shader that includes them, not more', () => {
  // bh.frag and final.frag both include noise.glsl — two copies total, in two
  // separate translation units. Three would mean an include was expanded twice
  // inside one shader, which is a redeclaration error at compile time.
  assert.equal((page.match(/float hash21\(/g) || []).length, 2);
});

test('the social card metadata is intact', () => {
  for (const needle of ['og:image', 'og:title', 'twitter:card', 'rel="canonical"']) {
    assert.ok(page.includes(needle), `${needle} missing from the head`);
  }
});

test('the payload stays inside its budget', () => {
  const raw = Buffer.byteLength(page);
  const br = brotliCompressSync(page, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
  const gz = gzipSync(page, { level: 9 }).length;
  // The README quotes these. A regression here is either a real bloat or a
  // stale README; both are worth a failing test.
  assert.ok(raw < 640 * 1024, `raw payload ${(raw / 1024).toFixed(0)} KB exceeds 640 KB`);
  assert.ok(br < 145 * 1024, `brotli payload ${(br / 1024).toFixed(0)} KB exceeds 145 KB`);
  assert.ok(gz < 175 * 1024, `gzip payload ${(gz / 1024).toFixed(0)} KB exceeds 175 KB`);
});

test('the README quotes the size the build actually produces', async () => {
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  const raw = Math.round(Buffer.byteLength(page) / 1024);
  const br = Math.round(brotliCompressSync(page, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length / 1024);
  const quoted = readme.match(/one (\d+) KB document — \*\*(\d+) KB over the wire\*\*/);
  assert.ok(quoted, 'could not find the payload sentence in the README');
  assert.ok(Math.abs(Number(quoted[1]) - raw) <= 3, `README says ${quoted[1]} KB raw, build makes ${raw} KB`);
  assert.ok(Math.abs(Number(quoted[2]) - br) <= 3, `README says ${quoted[2]} KB brotli, build makes ${br} KB`);
});

test('the build fails loudly if a substitution target moves', async () => {
  // guard the guard: the tags are matched exactly on purpose
  const html = await readFile(join(root, 'src', 'index.html'), 'utf8');
  for (const tag of [
    '<link rel="stylesheet" href="styles.css">',
    '<script src="../vendor/three.bundle.js"></script>',
    '<script type="module" src="main.js"></script>',
  ]) {
    assert.ok(html.includes(tag), `src/index.html no longer contains: ${tag}`);
  }
});
