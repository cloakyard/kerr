/* Zero sensitivity still permits ambient camera drift, but score sections
   must no longer redirect the shot. This runs with ordinary motion enabled
   so the reduced-motion preference cannot accidentally make the test pass. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sectionOfBar } from '../src/audio/arrangement.js';

globalThis.matchMedia = () => ({ matches:false });
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
await import('../vendor/three.bundle.js');
const { REDUCED } = await import('../src/motion.js');
const { cur, view, currentPreset, updateCamera } = await import('../src/direct/camera.js');
const initialView = { ...view }, initialLook = { ...cur };
const reset = () => { Object.assign(cur, initialLook); Object.assign(view, initialView); };
beforeEach(reset);

// The audio-feature tests separately verify that zero sensitivity produces
// zero amplitudes. These are the camera's real inputs for that setting.
const audio = { mode:'synth', level:0, bass:0, mid:0, high:0, sectionOfBar };

test('zero music response prevents score sections from changing the camera', () => {
  assert.equal(REDUCED, 1, 'ordinary motion must be enabled for this regression');
  const peak = currentPreset(200, audio).p;
  assert.notEqual(peak.d, initialLook.d);
  const run = preset => {
    let cam;
    for (let i = 0; i < 600; i++)
      cam = updateCamera(1 / 60, preset, audio, i / 60, { response:0 });
    return { look:{ ...cur }, position:cam.pos.toArray(), target:cam.target.toArray(),
      fov:cam.fov, orbT:cam.orbT, flowT:cam.flowT };
  };
  const ambient = run(initialLook);
  reset();
  assert.deepEqual(run(peak), ambient);
  assert.ok(view.azim > initialView.azim, 'zero response should retain ambient drift');
});

test('zero music response still respects an explicitly selected camera', () => {
  let cam;
  for (let i = 0; i < 600; i++) cam = updateCamera(1 / 60, initialLook, audio, i / 60,
    { response:0, shot:'close' });
  assert.ok(cur.d < initialLook.d * 0.8, 'manual close shot was disabled');
  assert.ok(Number.isFinite(cam.dist) && cam.dist >= 12);
});
