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
  // DISK_CHROMA is (1.00, 0.48, 0.40), an artistic default. If the
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
  // HUD telemetry is throttled. SwiftShader may draw only a handful of
  // frames per second, so await the first real update instead of assuming
  // the fixed boot-dismiss delay includes enough simulation frames.
  await ctx.waitFor(() => page.eval(`parseFloat(document.getElementById('tDin').textContent) === 4.63`),
    { timeout:15000, what:'live telemetry to replace its initial markup' });
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

test('music response updates accessibly without changing listening volume', { skip: skip() }, async () => {
  const result = await page.eval(`(() => {
    const slider = document.getElementById('response');
    const volume = document.getElementById('vol');
    const before = volume.value;
    const states = [0, 1.65, 2, 1].map(value => {
      slider.value = value;
      slider.dispatchEvent(new Event('input', { bubbles:true }));
      return { value:slider.value, output:document.getElementById('responseValue').textContent,
        spoken:slider.getAttribute('aria-valuetext') };
    });
    return { states, before, after:volume.value };
  })()`);
  assert.equal(result.before, result.after, 'visual sensitivity changed listening volume');
  assert.deepEqual(result.states.map(s => s.output), ['0%', '165%', '200%', '100%']);
  assert.deepEqual(result.states.map(s => s.spoken),
    ['0 percent', '165 percent', '200 percent', '100 percent']);
});

test('focused native controls keep their keys while scene shortcuts still work', { skip: skip() }, async () => {
  const result = await page.eval(`(() => {
    const shot = document.getElementById('shot');
    shot.value = 'cinematic';
    shot.dispatchEvent(new Event('change', { bubbles:true }));
    shot.focus();
    const selectKey = new KeyboardEvent('keydown', { key:'2', code:'Digit2', bubbles:true, cancelable:true });
    shot.dispatchEvent(selectKey);
    const selectState = { value:shot.value, prevented:selectKey.defaultPrevented };
    const response = document.getElementById('response');
    response.focus();
    const transport = document.getElementById('bPause');
    const before = transport.getAttribute('aria-label');
    const rangeKey = new KeyboardEvent('keydown', { key:' ', code:'Space', bubbles:true, cancelable:true });
    response.dispatchEvent(rangeKey);
    const rangeState = { before, after:transport.getAttribute('aria-label'), prevented:rangeKey.defaultPrevented };
    response.blur();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key:'2', code:'Digit2', bubbles:true, cancelable:true }));
    const shortcutShot = shot.value;
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key:'1', code:'Digit1', bubbles:true, cancelable:true }));
    return { selectState, rangeState, shortcutShot, restoredShot:shot.value };
  })()`);
  assert.deepEqual(result.selectState, { value:'cinematic', prevented:false });
  assert.equal(result.rangeState.before, result.rangeState.after, 'Space on sensitivity paused the music');
  assert.equal(result.rangeState.prevented, false, 'the slider lost its native Space behavior');
  assert.equal(result.shortcutShot, 'close', 'the scene shortcut never selected the close shot');
  assert.equal(result.restoredShot, 'cinematic');
});

test('cinema mode moves focus to its exit and removes hidden HUD controls', { skip: skip() }, async () => {
  const entered = await page.eval(`(() => {
    const button = document.getElementById('bCinema');
    button.focus(); button.click();
    return { cinema:document.body.classList.contains('cinema'),
      hiddenInert:document.getElementById('hud').inert,
      pressed:button.getAttribute('aria-pressed'), focus:document.activeElement.id,
      exitVisibility:getComputedStyle(document.getElementById('bExitCinema')).visibility };
  })()`);
  assert.deepEqual(entered, { cinema:true, hiddenInert:true, pressed:'true',
    focus:'bExitCinema', exitVisibility:'visible' });
  const exited = await page.eval(`(() => {
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
      key:'Escape', code:'Escape', bubbles:true, cancelable:true
    }));
    return { cinema:document.body.classList.contains('cinema'),
      hiddenInert:document.getElementById('hud').inert,
      pressed:document.getElementById('bCinema').getAttribute('aria-pressed'),
      focus:document.activeElement.id };
  })()`);
  assert.deepEqual(exited, { cinema:false, hiddenInert:false, pressed:'false', focus:'bCinema' });
});

test('the help dialog contains keyboard focus and restores it on Escape', { skip: skip() }, async () => {
  const result = await page.eval(`(() => {
    const opener = document.getElementById('bHelp');
    const help = document.getElementById('help');
    opener.focus(); opener.click();
    const opened = { focus:document.activeElement.id, hidden:help.getAttribute('aria-hidden'),
      expanded:opener.getAttribute('aria-expanded'), inert:document.getElementById('hud').inert };
    const controls = [...help.querySelectorAll('button, [href], select, input, [tabindex="0"]')]
      .filter(el => !el.disabled);
    const first = controls[0], last = controls[controls.length - 1];
    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key:'Tab', code:'Tab', bubbles:true, cancelable:true }));
    const wrapsForward = document.activeElement === first;
    first.dispatchEvent(new KeyboardEvent('keydown', { key:'Tab', code:'Tab', shiftKey:true, bubbles:true, cancelable:true }));
    const wrapsBackward = document.activeElement === last;
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', code:'Escape', bubbles:true, cancelable:true }));
    return { opened, wrapsForward, wrapsBackward, closed: {
      focus:document.activeElement.id, hidden:help.getAttribute('aria-hidden'),
      expanded:opener.getAttribute('aria-expanded'), inert:document.getElementById('hud').inert
    }};
  })()`);
  assert.deepEqual(result.opened, { focus:'bClose', hidden:'false', expanded:'true', inert:true });
  assert.ok(result.wrapsForward && result.wrapsBackward, 'Tab escaped the modal');
  assert.deepEqual(result.closed, { focus:'bHelp', hidden:'true', expanded:'false', inert:false });
});

test('a local track plays through the picker path and can return to the score', { skip: skip() }, async () => {
  await page.eval(`(() => {
    // A deterministic PCM tone exercises actual browser decoding, blob CSP,
    // the file-picker callback and MediaElementAudioSource routing. No
    // external fixture or network fetch is needed.
    const rate = 22050, samples = rate * 2;
    const bytes = new ArrayBuffer(44 + samples * 2), wav = new DataView(bytes);
    const word = (offset, text) => { for (let i = 0; i < text.length; i++) wav.setUint8(offset + i, text.charCodeAt(i)); };
    word(0, 'RIFF'); wav.setUint32(4, 36 + samples * 2, true); word(8, 'WAVE'); word(12, 'fmt ');
    wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
    wav.setUint32(24, rate, true); wav.setUint32(28, rate * 2, true);
    wav.setUint16(32, 2, true); wav.setUint16(34, 16, true); word(36, 'data'); wav.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++) wav.setInt16(44 + i * 2, Math.sin(i * 2 * Math.PI * 220 / rate) * 6000, true);
    const files = new DataTransfer();
    files.items.add(new File([bytes], 'local-tone.wav', { type:'audio/wav' }));
    const picker = document.getElementById('file');
    picker.files = files.files;
    picker.dispatchEvent(new Event('change', { bubbles:true }));
  })()`);
  await ctx.waitFor(() => page.eval(`document.getElementById('audioStatus').textContent === 'AUDIO REACTIVE'`),
    { timeout:15000, what:'local PCM audio playback' });
  const imported = await page.eval(`({
    source:document.getElementById('audioSource').textContent,
    title:document.getElementById('trackTitle').textContent,
    duration:document.getElementById('t2').textContent,
    scoreVisible:!document.getElementById('bScore').hidden,
    segments:document.querySelectorAll('#map .seg').length
  })`);
  assert.deepEqual(imported, { source:'LOCAL AUDIO', title:'local-tone.wav', duration:'0:02', scoreVisible:true, segments:1 });
  await page.eval(`document.getElementById('bScore').click()`);
  await ctx.waitFor(() => page.eval(`document.getElementById('audioSource').textContent === 'GENERATIVE SCORE'`),
    { timeout:15000, what:'original score restoration' });
  const restored = await page.eval(`({
    duration:document.getElementById('t2').textContent,
    scoreHidden:document.getElementById('bScore').hidden,
    segments:document.querySelectorAll('#map .seg').length,
    status:document.getElementById('audioStatus').textContent
  })`);
  assert.deepEqual(restored, { duration:'4:00', scoreHidden:true, segments:10, status:'LIVE SYNTHESIS' });
});

test('exact edge-on and polar views retain the volume and the appropriate shadow', { skip: skip() }, async t => {
  const views = await page.eval(`(async () => {
    const response = document.getElementById('response');
    response.value = 0; response.dispatchEvent(new Event('input', { bubbles:true }));
    const palette = document.getElementById('palette');
    palette.value = 'gargantua'; palette.dispatchEvent(new Event('change', { bubbles:true }));
    const shot = document.getElementById('shot');
    const canvas = document.getElementById('gl');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const result = {};
    for (const name of ['edge', 'top', 'under']) {
      shot.value = name; shot.dispatchEvent(new Event('change', { bubbles:true }));
      result[name] = await new Promise(resolve => requestAnimationFrame(() => {
        const w = canvas.width, h = canvas.height, px = new Uint8Array(w * h * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let center = 0, centerN = 0, annulus = 0, annulusN = 0;
        let strip = 0, stripN = 0, stripLit = 0, xx = 0, yy = 0, mass = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const dx = (x + .5 - w / 2) / h, dy = (y + .5 - h / 2) / h;
          if (Math.abs(dx) > .42 || Math.abs(dy) > .42) continue;
          const i = (y * w + x) * 4, v = Math.max(px[i], px[i + 1], px[i + 2]);
          const radius = Math.hypot(dx, dy);
          if (radius < .035) { center += v; centerN++; }
          if (radius > .11 && radius < .34) { annulus += v; annulusN++; }
          if (Math.abs(dy) < .010 && Math.abs(dx) < .36) {
            strip += v; stripN++; if (v > 30) stripLit++;
          }
          const weight = Math.max(0, v - 35);
          mass += weight; xx += weight * dx * dx; yy += weight * dy * dy;
        }
        resolve({ center:center / centerN, annulus:annulus / annulusN,
          strip:strip / stripN, stripLit:stripLit / stripN, aspect:xx / Math.max(yy, 1e-8),
          mass, error:gl.getError() });
      }));
    }
    shot.value = 'cinematic'; shot.dispatchEvent(new Event('change', { bubbles:true }));
    response.value = 1; response.dispatchEvent(new Event('input', { bubbles:true }));
    return result;
  })()`);
  t.diagnostic('cardinal framebuffer statistics: ' + JSON.stringify(views));
  for (const [name, frame] of Object.entries(views)) {
    assert.equal(frame.error, 0, `${name} generated a WebGL error`);
    assert.ok(Number.isFinite(frame.aspect) && frame.mass > 10000, `${name} did not render a readable disk`);
  }
  // At exact edge-on incidence, the foreground volume crosses the central
  // sightline. Erasing all emission when a ray is later captured would fail
  // this check; an infinitely thin sign-change-only disk can also disappear.
  assert.ok(views.edge.strip > 25 && views.edge.stripLit > .3,
    'the foreground disk vanished when the camera entered its exact plane');
  for (const name of ['top', 'under']) {
    const frame = views[name];
    assert.ok(frame.annulus > 20, `${name} lost the face of the accretion volume`);
    assert.ok(frame.center < frame.annulus * .5,
      `${name} filled the empty axial sightline instead of preserving the central shadow`);
    assert.ok(frame.aspect > .60 && frame.aspect < 1.65,
      `${name} collapsed the polar disk into an oblique stripe (moment ratio ${frame.aspect})`);
  }
  const ratio = views.top.annulus / views.under.annulus;
  assert.ok(ratio > .4 && ratio < 2.5, 'one hemisphere became dark or grossly overexposed');
});

test('touch release, cancellation and capture loss resume cinematic star motion', { skip: skip() }, async t => {
  // Read the camera actually uploaded to the ray shader. This observes the
  // production input/render path without exposing or changing camera state.
  await page.eval(`(() => {
    if (document.body.classList.contains('boot')) document.getElementById('go').click();
    if (document.getElementById('bPause').getAttribute('aria-label') === 'Pause') document.getElementById('bPause').click();
    const canvas = document.getElementById('gl'), gl = canvas.getContext('webgl2');
    const useProgram = gl.useProgram;
    let program, location, pointerId, captureLosses = 0;
    const remember = e => { pointerId = e.pointerId; };
    const lost = () => { captureLosses++; };
    canvas.addEventListener('pointerdown', remember);
    canvas.addEventListener('lostpointercapture', lost);
    gl.useProgram = function(p) {
      useProgram.call(this, p);
      if (!location && p) {
        const found = gl.getUniformLocation(p, 'uCamPos');
        if (found) { program = p; location = found; }
      }
    };
    window.__orbitProbe = {
      read: (frames = 1) => new Promise(resolve => {
        const next = () => {
          if (--frames > 0) return requestAnimationFrame(next);
          const p = gl.getUniform(program, location);
          resolve(Math.atan2(p[2], p[0]));
        };
        requestAnimationFrame(next);
      }),
      loseCapture: () => { captureLosses = 0; canvas.releasePointerCapture(pointerId); },
      captureLosses: () => captureLosses,
      restore: () => { gl.useProgram = useProgram; canvas.removeEventListener('pointerdown', remember); canvas.removeEventListener('lostpointercapture', lost); }
    };
  })()`);
  let touchActive = false;
  const send = async (type, points) => {
    await page.send('Input.dispatchTouchEvent', { type, touchPoints:points });
    touchActive = points.length > 0;
  };
  const read = frames => page.eval(`window.__orbitProbe.read(${frames})`);
  const movement = (a, b) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
  try {
    await page.send('Emulation.setTouchEmulationEnabled', { enabled:true, maxTouchPoints:5 });
    const point = await page.eval(`({ x:innerWidth * .5, y:innerHeight * .25, id:1 })`);
    const moved = { ...point, x:point.x + 35, y:point.y + 8 };
    for (const ending of ['touchEnd', 'touchCancel', 'lostpointercapture']) {
      await page.eval(`document.getElementById('bReset').click()`);
      await send('touchStart', [point]);
      await send('touchMove', [moved]);
      const held = await read(2), stillHeld = await read(8);
      assert.ok(movement(held, stillHeld) < 1e-5, 'camera drifted underneath a held touch');
      if (ending === 'lostpointercapture') {
        await page.eval(`window.__orbitProbe.loseCapture()`);
        // Capture release takes effect when the next pointer event processes
        // the pending override; requesting it alone is not a capture-loss event.
        await send('touchMove', [{ ...moved, x:moved.x + 1 }]);
      } else await send(ending, []);
      const released = await read(2), later = await read(12);
      if (ending === 'lostpointercapture') assert.ok(await page.eval(`window.__orbitProbe.captureLosses()`) > 0,
        'the test must actually dispatch lostpointercapture');
      assert.ok(movement(released, later) > 0.001, `${ending} left the stars frozen`);
      t.diagnostic(`${ending}: camera advanced ${movement(released, later).toFixed(5)} radians after release`);
      if (ending === 'lostpointercapture') await send('touchEnd', []);
    }
  } finally {
    if (touchActive) await send('touchCancel', []);
    await page.send('Emulation.setTouchEmulationEnabled', { enabled:false });
    await page.eval(`window.__orbitProbe.restore(); delete window.__orbitProbe; document.getElementById('bReset').click()`);
  }
});

test('still no errors after interacting', { skip: skip() }, () => {
  assert.deepEqual(errors, [], 'errors appeared during playback:\n' + errors.join('\n'));
});
