/* All-angle inspection uses the production camera and vendored vector math.
   Exact cardinal views, pole continuity and persistent manual framing are
   geometric requirements; screenshot resemblance cannot establish them. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sectionOfBar } from '../src/audio/arrangement.js';

globalThis.matchMedia = () => ({ matches:false });
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
await import('../vendor/three.bundle.js');
const { cur, view, currentPreset, updateCamera, orbitCamera, resetCamera } =
  await import('../src/direct/camera.js');
const initialView = { ...view }, initialLook = { ...cur };
const audio = { mode:'synth', level:1, bass:1, mid:1, high:1, sectionOfBar };
const peak = currentPreset(200, audio).p;

beforeEach(() => {
  Object.assign(cur, initialLook); Object.assign(view, initialView);
  globalThis.innerWidth = 1280; globalThis.innerHeight = 720;
});

const near = (a, b, message, tolerance = 1e-12) =>
  assert.ok(Math.abs(a - b) < tolerance, `${message}: ${a} vs ${b}`);
const xyz = vector => vector.toArray().map(value => value + 0); // signed zero is not movement
const snap = cam => ({ pos:xyz(cam.pos), fwd:xyz(cam.fwd),
  right:xyz(cam.right), up:xyz(cam.up), target:xyz(cam.target),
  fov:cam.fov, elevation:cam.elevation, azimuth:cam.azimuth, dist:cam.dist });
function validBasis(cam){
  for (const v of [cam.fwd, cam.right, cam.up]) {
    assert.ok(v.toArray().every(Number.isFinite));
    near(v.length(), 1, 'basis length');
  }
  near(cam.fwd.dot(cam.right), 0, 'forward/right angle');
  near(cam.fwd.dot(cam.up), 0, 'forward/up angle');
  near(cam.right.dot(cam.up), 0, 'right/up angle');
  near(cam.right.clone().cross(cam.up).dot(cam.fwd), -1, 'camera handedness');
}

test('cardinal shots reach the exact disk plane and both poles on their first frame', () => {
  for (const [shot, elevation] of [['edge', 0], ['top', Math.PI / 2], ['under', -Math.PI / 2]]) {
    resetCamera(shot);
    const cam = updateCamera(1 / 60, peak, audio, 123, { shot });
    near(cam.elevation, elevation, `${shot} elevation`);
    near(cam.target.length(), 0, `${shot} target must be the disk center`);
    if (shot === 'edge') {
      near(cam.pos.y, 0, 'edge-on observer stays exactly in the plane');
      near(cam.fwd.y, 0, 'edge-on center ray stays exactly in the plane');
    } else {
      near(Math.hypot(cam.pos.x, cam.pos.z), 0, `${shot} observer is on the axis`);
      near(cam.pos.y / cam.dist, Math.sign(elevation), `${shot} hemisphere`);
    }
    validBasis(cam);
  }
});

test('a cardinal cut clears the horizontal composition inherited from the introduction', () => {
  view.screenX = 0.35;
  resetCamera('top');
  const cam = updateCamera(1 / 60, peak, audio, 1, { shot:'top' });
  near(cam.target.length(), 0, 'a fresh inspection cut must center the disk');
  validBasis(cam);
});

test('manual orbit passes continuously through each pole without a camera flip', () => {
  for (const pole of [Math.PI / 2, -Math.PI / 2]) {
    const frames = [];
    for (const offset of [-1e-6, 0, 1e-6]) {
      resetCamera('edge'); orbitCamera(0, pole + offset);
      const cam = updateCamera(1 / 60, peak, audio, 3, { shot:'edge' });
      validBasis(cam); frames.push(snap(cam));
    }
    for (let i = 1; i < frames.length; i++) {
      for (const key of ['fwd', 'right', 'up']) {
        const agreement = frames[i][key].reduce((sum, value, j) => sum + value * frames[i - 1][key][j], 0);
        assert.ok(agreement > 0.999999999, `${key} flipped crossing pole ${pole}`);
      }
    }
  }
});

test('dragged orientation remains held through the opposite hemisphere and loud score changes', () => {
  resetCamera('edge'); orbitCamera(2.3, -Math.PI * 0.75);
  const first = snap(updateCamera(1 / 60, initialLook, audio, 0, { shot:'edge' }));
  assert.ok(first.pos[1] < 0, 'manual orbit did not reach the underside');
  view.shake = 1; view.pull = 0.34; view.roll = 0.2;
  let cam;
  for (let i = 1; i <= 600; i++) cam = updateCamera(1 / 60, peak, audio, i / 60, { shot:'edge' });
  assert.deepEqual(snap(cam), first, 'manual view drifted after releasing the pointer');
  assert.equal(view.manual, true);
  near(cur.kerr, 0.6, 'music must not change the black hole spin');
});

test('complete manual turns return to the same geometry and reset restores the chosen pole', () => {
  resetCamera('top'); orbitCamera(0.4, 0.3);
  const first = snap(updateCamera(1 / 60, peak, audio, 0, { shot:'top' }));
  orbitCamera(Math.PI * 2, Math.PI * 2);
  const complete = snap(updateCamera(1 / 60, peak, audio, 1, { shot:'top' }));
  for (const key of ['pos', 'fwd', 'right', 'up'])
    first[key].forEach((value, i) => near(complete[key][i], value, `${key} after full turn`));
  view.zoom = 2;
  resetCamera();
  const reset = updateCamera(1 / 60, peak, audio, 2, { shot:'top' });
  near(reset.elevation, Math.PI / 2, 'reset restores selected top shot');
  assert.equal(view.manual, false);
  assert.equal(view.zoom, 1);
});

test('the polar basis remains valid when portrait composition offsets the view', () => {
  globalThis.innerWidth = 390; globalThis.innerHeight = 844;
  for (const shot of ['top', 'under']) {
    resetCamera(shot);
    let cam;
    for (let i = 0; i < 300; i++) cam = updateCamera(1 / 60, peak, audio, i / 60, { shot });
    validBasis(cam);
    assert.ok(cam.pos.toArray().every(Number.isFinite));
    assert.ok(cam.target.toArray().every(Number.isFinite));
  }
});
