/* Exercise the production UI and Web Audio graph with controlled browser
   device metadata. These are simulated routes, not claims of hardware access. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../scripts/build.mjs';
import { findChrome, launch, serve, goto, parseHeaders } from './helpers/browser.mjs';

const chrome = await findChrome();
const options = { skip:chrome ? false : 'no Chrome found' };
let ctx, site, page, out;

before(async () => {
  if (!chrome) return;
  out = await mkdtemp(join(tmpdir(), 'kerr-voicing-'));
  await build({ outDir:out });
  site = await serve(out, parseHeaders(await readFile(new URL('../public/_headers', import.meta.url), 'utf8')));
  ctx = await launch(chrome);
  page = ctx.page;
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source:`
    window.route = { devices:[], sinkId:'', latency:.2, reads:0, hold:false, pending:[], targets:[], mic:0, routing:0 };
    navigator.mediaDevices.enumerateDevices = () => {
      route.reads++;
      if (route.fail) return Promise.reject(new Error('metadata unavailable'));
      const snapshot = route.devices.slice();
      return route.hold ? new Promise(resolve => route.pending.push(() => resolve(snapshot))) : Promise.resolve(snapshot);
    };
    navigator.mediaDevices.getUserMedia = () => { route.mic++; return Promise.reject(new Error('must not request a microphone')); };
    const NativeContext = window.AudioContext;
    window.AudioContext = new Proxy(NativeContext, { construct(Target, args) {
      const context = new Target(...args);
      route.context = context;
      Object.defineProperty(context, 'sinkId', { get:() => route.sinkId });
      Object.defineProperty(context, 'outputLatency', { get:() => route.latency });
      context.setSinkId = () => { route.routing++; return Promise.resolve(); };
      const create = context.createBiquadFilter.bind(context);
      let first = true;
      context.createBiquadFilter = () => {
        const node = create();
        if (first) {
          first = false;
          const set = node.frequency.setTargetAtTime.bind(node.frequency);
          node.frequency.setTargetAtTime = (value, ...rest) => { route.targets.push(value); return set(value, ...rest); };
        }
        return node;
      };
      return context;
    } });
  ` });
  await goto(page, site.origin + '/');
  await page.eval(`document.getElementById('go').click()`);
  await expectVoice(48, 'Output type unavailable');
});

after(async () => {
  await ctx?.cleanup();
  await site?.close();
  if (out) await rm(out, { recursive:true, force:true });
});

async function expectVoice(hp, caption) {
  await ctx.waitFor(() => page.eval(`route.targets.at(-1) === ${hp} && document.getElementById('pickwhy').textContent.includes(${JSON.stringify(caption)})`),
    { what:`${caption} with a ${hp} Hz filter` });
}
async function setRoute(label, { emit = true } = {}) {
  await page.eval(`route.devices = [{kind:'audiooutput', deviceId:'default', label:${JSON.stringify(label)}}];
    ${emit ? "navigator.mediaDevices.dispatchEvent(new Event('devicechange'));" : ''}`);
}

test('unidentified high-latency output stays an explicit fallback', options, async () => {
  await expectVoice(48, 'Output type unavailable');
  const state = await page.eval(`({caption:document.getElementById('pickwhy').textContent, aria:document.getElementById('bVoice').getAttribute('aria-label'), selected:document.querySelector('.seg2 .on').dataset.voice})`);
  assert.equal(state.selected, 'auto');
  assert.match(state.aria, /Auto:.*Output type unavailable/);
  assert.doesNotMatch(state.caption, /Wireless|headphones/i);
});

test('device changes revoice the real graph for speakers and wired headphones', options, async () => {
  await setRoute('Bluetooth Speakers');
  await expectVoice(33, 'Speakers voicing');
  await page.eval('route.latency = .01');
  await setRoute('Headphones (USB Audio)');
  await expectVoice(25, 'Headphones voicing');
  assert.equal(await page.eval(`localStorage.getItem('kerr.voicing')`), 'auto');
});

test('explicit sink changes follow the active output instead of the default', options, async () => {
  await page.eval(`route.devices = [
    {kind:'audiooutput', deviceId:'default', label:'Built-in Speakers'},
    {kind:'audiooutput', deviceId:'usb', label:'USB Speakers'}
  ]; route.sinkId = 'usb'; route.context.dispatchEvent(new Event('sinkchange'));`);
  await expectVoice(33, 'USB Speakers');
  await page.eval(`route.sinkId = ''; route.context.dispatchEvent(new Event('sinkchange'));`);
  await expectVoice(48, 'Built-in Speakers');
});

test('a route change without a device event is caught by the visible playback check', options, async () => {
  await setRoute('AirPods Pro', { emit:false });
  await expectVoice(25, 'AirPods Pro');
});

test('resuming playback and returning to the page refresh the output', options, async () => {
  await page.eval('route.context.suspend()');
  await setRoute('External Speakers', { emit:false });
  await page.eval('route.context.resume()');
  await expectVoice(33, 'External Speakers');
  await setRoute('Internal Speakers', { emit:false });
  await page.eval(`window.dispatchEvent(new Event('focus'))`);
  await expectVoice(48, 'Internal Speakers');
});

test('late enumeration cannot overwrite a newer route', options, async () => {
  await page.eval('route.hold = true');
  await setRoute('Headphones');
  await ctx.waitFor(() => page.eval('route.pending.length > 0'));
  await page.eval('route.hold = false');
  await setRoute('USB Speakers');
  await expectVoice(33, 'USB Speakers');
  await page.eval('route.pending.splice(0).forEach(resolve => resolve())');
  await expectVoice(33, 'USB Speakers');
});

test('manual selection wins over pending detection and subsequent device events', options, async () => {
  await page.eval('route.hold = true');
  await setRoute('AirPods');
  await ctx.waitFor(() => page.eval('route.pending.length > 0'));
  await page.eval(`document.querySelector('[data-voice="monitors"]').click(); route.hold = false; route.pending.splice(0).forEach(resolve => resolve());`);
  await expectVoice(33, 'Voiced for powered speakers');
  await setRoute('Headphones');
  await expectVoice(33, 'Voiced for powered speakers');
  assert.equal(await page.eval(`localStorage.getItem('kerr.voicing')`), 'monitors');
  await page.eval(`document.querySelector('[data-voice="auto"]').click()`);
  await expectVoice(25, 'Headphones voicing');
});

test('permission failures fall back safely and future refreshes recover', options, async () => {
  await page.eval(`route.fail = true; navigator.mediaDevices.dispatchEvent(new Event('devicechange'))`);
  await expectVoice(48, 'Output type unavailable');
  await page.eval('route.fail = false');
  await setRoute('External Speakers');
  await expectVoice(33, 'External Speakers');
});

test('unchanged detection does not restart audio ramps or interpret label markup', options, async () => {
  await setRoute('<b>External Speakers</b>');
  await expectVoice(33, '<b>External Speakers</b>');
  assert.equal(await page.eval(`document.getElementById('pickwhy').children.length`), 0);
  const count = await page.eval('route.targets.length');
  await page.eval(`window.dispatchEvent(new Event('focus'))`);
  await expectVoice(33, '<b>External Speakers</b>');
  assert.equal(await page.eval('route.targets.length'), count);
  assert.deepEqual(await page.eval('({mic:route.mic, routing:route.routing})'), {mic:0, routing:0});
  assert.deepEqual(ctx.errors, []);
});
