/* The install layer, and the security property it must not cost.
 *
 * The interesting test here is the last one. `connect-src 'none'` on the
 * document is a headline claim in the README — the page cannot open a
 * connection once it has loaded, enforced by the browser. A service worker
 * needs to reach the network to be network-first, and Cloudflare *appends*
 * when two _headers rules name the same header, so a blanket `connect-src
 * 'none'` also lands on /sw.js and leaves the worker able to serve nothing but
 * 503s. That is not a hypothesis: it was measured, and it broke every second
 * visit.
 *
 * The resolution is that the header grants 'self' and a meta tag in the
 * document intersects it back to 'none'. These tests hold both ends of that
 * down, because it is exactly the kind of arrangement someone later "tidies
 * up" into a single header.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../scripts/build.mjs';
import { findChrome, launch, serve, goto, parseHeaders, headersFor } from './helpers/browser.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const chrome = await findChrome();
const skip = () => (chrome ? false : 'no Chrome found — set CHROME_PATH to run the PWA tests');

let rules, manifest, ctx, site, page, errors, out;

before(async () => {
  // Its own build directory — see the note in smoke.test.js
  out = await mkdtemp(join(tmpdir(), 'kerr-pwa-'));
  await build({ outDir: out });
  rules = parseHeaders(await readFile(join(root, 'public', '_headers'), 'utf8'));
  manifest = JSON.parse(await readFile(join(root, 'public', 'manifest.webmanifest'), 'utf8'));
  if (!chrome) return;
  site = await serve(out, rules);
  ctx = await launch(chrome);
  ({ page, errors } = ctx);
});

after(async () => {
  await ctx?.cleanup();
  await site?.close();
  if (out) await rm(out, { recursive: true, force: true });
});

/* ---- static: the manifest ---------------------------------------------- */

test('the manifest has everything an install prompt needs', () => {
  assert.equal(manifest.name, 'KERR — Singularity Visualizer');
  assert.equal(manifest.short_name, 'KERR');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.ok(['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display));
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
});

test('the manifest colours match the page, so the splash does not flash', async () => {
  const html = await readFile(join(root, 'src', 'index.html'), 'utf8');
  const theme = html.match(/<meta name="theme-color" content="([^"]+)"/)[1];
  assert.equal(manifest.theme_color, theme);
  assert.equal(manifest.background_color, theme, 'splash background should be the void colour');
});

test('icons cover both the 192/512 pair and a maskable', () => {
  const any = manifest.icons.filter((i) => i.purpose === 'any');
  const maskable = manifest.icons.filter((i) => i.purpose === 'maskable');
  assert.ok(any.some((i) => i.sizes === '192x192'), 'no 192 icon');
  assert.ok(any.some((i) => i.sizes === '512x512'), 'no 512 icon');
  assert.equal(maskable.length, 1, 'exactly one maskable icon expected');
  assert.equal(maskable[0].sizes, '512x512');
});

test('every file the manifest names is actually shipped', async () => {
  for (const src of [...manifest.icons.map((i) => i.src), ...manifest.screenshots.map((s) => s.src)]) {
    assert.ok(existsSync(join(out, src.replace(/^\//, ''))), `manifest points at a missing file: ${src}`);
  }
});

test('the PNG icons really are the sizes they claim', async () => {
  for (const icon of manifest.icons.filter((i) => i.type === 'image/png')) {
    const buf = await readFile(join(out, icon.src.replace(/^\//, '')));
    assert.equal(buf.subarray(1, 4).toString(), 'PNG', `${icon.src} is not a PNG`);
    const [w, h] = [buf.readUInt32BE(16), buf.readUInt32BE(20)];
    assert.equal(`${w}x${h}`, icon.sizes, `${icon.src} is ${w}x${h}, manifest says ${icon.sizes}`);
  }
});

test('the page links the manifest and an apple-touch-icon', async () => {
  const html = await readFile(join(root, 'src', 'index.html'), 'utf8');
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png">/);
  // iOS ignores the manifest for home-screen bookmarks and reads these instead
  assert.match(html, /apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /apple-mobile-web-app-title" content="KERR"/);
});

/* ---- static: the policy ------------------------------------------------ */

test('the served CSP for the document is the strict one', () => {
  const csp = headersFor(rules, '/index.html').get('Content-Security-Policy');
  assert.equal(csp.length, 1, 'the document should get exactly one CSP header');
  assert.match(csp[0], /default-src 'none'/);
  assert.match(csp[0], /frame-ancestors 'none'/, 'frame-ancestors only works in a header');
  assert.match(csp[0], /manifest-src 'self'/, 'default-src none would block the manifest');
  assert.match(csp[0], /worker-src 'self'/, 'default-src none would block the worker script');
});

test('the meta policy tightens connect-src back to none for the page', async () => {
  const html = await readFile(join(root, 'src', 'index.html'), 'utf8');
  const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(meta, 'the document has no meta CSP — the page could open connections');
  assert.match(meta[1], /connect-src 'none'/);
  // and the header is deliberately looser, so the worker can still fetch
  const header = headersFor(rules, '/sw.js').get('Content-Security-Policy');
  assert.ok(header.some((h) => /connect-src 'self'/.test(h)), 'the worker cannot reach the network');
});

test('/sw.js gets two policies, which is why the meta tag exists', () => {
  // Documenting the Cloudflare behaviour that forced the design. If this ever
  // becomes one header, the meta tag can go — and this test should be the
  // thing that tells you.
  const csp = headersFor(rules, '/sw.js').get('Content-Security-Policy');
  assert.equal(csp.length, 2, 'expected the /* policy plus the worker policy');
});

/* ---- live: the worker -------------------------------------------------- */

test('the worker registers, controls the page, and reaches the network', { skip: skip() }, async () => {
  await goto(page, site.origin + '/');
  await new Promise((r) => setTimeout(r, 1500));

  const reg = await page.eval(`(async () => {
    try {
      const r = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      return { ok: true, active: !!r.active };
    } catch (e) { return { ok: false, err: String(e) }; }
  })()`);
  assert.ok(reg.ok, `registration failed: ${reg.err}`);

  await goto(page, site.origin + '/');
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(await page.eval(`!!navigator.serviceWorker.controller`), 'the worker is not controlling');

  /* Probe over <img>, not fetch(): the document's own connect-src is 'none',
     so a page-level fetch is blocked by design and would tell us nothing about
     the worker. The request still goes through the worker either way. */
  const probe = await page.eval(`new Promise(res => {
    const i = new Image();
    i.onload = () => res({ loaded: true, w: i.naturalWidth });
    i.onerror = () => res({ loaded: false });
    i.src = '/icons/icon-192.png?cachebust=' + Math.random();
    setTimeout(() => res({ timeout: true }), 8000);
  })`);
  assert.ok(probe.loaded, 'the worker could not fetch an uncached asset — it is serving 503s');
  assert.equal(probe.w, 192);
});

test('the document still cannot open a connection', { skip: skip() }, async () => {
  const blocked = await page.eval(`(async () => {
    try { await fetch('/manifest.webmanifest?x=' + Math.random()); return 'allowed'; }
    catch (e) { return 'blocked'; }
  })()`);
  assert.equal(blocked, 'blocked', 'connect-src no longer holds — the README claim is false');
});

test('the page loads with the network cut', { skip: skip() }, async () => {
  await page.send('Network.enable');
  await page.send('Network.emulateNetworkConditions',
    { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  errors.length = 0;
  await goto(page, site.origin + '/');
  await new Promise((r) => setTimeout(r, 2500));

  const state = await page.eval(`({
    title: document.title,
    three: typeof THREE,
    canvas: (() => { const c = document.getElementById('gl'); return c ? c.width * c.height : 0; })(),
    goWired: !!(document.getElementById('go') || {}).onclick,
  })`);
  assert.equal(state.title, 'KERR — Singularity Visualizer');
  assert.equal(state.three, 'object', 'the vendored bundle did not survive offline');
  assert.ok(state.canvas > 0, 'no canvas offline');
  assert.ok(state.goWired, 'the app did not boot offline');
  assert.deepEqual(errors, [], 'errors while offline:\n' + errors.join('\n'));

  await page.send('Network.emulateNetworkConditions',
    { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
});
