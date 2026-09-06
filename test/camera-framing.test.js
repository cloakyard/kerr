/* Framing is checked against the final camera ray cone, not the introductory
   preset. The viewport that exposed the regression is narrower than it is
   tall but still uses the desktop control layout. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sectionOfBar, SECTIONS, DURATION } from '../src/audio/arrangement.js';

globalThis.matchMedia = () => ({ matches:false });
globalThis.innerWidth = 689;
globalThis.innerHeight = 943;
await import('../vendor/three.bundle.js');
const { cur, view, currentPreset, updateCamera, resetCamera } =
  await import('../src/direct/camera.js');
const initialView = { ...view }, initialLook = { ...cur };
const audio = { mode:'synth', bass:1, mid:1, level:1, high:1, sectionOfBar };
const halfWidth = cam => cam.dist * cam.tanFov * innerWidth / innerHeight;

beforeEach(() => {
  Object.assign(cur, initialLook); Object.assign(view, initialView);
  globalThis.innerWidth = 689; globalThis.innerHeight = 943;
});

test('Film view keeps its whole silhouette through every score section at 689×943', () => {
  resetCamera('cinematic');
  const visited = new Set();
  // Run the complete score and every eased transition with ordinary motion,
  // maximum analysed bass and recurrent double-sensitivity impact pulls.
  for (let frame = 0; frame < DURATION * 60; frame++) {
    const time = frame / 60;
    const { p, sec } = currentPreset(time, audio);
    visited.add(sec.n);
    if (frame % 30 === 0) view.pull = 0.68;
    const cam = updateCamera(1 / 60, p, audio, time, { shot:'cinematic', response:2 });
    assert.ok(halfWidth(cam) >= 10.99,
      `${sec.n} at ${time.toFixed(2)}s cropped to ${halfWidth(cam).toFixed(3)} r_s`);
  }
  assert.deepEqual([...visited], SECTIONS.map(section => section.n), 'every score section must be exercised');
});

test('Film fitting preserves explicit manual approach and pullback', () => {
  const { p } = currentPreset(36, audio);
  const distanceAtZoom = zoom => {
    resetCamera('cinematic');
    Object.assign(cur, p);
    view.zoom = zoom; view.pull = 0.68;
    return updateCamera(1 / 60, p, audio, 36, { shot:'cinematic' }).dist;
  };
  const normal = distanceAtZoom(1);
  assert.ok(Math.abs(distanceAtZoom(0.5) / normal - 0.5) < 1e-12, 'manual approach was constrained by automatic fitting');
  assert.ok(Math.abs(distanceAtZoom(1.5) / normal - 1.5) < 1e-12, 'manual pullback lost its chosen scale');
});

test('Close passage retains its intentional tight framing on narrow screens', () => {
  resetCamera('close');
  const { p } = currentPreset(36, audio);
  const cam = updateCamera(1 / 60, p, audio, 36, { shot:'close' });
  assert.ok(halfWidth(cam) < 9, 'Film fitting leaked into the close-passage camera');
  assert.equal(cur.d, 27);
});

// Project conservative apparent disk/halo landmarks through the actual camera
// basis. This catches a lower arc hidden by the player even when the physical
// observer remains outside the disk and the horizontal tips still fit.
function landmarkBounds(cam, shot){
  let top = Infinity, bottom = -Infinity;
  const project = (x, y, z) => {
    const dx = x - cam.pos.x, dy = y - cam.pos.y, dz = z - cam.pos.z;
    const depth = dx * cam.fwd.x + dy * cam.fwd.y + dz * cam.fwd.z;
    const py = (1 - (dx * cam.up.x + dy * cam.up.y + dz * cam.up.z) / (depth * cam.tanFov)) * innerHeight * 0.5;
    top = Math.min(top, py); bottom = Math.max(bottom, py);
  };
  if (shot === 'cinematic'){
    for (const sign of [-1, 1]) project(cam.up.x * 5.7 * sign, cam.up.y * 5.7 * sign, cam.up.z * 5.7 * sign);
  } else {
    for (let i = 0; i < 72; i++){
      const angle = i / 72 * Math.PI * 2;
      project(Math.cos(angle) * 10.6, 0, Math.sin(angle) * 10.6);
    }
  }
  return { top, bottom };
}

test('Film and inspection views stay above the player at tablet and medium desktop sizes', () => {
  for (const [width, height, playerTop] of [[1024, 768, 550], [1280, 720, 530]]){
    globalThis.innerWidth = width; globalThis.innerHeight = height;
    for (const shot of ['cinematic', 'orbit', 'top', 'under']){
      resetCamera(shot);
      for (const time of [0, 36, 80, 136, 200, 230]){
        const { p } = currentPreset(time, audio);
        for (let frame = 0; frame < 180; frame++){
          if (frame % 30 === 0) view.pull = 0.68;
          const cam = updateCamera(1 / 60, p, audio, time + frame / 60, { shot });
          if (frame % 30) continue;
          const bounds = landmarkBounds(cam, shot);
          assert.ok(bounds.top >= 72, `${width}×${height} ${shot} overlaps the toolbar at ${bounds.top.toFixed(1)}px`);
          assert.ok(bounds.bottom < playerTop, `${width}×${height} ${shot} hides behind the player at ${bounds.bottom.toFixed(1)}px`);
        }
      }
    }
  }
});

test('cinema removes the player fit and recenters, while stage zoom remains proportional', () => {
  const { p } = currentPreset(0, audio);
  for (const [width, height] of [[1024, 768], [1280, 720]]){
    globalThis.innerWidth = width; globalThis.innerHeight = height;
    for (const shot of ['cinematic', 'orbit', 'top', 'under']){
      const distance = (cinema, zoom = 1) => {
        resetCamera(shot); view.zoom = zoom;
        let cam;
        for (let i = 0; i < 600; i++) cam = updateCamera(1 / 60, p, audio, 0, { shot, cinema });
        if (cinema) assert.ok(cam.target.length() < 1e-10, `${shot} failed to recenter in cinema`);
        return cam.dist;
      };
      const hud = distance(false);
      assert.ok(distance(true) < hud * .97, `${shot} retained its reserved player space in cinema`);
      assert.ok(Math.abs(distance(false, .5) / hud - .5) < 1e-12, `${shot} constrained manual approach`);
      assert.ok(Math.abs(distance(false, 1.5) / hud - 1.5) < 1e-12, `${shot} constrained manual pullback`);
    }
  }
});
