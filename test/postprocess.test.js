/* Deterministic GPU checks for the real compositor shaders. Synthetic scene
   targets separate display processing from moving plasma and adaptive quality.
   The committed Three bundle supplies the same injected colour functions as
   production; nothing below substitutes a CPU implementation of a shader. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandIncludes } from '../scripts/glsl.mjs';
import { findChrome, launch, serve, goto } from './helpers/browser.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const chrome = await findChrome();
const options = { skip:chrome ? false : 'no Chrome found' };
let ctx, site, page, out, supportsHDR;

before(async () => {
  if (!chrome) return;
  out = await mkdtemp(join(tmpdir(), 'kerr-postprocess-'));
  const names = ['quad.vert', 'final.frag', 'bright.frag', 'resolve.frag'];
  const sources = Object.fromEntries(await Promise.all(names.map(async name =>
    [name, await expandIncludes(join(root, 'src/render/shaders', name))])));
  await writeFile(join(out, 'three.js'), await readFile(join(root, 'vendor/three.bundle.js')));
  await writeFile(join(out, 'index.html'), '<!doctype html><title>Compositor GPU regression</title><link rel="icon" href="data:,"><script src="three.js"></script>');
  site = await serve(out);
  ctx = await launch(chrome);
  page = ctx.page;
  await goto(page, site.origin + '/');
  supportsHDR = await page.eval(`(() => {
    const shaders = ${JSON.stringify(sources)};
    const T = window.THREE;
    T.ColorManagement.enabled = false;
    const renderer = new T.WebGLRenderer({antialias:false, alpha:false});
    renderer.outputColorSpace = T.LinearSRGBColorSpace;
    renderer.setSize(32, 32, false);
    const gl = renderer.getContext();
    const hdr = !!(renderer.extensions.get('EXT_color_buffer_half_float') || renderer.extensions.get('EXT_color_buffer_float'));
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(new Float32Array([-1,-1,0, 3,-1,0, -1,3,0]), 3));
    geometry.setAttribute('uv', new T.BufferAttribute(new Float32Array([0,0, 2,0, 0,2]), 2));
    const mesh = new T.Mesh(geometry);
    mesh.frustumCulled = false;
    const scene = new T.Scene(); scene.add(mesh);
    const camera = new T.OrthographicCamera(-1,1,1,-1,0,1);
    const target = (size, type) => new T.WebGLRenderTarget(size, size, {
      type:type === 'hdr' ? T.HalfFloatType : T.UnsignedByteType,
      minFilter:T.LinearFilter, magFilter:T.LinearFilter, depthBuffer:false, stencilBuffer:false
    });
    const draw = (fragmentShader, uniforms, destination) => {
      const material = new T.ShaderMaterial({ vertexShader:shaders['quad.vert'], fragmentShader,
        uniforms, depthTest:false, depthWrite:false });
      mesh.material = material;
      renderer.setRenderTarget(destination);
      renderer.render(scene, camera);
      material.dispose();
    };
    const source = (body, size, type, color = [0,0,0]) => {
      const texture = target(size, type);
      draw('precision highp float; uniform vec3 color; void main(){' + body + '}',
        {color:{value:new T.Vector3(...color)}}, texture);
      return texture;
    };
    const solid = (color, type) => source('gl_FragColor=vec4(color,1.0);', 32, type, color);
    const read = destination => {
      const pixels = new Uint8Array(destination.width * destination.height * 4);
      renderer.readRenderTargetPixels(destination, 0, 0, destination.width, destination.height, pixels);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL error during compositor readback');
      return Array.from(pixels);
    };
    window.probe = {
      final(color, type){
        const input = solid(color, type), black = solid([0,0,0], type), output = target(32, 'byte');
        draw(shaders['final.frag'], {
          uScene:{value:input.texture}, uBloom:{value:black.texture}, uBloomWide:{value:black.texture}, uFlare:{value:black.texture},
          uBhUv:{value:new T.Vector2(0.5,0.5)}, uAspect:{value:1}, uCA:{value:0}, uExposure:{value:1},
          uFlash:{value:0}, uBloomAmt:{value:0}, uFlareAmt:{value:0}, uStreak:{value:0}
        }, output);
        const pixels = read(output);
        [input,black,output].forEach(t => t.dispose());
        return pixels;
      },
      bloom(color, type, pattern){
        const input = pattern ? source(pattern, 32, type, color) : solid(color, type);
        const output = target(16, 'byte');
        draw(shaders['bright.frag'], {
          tDiffuse:{value:input.texture}, uThresh:{value:0.55}, uTexel:{value:new T.Vector2(1/32,1/32)}
        }, output);
        const pixels = read(output);
        [input,output].forEach(t => t.dispose());
        return pixels;
      },
      resolve(pattern, type, grain = 0){
        const input = source(pattern, 32, type), output = target(32, 'byte');
        draw(shaders['resolve.frag'], {
          tDiffuse:{value:input.texture}, uTexel:{value:new T.Vector2(1/32,1/32)},
          uRes:{value:new T.Vector2(32,32)}, uTime:{value:3.5}, uGrain:{value:grain}
        }, output);
        const pixels = read(output);
        [input,output].forEach(t => t.dispose());
        return pixels;
      },
      dispose(){ geometry.dispose(); renderer.dispose(); }
    };
    return hdr;
  })()`);
});

after(async () => {
  if (page) await page.eval('window.probe?.dispose()').catch(() => {});
  await ctx?.cleanup();
  await site?.close();
  if (out) await rm(out, { recursive:true, force:true });
});

const pixel = (pixels, x = 16, y = 16, width = 32) => pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 3);
const rgb = pixels => pixels.filter((_, index) => index % 4 !== 3);
const run = (method, ...args) => page.eval(`window.probe.${method}(...${JSON.stringify(args)})`);

test('HDR final pass preserves the sRGB shadow toe and highlight headroom', options, async t => {
  if (!supportsHDR) return t.skip('half-float render targets unavailable');
  const values = [];
  for (const luminance of [0, 0.001, 0.004, 0.01, 0.18, 1, 4]) {
    const channels = pixel(await run('final', [luminance,luminance,luminance], 'hdr'));
    assert.equal(channels[0], channels[1], 'a neutral scene acquired a green cast');
    assert.equal(channels[1], channels[2], 'a neutral scene acquired a blue cast');
    values.push(channels[0]);
  }
  assert.equal(values[0], 0, 'black must remain black');
  // These dark patches distinguish the linear sRGB toe from the old gamma
  // approximation, which lifted them to about 6 and 12 display-code values.
  assert.ok(values[1] >= 0 && values[1] <= 2, 'the 0.001 scene patch is lifted above the sRGB toe');
  assert.ok(values[2] >= 3 && values[2] <= 5, 'the 0.004 scene patch lost its dark-lane contrast');
  assert.ok(values.every((value, i) => i === 0 || value > values[i - 1]), 'tone mapping must stay monotonic');
  assert.ok(values[6] > values[5] + 12, 'HDR input clipped before tone mapping');
});

test('bloom rolls on below threshold, stays monotonic and preserves warm hue', options, async t => {
  if (!supportsHDR) return t.skip('half-float render targets unavailable');
  const values = [];
  for (const gain of [0, 0.3, 0.5, 0.8, 1.0, 1.2, 1.4]) {
    const channels = pixel(await run('bloom', [gain,gain * 0.48,gain * 0.4], 'hdr'), 8, 8, 16);
    values.push(channels[0]);
    if (channels[0] > 20) {
      assert.ok(Math.abs(channels[1] / channels[0] - 0.48) < 0.03, 'bloom changed the green/red ratio');
      assert.ok(Math.abs(channels[2] / channels[0] - 0.4) < 0.03, 'bloom changed the blue/red ratio');
    }
  }
  assert.equal(values[0], 0);
  assert.ok(values[3] > 0, 'soft-knee bloom should begin before luminance reaches 0.55');
  assert.ok(values.every((value, i) => i === 0 || value >= values[i - 1]), 'bloom brightness reversed across its threshold');
  assert.ok(values.at(-1) > values[3] + 40, 'bright material has no useful bloom range');
});

test('bloom prefilter gives both source phases of a thin filament equal energy', options, async () => {
  const sums = [];
  for (const column of [14,15]) {
    const pattern = `gl_FragColor=vec4(vec3(abs(floor(gl_FragCoord.x)-${column}.0)<0.5 ? 1.0 : 0.0),1.0);`;
    const pixels = await run('bloom', [1,1,1], 'byte', pattern);
    sums.push(rgb(pixels).reduce((sum, channel) => sum + channel, 0));
  }
  assert.ok(sums[0] > 0, 'the thin filament vanished during bloom extraction');
  assert.ok(Math.abs(sums[0] - sums[1]) <= 3, 'moving one source texel changes the filament glow');
});

test('edge resolve smooths staircase diagonals without lifting remote black pixels', options, async () => {
  const pattern = 'float edge=step(gl_FragCoord.y*0.5+7.0,gl_FragCoord.x);gl_FragColor=vec4(vec3(edge),1.0);';
  const pixels = await run('resolve', pattern, 'byte');
  let intermediate = 0;
  for (let y = 3; y < 29; y++) {
    for (let x = 3; x < 29; x++) {
      const value = pixel(pixels, x, y)[0];
      if (value > 2 && value < 253) intermediate++;
      if (x < y * 0.5 + 3) assert.equal(value, 0, 'edge filtering lifted the distant black field');
    }
  }
  assert.ok(intermediate >= 20, 'the diagonal retained an unfiltered binary staircase');
  assert.deepEqual(pixel(pixels, 28, 16), [255,255,255], 'flat highlights were dimmed');
});

test('edge resolve retains isolated stars and keeps empty sky black even with grain', options, async () => {
  const point = 'vec2 p=floor(gl_FragCoord.xy);float star=(p.x==16.0 && p.y==16.0)?1.0:0.0;gl_FragColor=vec4(vec3(star),1.0);';
  for (const type of supportsHDR ? ['hdr','byte'] : ['byte']) {
    const pixels = await run('resolve', point, type);
    assert.deepEqual(pixel(pixels), [255,255,255], `${type} isolated star lost its magnitude`);
    assert.deepEqual(pixel(pixels, 2, 2), [0,0,0]);
    const black = await run('resolve', 'gl_FragColor=vec4(0.0,0.0,0.0,1.0);', type, 0.003);
    assert.ok(rgb(black).every(value => value === 0), `${type} grain lifted empty sky`);
  }
});

test('unsigned-byte fallback keeps black, neutral midtones and stable final highlights', options, async () => {
  const black = await run('final', [0,0,0], 'byte');
  assert.ok(rgb(black).every(value => value === 0), 'fallback output is not black for zero input');
  const mid = pixel(await run('final', [0.18,0.18,0.18], 'byte'));
  const white = pixel(await run('final', [1,1,1], 'byte'));
  assert.ok(mid[0] > 130 && mid[0] < 155, 'fallback midtone transfer is incorrect');
  assert.deepEqual(mid, [mid[0],mid[0],mid[0]], 'fallback neutral gained a color cast');
  assert.ok(white[0] > mid[0] + 70 && white[0] < 255, 'fallback highlights lost their tone-mapped shoulder');
  assert.deepEqual(ctx.errors, [], 'production postprocessing shaders must compile without browser errors');
});
