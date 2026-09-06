#!/usr/bin/env node
/* Current-build documentation captures, using the repo's isolated Chrome/CDP
 * harness. No production state, shader uniforms or quality limits are patched.
 *
 * node scripts/capture-screenshots.mjs
 * node scripts/capture-screenshots.mjs --only mobile-portrait,mobile-controls --out /tmp/kerr-captures
 * node scripts/capture-screenshots.mjs --software
 *
 * PNGs use a 1:1 CSS/device pixel ratio. A JSON manifest records browser,
 * renderer, build hash, runtime telemetry and visible-control geometry.
 */
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from './build.mjs';
import { findChrome, launch, serve, goto, parseHeaders } from '../test/helpers/browser.mjs';
import { setViewport, frameSettled, inspectLayout } from '../test/helpers/responsive.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cases = [
  { name:'desktop-cinema', width:1440, height:900, cinema:true },
  { name:'desktop-interface', width:1440, height:900 },
  { name:'tablet-portrait', width:768, height:1024, touch:true },
  { name:'mobile-portrait', width:390, height:844, touch:true },
  { name:'mobile-landscape', width:844, height:390, touch:true },
  { name:'mobile-small', width:360, height:640, touch:true },
  { name:'mobile-controls', width:390, height:844, touch:true, viewPanel:true },
];
const args = process.argv.slice(2);
const options = { out:join(root, 'screenshots'), software:false, only:null };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--software') options.software = true;
  else if (args[i] === '--out' && args[i + 1]) options.out = resolve(args[++i]);
  else if (args[i] === '--only' && args[i + 1]) options.only = args[++i].split(',');
  else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
}
const selected = options.only ? cases.filter(item => options.only.includes(item.name)) : cases;
if (!selected.length || options.only?.some(name => !cases.some(item => item.name === name)))
  throw new Error(`--only must use: ${cases.map(item => item.name).join(', ')}`);
const chrome = await findChrome();
if (!chrome) throw new Error('No Chrome found. Set CHROME_PATH to capture screenshots.');
let out, ctx, site;
const deadline = setTimeout(() => {
  console.error('Capture deadline exceeded (4 minutes).'); process.exit(1);
}, 240000);
const manifest = {
  generatedAt:new Date().toISOString(), rendererRequested:options.software ? 'SwiftShader' : 'available hardware',
  deviceScaleFactor:1, reducedMotion:false,
  caveat:'Viewport and touch emulation on local Chrome; these are not physical-device or sustained-performance measurements.',
  captures:[],
};
try {
  out = await mkdtemp(join(tmpdir(), 'kerr-capture-'));
  const html = await build({ outDir:out });
  manifest.buildSha256 = createHash('sha256').update(html).digest('hex');
  manifest.buildBytes = Buffer.byteLength(html);
  site = await serve(out, parseHeaders(await readFile(join(root, 'public/_headers'), 'utf8')));
  ctx = await launch(chrome, { softwareRendering:options.software });
  manifest.browser = await ctx.page.send('Browser.getVersion');
  await mkdir(options.out, { recursive:true });
  for (const item of selected) {
    const { page } = ctx;
    const errorStart = ctx.errors.length;
    await setViewport(page, item);
    await goto(page, site.origin + '/');
    await page.eval(`(() => {
      const go = document.getElementById('go');
      go.scrollIntoView({ block:'nearest', behavior:'instant' }); go.click();
    })()`);
    await ctx.waitFor(() => page.eval(`document.getElementById('hud').classList.contains('on')`),
      { what:'live scene', timeout:15000 });
    // Exercise the normal seek control to choose a reproducible score section.
    // Material time and adaptive quality remain governed by the actual app.
    await page.eval(`(() => {
      const map = document.getElementById('map');
      map.dispatchEvent(new KeyboardEvent('keydown', { key:'Home', bubbles:true }));
      for (let i = 0; i < 6; i++) map.dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowRight', bubbles:true }));
      document.activeElement?.blur();
    })()`);
    await frameSettled(page, 12);
    // Allow normal adaptive quality to settle and the production HUD reveal
    // to complete. The manifest reports the quality actually reached.
    await new Promise(resolve => setTimeout(resolve, 4500));
    if (item.cinema) await page.eval(`document.getElementById('bCinema').click()`);
    if (item.viewPanel) await page.eval(`document.getElementById('bView').click()`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await page.eval(`(() => {
      document.activeElement?.blur();
      window.dispatchEvent(new PointerEvent('pointermove', { clientX:innerWidth/2, clientY:innerHeight/2 }));
    })()`);
    await frameSettled(page, 2);
    const telemetry = await page.eval(`(() => {
      const canvas = document.getElementById('gl'), gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return { clock:document.getElementById('t1').textContent,
        section:document.getElementById('sect').textContent,
        quality:document.getElementById('tQ').textContent,
        shot:document.getElementById('shot').value, palette:document.getElementById('palette').value,
        response:document.getElementById('response').value,
        canvas:{ width:canvas.width, height:canvas.height }, glError:gl.getError(),
        renderer:debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
    })()`);
    const layout = await inspectLayout(page);
    if (layout.viewport.width !== item.width || layout.viewport.height !== item.height || layout.touch !== !!item.touch)
      throw new Error(`${item.name} viewport/touch emulation mismatch: ${JSON.stringify(layout.viewport)}, coarse=${layout.touch}`);
    if (item.viewPanel && !layout.controls.some(control => control.id === 'shot'))
      throw new Error(`${item.name} did not retain the open View panel`);
    if (item.cinema && !layout.bodyClass.includes('cinema'))
      throw new Error(`${item.name} did not enter cinema mode`);
    const errors = ctx.errors.slice(errorStart);
    if (errors.length || telemetry.glError) throw new Error(`${item.name} browser errors: ${JSON.stringify({ errors, telemetry })}`);
    const { data } = await page.send('Page.captureScreenshot', { format:'png', fromSurface:true, captureBeyondViewport:false });
    const file = `kerr-${item.name}.png`, bytes = Buffer.from(data, 'base64');
    const dimensions = { width:bytes.readUInt32BE(16), height:bytes.readUInt32BE(20) };
    if (dimensions.width !== item.width || dimensions.height !== item.height)
      throw new Error(`${file} dimensions mismatch: ${JSON.stringify(dimensions)}`);
    await writeFile(join(options.out, file), bytes);
    manifest.captures.push({ file, requested:item, capturedAt:new Date().toISOString(), dimensions,
      bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex'), telemetry, layout, errors });
    await writeFile(join(options.out, 'capture-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`${file}: ${dimensions.width}×${dimensions.height}, ${telemetry.quality}, ${telemetry.clock}`);
  }
} finally {
  clearTimeout(deadline);
  await ctx?.cleanup();
  await site?.close();
  if (out) await rm(out, { recursive:true, force:true });
}
