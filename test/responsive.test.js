/* Layout and reachability invariants across narrow, short and wide screens.
   Render/physics quality is covered separately by the framebuffer smoke suite. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../scripts/build.mjs';
import { findChrome, launch, serve, goto, parseHeaders } from './helpers/browser.mjs';
import { setViewport, frameSettled, inspectLayout } from './helpers/responsive.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chrome = await findChrome();
const skip = chrome ? false : 'no Chrome found — set CHROME_PATH to run responsive checks';
const viewports = [
  { width:320, height:568, touch:true },
  { width:568, height:320, touch:true },
  { width:390, height:844, touch:true },
  { width:844, height:390, touch:true },
  { width:689, height:943, touch:true },
  { width:768, height:1024, touch:true },
  { width:1024, height:768, touch:true },
  { width:1280, height:720 },
  { width:1920, height:1080 },
  { width:2560, height:1080 },
];
let out, ctx, site;
before(async () => {
  if (!chrome) return;
  out = await mkdtemp(join(tmpdir(), 'kerr-responsive-'));
  await build({ outDir:out });
  site = await serve(out, parseHeaders(await readFile(join(root, 'public/_headers'), 'utf8')));
  ctx = await launch(chrome);
});
after(async () => {
  await ctx?.cleanup(); await site?.close();
  if (out) await rm(out, { recursive:true, force:true });
});

function withinViewport(control, viewport) {
  assert.ok(control.x >= -.5 && control.y >= -.5 && control.right <= viewport.width + .5 && control.bottom <= viewport.height + .5,
    `${control.id} leaves ${viewport.width}×${viewport.height}: ${JSON.stringify(control)}`);
  assert.ok(control.hit, `${control.id} is obscured at its center`);
}
function assertLiveLayout(layout) {
  assert.ok(layout.scrollWidth <= layout.clientWidth + 1, 'the page overflows horizontally');
  for (const control of layout.controls) {
    withinViewport(control, layout.viewport);
    if (layout.touch) assert.ok(control.width >= 24 && control.height >= 24,
      `${control.id} is too small to target with touch (${control.width}×${control.height})`);
    if (layout.touch && control.id === 'bFull') assert.ok(control.width >= 44 && control.height >= 44,
      `fullscreen touch target shrank below 44×44 (${control.width}×${control.height})`);
  }
  // All entries are independent hit targets; their positive-area intersection
  // indicates a collision even when the smaller target's center is uncovered.
  for (let i = 0; i < layout.controls.length; i++) for (let j = i + 1; j < layout.controls.length; j++) {
    const a = layout.controls[i], b = layout.controls[j];
    const overlapX = Math.min(a.right, b.right) - Math.max(a.x, b.x);
    const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
    assert.ok(overlapX <= .5 || overlapY <= .5, `${a.id} overlaps ${b.id} by ${overlapX}×${overlapY}`);
  }
  const identity = layout.regions['.identity'], display = layout.regions['.tr'];
  if (identity && display) assert.ok(identity.right <= display.x + .5 || identity.bottom <= display.y + .5,
    'brand and display controls overlap');
}

for (const viewport of viewports) {
  test(`intro, live controls and overlays remain reachable at ${viewport.width}×${viewport.height}${viewport.touch ? ' touch' : ''}`,
    { skip, timeout:60000 }, async t => {
      const { page } = ctx, errorStart = ctx.errors.length;
      await setViewport(page, viewport, { reducedMotion:true });
      await goto(page, site.origin + '/');
      await frameSettled(page, 2);
      const intro = await inspectLayout(page);
      assert.equal(intro.viewport.width, viewport.width);
      assert.equal(intro.viewport.height, viewport.height);
      assert.equal(intro.touch, !!viewport.touch, 'touch media emulation did not take effect');
      assert.ok(intro.scrollWidth <= intro.clientWidth + 1, 'intro overflows horizontally');
      if (viewport.touch) {
        const hints = await page.eval(`(() => {
          const visible = selector => {
            const element = document.querySelector(selector), rect = element.getBoundingClientRect();
            return getComputedStyle(element).visibility === 'visible' && rect.width > 0 && rect.height > 0;
          };
          return { pinch:visible('.intro-footer .touch-hint'), scroll:visible('.intro-footer .pointer-hint') };
        })()`);
        assert.deepEqual(hints, { pinch:true, scroll:false }, 'touch introduction shows the wrong zoom gesture');
      }
      // A short screen may legitimately scroll its introduction. Every entry
      // action must actually become visible and clickable through that scroll.
      const introActions = await page.eval(`(() => {
        const controls = [document.getElementById('go'), document.getElementById('own'), ...document.querySelectorAll('.seg2 button')];
        return controls.filter(element => getComputedStyle(element).display !== 'none' && element.getClientRects().length)
          .map(element => {
            element.scrollIntoView({ block:'center', inline:'nearest', behavior:'instant' });
            const r = element.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return { id:element.id || element.dataset.voice, x:r.x, y:r.y, right:r.right, bottom:r.bottom,
              hit:!!hit && (hit === element || element.contains(hit)) };
          });
      })()`);
      assert.ok(introActions.some(item => item.id === 'go'));
      for (const control of introActions) withinViewport(control, intro.viewport);
      await page.eval(`document.getElementById('go').click()`);
      await frameSettled(page, 2);
      await ctx.waitFor(() => page.eval(`getComputedStyle(document.getElementById('hud')).opacity === '1'`),
        { what:'HUD reveal after its production transition delay' });
      const required = ['bPause', 'map', 'bLoad', 'bVoice', 'vol', 'bCinema', 'bHelp'];
      const live = await ctx.waitFor(async () => {
        const layout = await inspectLayout(page);
        return required.every(id => layout.controls.some(item => item.id === id)) && layout;
      }, { what:'all live targets to finish their reveal' });
      assertLiveLayout(live);
      for (const id of required)
        assert.ok(live.controls.some(item => item.id === id), `${id} unavailable in live view: ${JSON.stringify({ live, errors:ctx.errors.slice(errorStart) })}`);
      const compact = viewport.width <= 1100 || viewport.height <= 560;
      if (compact) {
        assert.ok(live.controls.some(item => item.id === 'bView'), 'compact View opener unavailable');
        assert.ok(!live.controls.some(item => item.id === 'shot'), 'compact panel starts open');
        await page.eval(`document.getElementById('bView').click()`);
        const open = await ctx.waitFor(async () => {
          const layout = await inspectLayout(page);
          return ['shot', 'palette', 'response', 'bReset'].every(id => layout.controls.some(item => item.id === id)) && layout;
        }, { what:'the compact View controls to finish revealing' });
        for (const id of ['shot', 'palette', 'response', 'bReset'])
          assert.ok(open.controls.some(item => item.id === id), `${id} unavailable in the View panel`);
        const focus = await page.eval(`document.activeElement.id`);
        assert.equal(focus, 'shot', 'View panel should receive keyboard focus');
        // A disclosure can intentionally cover background controls. Verify its
        // own actions, including scrolling inside the panel on a short screen.
        for (const id of ['shot', 'palette', 'response', 'bReset']) {
          await page.eval(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block:'nearest', behavior:'instant' })`);
          const current = await inspectLayout(page);
          const control = current.controls.find(item => item.id === id);
          withinViewport(control, current.viewport);
          if (current.touch) assert.ok(control.height >= 44,
            `${id} in the open touch panel shrank below 44 px (${control.height})`);
        }
        await page.eval(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }))`);
        assert.deepEqual(await page.eval(`({ open:document.getElementById('bView').getAttribute('aria-expanded'), focus:document.activeElement.id, inert:document.getElementById('scenePanel').inert })`),
          { open:'false', focus:'bView', inert:true });
      } else {
        assert.ok(live.controls.some(item => item.id === 'shot'), 'desktop camera panel unavailable');
      }
      await page.eval(`document.getElementById('bHelp').click()`);
      const help = await ctx.waitFor(async () => {
        const layout = await inspectLayout(page);
        return layout.controls.some(item => item.id === 'bClose') && layout;
      }, { what:'the help exit to finish revealing' });
      const close = help.controls.find(item => item.id === 'bClose');
      assert.ok(close, 'help has no reachable exit'); withinViewport(close, help.viewport);
      const panel = help.regions['#help .panel'];
      assert.ok(panel && panel.scrollWidth <= panel.clientWidth + 1, 'help requires horizontal scrolling');
      assert.deepEqual(ctx.errors.slice(errorStart), [], 'responsive interactions produced browser errors');
      t.diagnostic(`verified ${live.controls.length} visible live targets; compact panel ${compact ? 'exercised' : 'not required'}`);
    });
}

test('help opened from cinema restores cinema and then the original control focus', { skip, timeout:45000 }, async () => {
  const { page } = ctx;
  await setViewport(page, { width:1280, height:720 }, { reducedMotion:true });
  await goto(page, site.origin + '/');
  await page.eval(`document.getElementById('go').click()`);
  await frameSettled(page, 2);
  await ctx.waitFor(() => page.eval(`getComputedStyle(document.getElementById('hud')).opacity === '1'`),
    { what:'HUD reveal after its production transition delay' });
  await page.eval(`document.getElementById('bCinema').focus(); document.getElementById('bCinema').click();
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key:'h', bubbles:true }))`);
  const help = await ctx.waitFor(async () => {
    const layout = await inspectLayout(page);
    return layout.controls.some(item => item.id === 'bClose') && layout;
  }, { what:'the help exit to finish revealing' });
  withinViewport(help.controls.find(item => item.id === 'bClose'), help.viewport);
  await page.eval(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }))`);
  assert.deepEqual(await page.eval(`({ cinema:document.body.classList.contains('cinema'), focus:document.activeElement.id,
    hudInert:document.getElementById('hud').inert, helpHidden:document.getElementById('help').getAttribute('aria-hidden') })`),
    { cinema:true, focus:'bExitCinema', hudInert:true, helpHidden:'true' });
  await page.eval(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }))`);
  assert.deepEqual(await page.eval(`({ cinema:document.body.classList.contains('cinema'), focus:document.activeElement.id,
    hudInert:document.getElementById('hud').inert })`),
    { cinema:false, focus:'bCinema', hudInert:false });
});

test('a long local-track title retains reachable transport and playback across a phone rotation', { skip, timeout:60000 }, async () => {
  const { page } = ctx, errorStart = ctx.errors.length;
  await setViewport(page, { width:320, height:568, touch:true }, { reducedMotion:true });
  await goto(page, site.origin + '/');
  const filename = 'A very long local recording — soundtrack to the hidden side of Gargantua (final extended mix).wav';
  await page.eval(`(() => {
    // Same deterministic PCM/File/DataTransfer path as smoke.test.js. A longer
    // fixture remains playing while the viewport rotates; no analyser claims.
    const rate = 22050, samples = rate * 90;
    const bytes = new ArrayBuffer(44 + samples * 2), wav = new DataView(bytes);
    const word = (offset, text) => { for (let i = 0; i < text.length; i++) wav.setUint8(offset + i, text.charCodeAt(i)); };
    word(0, 'RIFF'); wav.setUint32(4, 36 + samples * 2, true); word(8, 'WAVE'); word(12, 'fmt ');
    wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
    wav.setUint32(24, rate, true); wav.setUint32(28, rate * 2, true);
    wav.setUint16(32, 2, true); wav.setUint16(34, 16, true); word(36, 'data'); wav.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++) wav.setInt16(44 + i * 2, Math.sin(i * 2 * Math.PI * 220 / rate) * 6000, true);
    const files = new DataTransfer();
    files.items.add(new File([bytes], ${JSON.stringify(filename)}, { type:'audio/wav' }));
    const picker = document.getElementById('file'); picker.files = files.files;
    picker.dispatchEvent(new Event('change', { bubbles:true }));
  })()`);
  await ctx.waitFor(() => page.eval(`document.getElementById('audioStatus').textContent === 'AUDIO REACTIVE'`),
    { timeout:15000, what:'long-named local audio playback' });
  await page.eval(`(() => {
    const map = document.getElementById('map');
    map.dispatchEvent(new KeyboardEvent('keydown', { key:'Home', bubbles:true }));
    for (let i = 0; i < 2; i++) map.dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowRight', bubbles:true }));
  })()`);
  await ctx.waitFor(() => page.eval(`Number(document.getElementById('t1').textContent.split(':')[1]) >= 10`),
    { what:'local playback clock after the seek' });
  const state = () => page.eval(`(() => {
    const [minutes, seconds] = document.getElementById('t1').textContent.split(':').map(Number);
    return { title:document.getElementById('trackTitle').textContent,
      source:document.getElementById('audioSource').textContent,
      duration:document.getElementById('t2').textContent, time:minutes * 60 + seconds,
      paused:document.getElementById('bPause').classList.contains('paused'),
      segments:document.querySelectorAll('#map .seg').length };
  })()`);
  const before = await state();
  const portrait = await inspectLayout(page);
  assertLiveLayout(portrait);
  for (const id of ['bScore', 'bLoad', 'bVoice', 'vol'])
    assert.ok(portrait.controls.some(item => item.id === id), `${id} missing for an imported track`);
  assert.equal(before.title, filename); assert.equal(before.source, 'LOCAL AUDIO');
  assert.equal(before.duration, '1:30'); assert.equal(before.paused, false); assert.equal(before.segments, 1);
  const resizeStart = Date.now();
  await setViewport(page, { width:568, height:320, touch:true }, { reducedMotion:true });
  await frameSettled(page, 2);
  const landscape = await inspectLayout(page), after = await state();
  assertLiveLayout(landscape);
  for (const id of ['bScore', 'bLoad', 'bVoice', 'vol'])
    assert.ok(landscape.controls.some(item => item.id === id), `${id} unavailable after rotation`);
  for (const key of ['title', 'source', 'duration', 'paused', 'segments']) assert.equal(after[key], before[key], `${key} changed on rotation`);
  assert.ok(after.time >= before.time && after.time - before.time <= (Date.now() - resizeStart) / 1000 + 2,
    'rotation reset or jumped the playback clock');
  await ctx.waitFor(async () => (await state()).time > after.time,
    { timeout:10000, what:'the same local track to keep playing after rotation' });
  assert.deepEqual(ctx.errors.slice(errorStart), [], 'local-track rotation produced browser errors');
});
