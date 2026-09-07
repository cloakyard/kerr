/* Exercise the production camera with the user's reduced-motion preference.
   No WebGL mock: the vendored vector math is used, while the three browser
   inputs the camera reads are provided explicitly. node:test isolates this
   file, so its media preference cannot leak into the browser smoke suite. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sectionOfBar } from '../src/audio/arrangement.js';

globalThis.matchMedia = () => ({ matches: true });
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
await import('../vendor/three.bundle.js');
const { REDUCED } = await import('../src/motion.js');
const { cur, view, currentPreset, updateCamera, orbitCamera, resetCamera } = await import('../src/direct/camera.js');
const initialView = { ...view }, initialLook = { ...cur };
const audio = { mode:'synth', level:1, bass:1, mid:1, high:1, sectionOfBar };

beforeEach(() => {
  Object.assign(cur, initialLook);
  Object.assign(view, initialView);
  globalThis.innerWidth = 1280;
  globalThis.innerHeight = 720;
});

// Signed zero is the same position; only actual movement should fail this.
const xyz = vector => vector.toArray().map(value => value + 0);
const snapshot = cam => ({
  pos:xyz(cam.pos), target:xyz(cam.target),
  fwd:xyz(cam.fwd), right:xyz(cam.right), up:xyz(cam.up),
  fov:cam.fov, dist:cam.dist, orbT:cam.orbT, flowT:cam.flowT
});

test('reduced motion suppresses automatic camera motion across loud passages', () => {
  assert.equal(REDUCED, 0);
  const start = snapshot(updateCamera(1 / 60, initialLook, audio, 0));
  const peak = currentPreset(200, audio).p;
  assert.notEqual(peak.d, initialLook.d, 'the test needs a different score framing');
  // Ten seconds of a peak section, with transient state left over, must not
  // introduce automatic orbit, breathing, roll, camera pull, or FOV pumping.
  view.shake = 1; view.pull = 0.34; view.roll = 0.2;
  let end;
  for (let i = 1; i <= 600; i++) end = updateCamera(1 / 60, peak, audio, i / 60);
  assert.deepEqual(snapshot(end), start);
  assert.equal(view.azim, initialView.azim);
});

test('reduced motion preserves explicit shot selection and manual zoom', () => {
  let cam;
  for (let i = 0; i < 600; i++)
    cam = updateCamera(1 / 60, initialLook, audio, i / 60, { shot:'close' });
  assert.ok(cam.dist < initialLook.d * 0.8, 'the close shot never approached');
  const closeDistance = cam.dist;
  view.zoom = 1.5;
  cam = updateCamera(1 / 60, initialLook, audio, 10, { shot:'close' });
  assert.ok(Math.abs(cam.dist / closeDistance - 1.5) < 1e-8, 'manual zoom was suppressed');
  assert.equal(cam.orbT, 0);
  assert.equal(cam.flowT, 0);
});

test('releasing a manual drag does not restore automatic drift with reduced motion', () => {
  for (const shot of ['cinematic', 'close']) {
    resetCamera(shot);
    orbitCamera(0.35, -0.17);
    const first = snapshot(updateCamera(1 / 60, initialLook, audio, 0, { shot }));
    let cam;
    for (let i = 1; i <= 120; i++) cam = updateCamera(1 / 60, initialLook, audio, i / 60, { shot });
    assert.deepEqual(snapshot(cam), first, `${shot} restarted motion after a drag`);
  }
});

test('portrait framing pulls back while preserving a valid camera basis', () => {
  const wideDistance = updateCamera(1 / 60, initialLook, audio, 0).dist;
  globalThis.innerWidth = 390;
  globalThis.innerHeight = 844;
  let cam;
  for (let i = 0; i < 600; i++) cam = updateCamera(1 / 60, initialLook, audio, i / 60);
  assert.ok(cam.dist > wideDistance * 2, 'portrait viewport never gained framing room');
  for (const basis of [cam.fwd, cam.right, cam.up]) {
    assert.ok(basis.toArray().every(Number.isFinite), 'camera basis is not finite');
    assert.ok(Math.abs(basis.length() - 1) < 1e-12, 'camera basis is not normalized');
  }
  assert.ok(Math.abs(cam.fwd.dot(cam.right)) < 1e-12);
  assert.ok(Math.abs(cam.fwd.dot(cam.up)) < 1e-12);
  assert.ok(Math.abs(cam.right.dot(cam.up)) < 1e-12);
});
