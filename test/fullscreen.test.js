/* Fullscreen state belongs to the browser: button clicks are only requests.
   Exercise the real API so external exits and rejected requests stay honest. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../scripts/build.mjs';
import { findChrome, launch, serve, goto, parseHeaders } from './helpers/browser.mjs';
import { setViewport, frameSettled } from './helpers/responsive.mjs';

const chrome = await findChrome();
const options = { skip:chrome ? false : 'no Chrome found' };
let ctx, site, page, out;

before(async () => {
  if (!chrome) return;
  out = await mkdtemp(join(tmpdir(), 'kerr-fullscreen-'));
  await build({ outDir:out });
  site = await serve(out, parseHeaders(await readFile(new URL('../public/_headers', import.meta.url), 'utf8')));
  ctx = await launch(chrome);
  page = ctx.page;
  await goto(page, site.origin + '/');
  assert.deepEqual(ctx.errors, [], 'the built page must boot before testing fullscreen');
  await page.eval(`document.getElementById('go').click()`);
  await ctx.waitFor(() => page.eval(`getComputedStyle(document.getElementById('hud')).opacity === '1'`));
});

after(async () => {
  await ctx?.cleanup();
  await site?.close();
  if (out) await rm(out, { recursive:true, force:true });
});

async function clickFullscreen(){
  const { x, y } = await page.eval(`(() => {
    const r = document.getElementById('bFull').getBoundingClientRect();
    return {x:r.x + r.width / 2, y:r.y + r.height / 2};
  })()`);
  await page.send('Input.dispatchMouseEvent', { type:'mousePressed', x, y, button:'left', clickCount:1 });
  await page.send('Input.dispatchMouseEvent', { type:'mouseReleased', x, y, button:'left', clickCount:1 });
}

async function expectFullscreen(active){
  await ctx.waitFor(() => page.eval(`!!document.fullscreenElement === ${active} &&
    document.getElementById('bFull').getAttribute('aria-label') === '${active ? 'Exit' : 'Enter'} fullscreen'`),
    { what:active ? 'fullscreen entry and exit action' : 'fullscreen exit and enter action' });
  const state = await page.eval(`(() => {
    const button = document.getElementById('bFull');
    return { label:button.querySelector('.fullscreen-label').textContent, title:button.title,
      expand:getComputedStyle(button.querySelector('.i-expand')).display !== 'none',
      contract:getComputedStyle(button.querySelector('.i-contract')).display !== 'none' };
  })()`);
  assert.deepEqual(state, {
    label:active ? 'Exit fullscreen' : 'Fullscreen',
    title:(active ? 'Exit' : 'Enter') + ' fullscreen (F)',
    expand:!active, contract:active,
  });
}

test('fullscreen button changes its label, title, accessible name and icon on real entry and exit', options, async () => {
  assert.equal(await page.eval('document.fullscreenEnabled'), true);
  await expectFullscreen(false);
  await clickFullscreen();
  await expectFullscreen(true);
  await clickFullscreen();
  await expectFullscreen(false);
});

test('an exit outside the fullscreen button restores the enter action', options, async () => {
  await clickFullscreen();
  await expectFullscreen(true);
  // The same fullscreenchange event is emitted when Escape/browser chrome
  // exits; a DOM exit exercises it without headless OS-window dependencies.
  await page.eval('document.exitFullscreen()');
  await expectFullscreen(false);
});

test('the F shortcut enters and exits with matching button state', options, async () => {
  for (const active of [true, false]){
    await page.send('Input.dispatchKeyEvent', { type:'keyDown', key:'f', code:'KeyF', windowsVirtualKeyCode:70 });
    await page.send('Input.dispatchKeyEvent', { type:'keyUp', key:'f', code:'KeyF', windowsVirtualKeyCode:70 });
    await expectFullscreen(active);
  }
});

test('compact fullscreen and exit icons keep an accessible 44px touch target', options, async () => {
  await setViewport(page, { width:390, height:844, touch:true });
  await frameSettled(page, 2);
  try {
    for (const active of [true, false]){
      await clickFullscreen();
      await expectFullscreen(active);
      const target = await page.eval(`(() => {
        const button = document.getElementById('bFull'), rect = button.getBoundingClientRect();
        const icon = button.querySelector('.fullscreen-icon').getBoundingClientRect();
        return { width:rect.width, height:rect.height,
          textHidden:getComputedStyle(button.querySelector('.fullscreen-label')).display === 'none',
          iconFits:icon.x >= rect.x && icon.right <= rect.right && icon.y >= rect.y && icon.bottom <= rect.bottom };
      })()`);
      assert.ok(target.width >= 44 && target.height >= 44, 'fullscreen touch target is at least 44 × 44');
      assert.equal(target.textHidden, true, 'compact layout only shows the icon');
      assert.equal(target.iconFits, true, 'the active icon stays within its target');
    }
  } finally {
    if (await page.eval('!!document.fullscreenElement')) await page.eval('document.exitFullscreen()');
    await setViewport(page, { width:1280, height:720 });
  }
});

test('unsupported and rejected requests keep the windowed action and allow retry', options, async () => {
  await page.eval(`window.originalFullscreen = document.documentElement.requestFullscreen;
    document.documentElement.requestFullscreen = undefined;`);
  try {
    await clickFullscreen();
    await expectFullscreen(false);
    assert.equal(await page.eval(`document.getElementById('toast').textContent`), 'Fullscreen is not available in this browser');
    await page.eval(`document.documentElement.requestFullscreen = () => Promise.reject(new Error('policy denied'));`);
    await clickFullscreen();
    await expectFullscreen(false);
    assert.equal(await page.eval(`document.getElementById('toast').textContent`), 'Fullscreen is not available in this view');
  } finally {
    await page.eval(`document.documentElement.requestFullscreen = window.originalFullscreen; delete window.originalFullscreen;`);
  }
  await clickFullscreen();
  await expectFullscreen(true);
  await clickFullscreen();
  await expectFullscreen(false);
  assert.deepEqual(ctx.errors, []);
});
