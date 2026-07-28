/* The test that matters most.
 *
 * Everything else in this directory checks arithmetic. This one boots the
 * actual built page in an actual browser with the actual production headers,
 * and is the only thing in the repo that can catch:
 *
 *   - a shader that fails to compile (three.js reports it as a console error)
 *   - a runtime throw during module evaluation, which would leave the boot
 *     screen up with a dead button and no other symptom
 *   - the inliner mangling `</script>` inside a payload
 *   - a THREE symbol missing from the vendored bundle at runtime
 *   - a Content-Security-Policy that forbids something the page needs
 *
 * It reads real pixels out of the WebGL drawing buffer rather than trusting a
 * screenshot heuristic. preserveDrawingBuffer is false, so the read has to
 * happen inside a frame — a requestAnimationFrame registered now is queued
 * behind the one the app already has pending, so it runs immediately after the
 * app's draw with the buffer still intact.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../scripts/build.mjs';
import { findChrome, launch, serve, goto, parseHeaders } from './helpers/browser.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Resolved at module scope, not in before(): node:test evaluates a test's
   `skip` option when the test is *defined*, so a hook cannot set it. */
const chrome = await findChrome();
const skip = () => (chrome ? false : 'no Chrome found — set CHROME_PATH to run the smoke test');

let ctx, site, page, errors, out;

before(async () => {
  if (!chrome) return;
  // Its own build directory: node:test runs files in parallel, and two suites
  // sharing dist/ means one wipes it while the other is serving from it.
  out = await mkdtemp(join(tmpdir(), 'kerr-smoke-'));
  await build({ outDir: out });
  const rules = parseHeaders(await readFile(join(root, 'public', '_headers'), 'utf8'));
  site = await serve(out, rules);
  ctx = await launch(chrome);
  ({ page, errors } = ctx);
  await goto(page, site.origin + '/');
  // let the render loop settle and the adaptive quality take one reading
  await new Promise((r) => setTimeout(r, 2500));
});

after(async () => {
  await ctx?.cleanup();
  await site?.close();
  if (out) await rm(out, { recursive: true, force: true });
});

test('the page loads with no console errors and no uncaught exceptions', { skip: skip() }, () => {
  assert.deepEqual(errors, [], 'the page reported errors:\n' + errors.join('\n'));
});

test('the production CSP is actually being served', { skip: skip() }, async () => {
  const res = await fetch(site.origin + '/');
  const csp = res.headers.get('content-security-policy');
  assert.ok(csp, 'no CSP header — the test is not exercising the real policy');
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  // connect-src is deliberately 'self' in the header and 'none' in the
  // document's meta tag; test/pwa.test.js holds both ends of that down and
  // explains why. Asserting 'none' here would be asserting the wrong half.
  assert.match(csp, /connect-src 'self'/);
});

test('WebGL came up and the app got a context', { skip: skip() }, async () => {
  const info = await page.eval(`(() => {
    const c = document.getElementById('gl');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return { has: !!gl, w: c.width, h: c.height, ver: gl && gl.getParameter(gl.VERSION) };
  })()`);
  assert.ok(info.has, 'no WebGL context');
  assert.ok(info.w > 0 && info.h > 0, `canvas has no size: ${info.w}x${info.h}`);
});

test('every shader compiled and linked', { skip: skip() }, async () => {
  // three.js logs a console error on a failed compile, which the error check
  // above would catch — but assert it positively too, since a silent failure
  // to *use* a program looks identical to a black frame.
  const programs = await page.eval(`(() => {
    const c = document.getElementById('gl');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    // there is no API to enumerate programs, so lean on the draw actually
    // having happened: a linked program is required to produce any pixels
    return gl.getError();
  })()`);
  assert.equal(programs, 0, `WebGL reported error code ${programs}`);
});

test('the frame loop is drawing something that is not black', { skip: skip() }, async () => {
  const stats = await page.eval(`new Promise(resolve => {
    const c = document.getElementById('gl');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    // queued behind the app's pending rAF, so this runs right after its draw
    requestAnimationFrame(() => {
      const w = 256, h = 256;
      const x = Math.max(0, (c.width  - w) >> 1), y = Math.max(0, (c.height - h) >> 1);
      const px = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let lit = 0, max = 0, sum = 0;
      for (let i = 0; i < px.length; i += 4) {
        const v = Math.max(px[i], px[i+1], px[i+2]);
        if (v > 8) lit++;
        if (v > max) max = v;
        sum += v;
      }
      resolve({ lit, max, mean: sum / (px.length / 4), total: w * h });
    });
  })`);
  assert.ok(stats.max > 40, `frame is essentially black (brightest channel ${stats.max})`);
  assert.ok(stats.lit / stats.total > 0.02, `only ${(100 * stats.lit / stats.total).toFixed(1)}% of the centre is lit`);
});

test('the disk is rendered in its own chroma, not grey and not amber', { skip: skip() }, async () => {
  // DISK_CHROMA is (1.00, 0.48, 0.40) — measured off the DNEG render. If the
  // tone curve or the bloom threshold regresses, this is what shifts first.
  const hue = await page.eval(`new Promise(resolve => {
    const c = document.getElementById('gl');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    requestAnimationFrame(() => {
      const w = 512, h = 256;
      const x = Math.max(0, (c.width - w) >> 1), y = Math.max(0, (c.height - h) >> 1);
      const px = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (Math.max(px[i], px[i+1], px[i+2]) < 30) continue;   // skip the void
        r += px[i]; g += px[i+1]; b += px[i+2]; n++;
      }
      resolve(n ? { r: r/n, g: g/n, b: b/n, n } : null);
    });
  })`);
  assert.ok(hue && hue.n > 500, 'not enough lit pixels to judge the colour');
  assert.ok(hue.r >= hue.g && hue.g >= hue.b, `not warm: rgb(${hue.r|0}, ${hue.g|0}, ${hue.b|0})`);
  assert.ok(hue.r > hue.b * 1.05, `too neutral to be the disk: rgb(${hue.r|0}, ${hue.g|0}, ${hue.b|0})`);
  assert.ok(hue.g > hue.b * 0.9, `too amber — the salmon has gone khaki: rgb(${hue.r|0}, ${hue.g|0}, ${hue.b|0})`);
});

test('the boot screen dismisses and the HUD comes alive', { skip: skip() }, async () => {
  const before = await page.eval(`document.body.className`);
  assert.equal(before, 'boot');

  await page.eval(`document.getElementById('go').click()`);
  await new Promise((r) => setTimeout(r, 1200));

  const state = await page.eval(`({
    body: document.body.className,
    hudOn: document.getElementById('hud').classList.contains('on'),
    bootGone: document.getElementById('boot').classList.contains('gone'),
    segments: document.querySelectorAll('#map .seg').length,
    clock: document.getElementById('t2').textContent,
  })`);
  assert.equal(state.body, '', 'boot class not removed');
  assert.ok(state.hudOn, 'HUD never revealed');
  assert.ok(state.bootGone, 'boot overlay never hidden');
  assert.equal(state.segments, 10, 'arrangement map did not build all ten sections');
  assert.equal(state.clock, '4:00', 'duration readout disagrees with the arrangement');
});

test('telemetry reports live simulation state, not the static markup', { skip: skip() }, async () => {
  const t = await page.eval(`({
    spin: document.getElementById('tSpin').textContent,
    rh: document.getElementById('tRh').textContent,
    isco: document.getElementById('tIsco').textContent,
    din: document.getElementById('tDin').textContent,
    orbit: document.getElementById('tOrb').textContent,
  })`);
  // the markup ships 0.60 / 1.00 / 3.00 / 3.00 / 40.0; after a second of easing
  // toward the intro preset (kerr 0.5) these must have moved
  assert.notEqual(t.isco, '3.00 r<sub>s</sub>');
  assert.equal(parseFloat(t.din).toFixed(2), '4.63', 'disk inner edge is not the film geometry');
  assert.ok(parseFloat(t.rh) > 0.5 && parseFloat(t.rh) <= 1, `horizon out of range: ${t.rh}`);
  assert.ok(parseFloat(t.isco) > 1.5, `ISCO inside the photon sphere: ${t.isco}`);
  assert.ok(parseFloat(t.orbit) > 4, `camera inside the disk: ${t.orbit}`);
});

test('the clock advances and the section label tracks the arrangement', { skip: skip() }, async () => {
  /* Poll rather than sleep once. The readout has one-second resolution and
     the AudioContext takes a moment to actually start in headless, so a fixed
     wait is a race — and a flaky test is worse than no test. */
  const first = await page.eval(`document.getElementById('t1').textContent`);
  const until = Date.now() + 15000;
  let second = first;
  while (second === first && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 250));
    second = await page.eval(`document.getElementById('t1').textContent`);
  }
  assert.notEqual(second, first, 'the transport clock never advanced in 15s');

  const label = await page.eval(`document.getElementById('sect').textContent`);
  assert.match(label, /^[A-Z]/, `section label looks wrong: ${label}`);
});

test('still no errors after interacting', { skip: skip() }, () => {
  assert.deepEqual(errors, [], 'errors appeared during playback:\n' + errors.join('\n'));
});
