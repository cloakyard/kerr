/* Exercise interrupted pointer gestures and repeated native file selection
   against the built page, without accessing application state. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../scripts/build.mjs';
import { findChrome, launch, serve, goto, parseHeaders } from './helpers/browser.mjs';
import { setViewport, frameSettled } from './helpers/responsive.mjs';

const chrome = await findChrome(), options = {skip:chrome ? false : 'no Chrome found'};
let ctx, page, site, out, track;
before(async () => {
  if (!chrome) return;
  out = await mkdtemp(join(tmpdir(), 'kerr-interactions-'));
  await build({outDir:out});
  // Real PCM input exercises the browser's native file-input change semantics.
  const rate = 8000, length = rate * 4, bytes = Buffer.alloc(44 + length * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i++) bytes.writeInt16LE(Math.round(Math.sin(i * Math.PI * 440 / rate) * 1800), 44 + i * 2);
  track = join(out, 'retry.wav'); await writeFile(track, bytes);
  site = await serve(out, parseHeaders(await readFile(new URL('../public/_headers', import.meta.url), 'utf8')));
  ctx = await launch(chrome); page = ctx.page;
  await setViewport(page, {width:640, height:480, touch:true});
  await goto(page, site.origin + '/');
  await page.eval(`document.getElementById('go').click(); document.getElementById('bPause').click()`);
  await ctx.waitFor(() => page.eval(`getComputedStyle(document.getElementById('hud')).opacity === '1'`));
  await frameSettled(page, 2);
});
after(async () => {
  await ctx?.cleanup(); await site?.close();
  if (out) await rm(out, {recursive:true, force:true});
});

const touch = (type, x, y) => page.send('Input.dispatchTouchEvent', {
  type, touchPoints:type === 'touchEnd' ? [] : [{x, y, id:1}]
});

for (const interruption of ['lostpointercapture', 'blur']) {
  test(`timeline stops seeking after ${interruption}`, options, async () => {
    const rect = await page.eval(`(() => {
      const map = document.getElementById('map'), r = map.getBoundingClientRect();
      map.addEventListener('pointerdown', e => { window.scrubPointer = e.pointerId; }, {once:true});
      const events = []; window.scrubEvents = events;
      map.addEventListener('gotpointercapture', () => events.push('got'), {once:true});
      map.addEventListener('lostpointercapture', () => events.push('lost'), {once:true});
      return {x:r.x, y:r.y + r.height/2, w:r.width};
    })()`);
    try {
      await touch('touchStart', rect.x + rect.w * .2, rect.y);
      await touch('touchMove', rect.x + rect.w * .3, rect.y);
      if (interruption === 'lostpointercapture') {
        await ctx.waitFor(() => page.eval(`window.scrubEvents.includes('got')`), {timeout:5000, what:'timeline pointer capture'});
        await page.eval(`document.getElementById('map').releasePointerCapture(window.scrubPointer)`);
        await touch('touchMove', rect.x + rect.w * .31, rect.y);
        await ctx.waitFor(() => page.eval(`window.scrubEvents.includes('lost')`), {timeout:5000, what:'real capture-loss event'});
      } else await page.eval(`dispatchEvent(new Event('blur'))`);
      await frameSettled(page, 2);
      const before = await page.eval(`document.getElementById('map').getAttribute('aria-valuenow')`);
      assert.ok(Number(before) >= 29 && Number(before) <= 32, 'the initial drag must actually seek');
      await touch('touchMove', rect.x + rect.w * .8, rect.y);
      await frameSettled(page, 2);
      const after = await page.eval(`document.getElementById('map').getAttribute('aria-valuenow')`);
      assert.equal(after, before, 'hover after interruption kept scrubbing the track');
    } finally {
      await touch('touchEnd');
      await page.eval(`delete window.scrubPointer; delete window.scrubEvents`);
    }
  });
}

test('the same file can be selected again after returning to the score', options, async () => {
  await page.send('DOM.enable');
  const {root} = await page.send('DOM.getDocument');
  const {nodeId} = await page.send('DOM.querySelector', {nodeId:root.nodeId, selector:'#file'});
  const choose = () => page.send('DOM.setFileInputFiles', {nodeId, files:[track]});
  await choose();
  await ctx.waitFor(() => page.eval(`document.getElementById('audioStatus').textContent === 'AUDIO REACTIVE'`));
  await page.eval(`document.getElementById('bScore').click()`);
  await ctx.waitFor(() => page.eval(`document.getElementById('audioSource').textContent === 'GENERATIVE SCORE'`));
  await choose();
  await ctx.waitFor(() => page.eval(`document.getElementById('audioSource').textContent === 'LOCAL AUDIO'`),
    {timeout:5000, what:'same-file selection to return to local audio'});
  assert.equal(await page.eval(`document.getElementById('trackTitle').textContent`), 'retry.wav');
  assert.deepEqual(ctx.errors, []);
});
