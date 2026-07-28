/* The Kerr geometry, checked against the closed forms rather than a
   screenshot. These values are shown as live telemetry in the HUD and are
   pushed into the shader every frame, so being wrong here is being wrong
   twice: the picture and the readout agree with each other and disagree with
   general relativity. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPIN_MAX, DISK_IN, DISK_OUT,
  clampSpin, horizonRadius, iscoRadius, diskInner,
} from '../src/render/kerr.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('Schwarzschild is the a = 0 special case', () => {
  // In r_s = 1 units with M = 0.5: horizon at exactly 1, ISCO at 6M = 3.
  near(horizonRadius(0), 1);
  near(iscoRadius(0), 3, 1e-12);
});

test('the horizon shrinks monotonically with spin, toward M', () => {
  let prev = horizonRadius(0);
  for (let a = 0.02; a <= SPIN_MAX; a += 0.02) {
    const r = horizonRadius(a);
    assert.ok(r < prev, `horizon did not shrink at a = ${a.toFixed(2)}`);
    prev = r;
  }
  // r_h -> M = 0.5 as a -> 1
  assert.ok(horizonRadius(1) >= 0.5);
  near(horizonRadius(1), horizonRadius(SPIN_MAX));   // clamped
});

test('the horizon matches hand-computed r_+/M = 1 + sqrt(1 - a^2)', () => {
  // Values worked out independently rather than by re-running the same
  // expression; r_h is reported here in r_s, so r_h/M is twice that.
  const inM = (a) => horizonRadius(a) * 2;
  near(inM(0),    2.0,       1e-12);   // 2M — the Schwarzschild radius
  near(inM(0.5),  1.8660254, 1e-6);
  near(inM(0.6),  1.8,       1e-12);
  near(inM(0.9),  1.4358899, 1e-6);
  near(inM(0.96), 1.28,      1e-9);
});

test('the ISCO migrates inward with spin and stays outside the horizon', () => {
  let prev = iscoRadius(0);
  for (let a = 0.02; a <= SPIN_MAX; a += 0.02) {
    const r = iscoRadius(a);
    assert.ok(r < prev, `ISCO did not move inward at a = ${a.toFixed(2)}`);
    assert.ok(r > horizonRadius(a), `ISCO fell inside the horizon at a = ${a.toFixed(2)}`);
    prev = r;
  }
});

test('the ISCO matches published Kerr values', () => {
  // Bardeen, Press & Teukolsky (1972), prograde, in units of M — converted to
  // r_s by halving, since r_s = 2M.
  const inM = (a) => iscoRadius(a) * 2;
  near(inM(0),   6,      1e-9);
  near(inM(0.1), 5.6693, 1e-3);
  near(inM(0.5), 4.2330, 1e-3);
  near(inM(0.9), 2.3209, 1e-3);
});

test('the ISCO at the piece\'s own spin is the value the comments quote', () => {
  // CAM presets run kerr from 0.45 to 0.88; the docs quote 1.9 r_s at a = 0.6
  assert.ok(Math.abs(iscoRadius(0.6) - 1.9) < 0.05, `got ${iscoRadius(0.6)}`);
});

test('spin is clamped below extremal', () => {
  assert.equal(clampSpin(-3), 0);
  assert.equal(clampSpin(0.5), 0.5);
  assert.equal(clampSpin(1), SPIN_MAX);
  assert.equal(clampSpin(99), SPIN_MAX);
  assert.ok(SPIN_MAX < 1, 'extremal spin would make both expressions degenerate');
});

test('every function survives a clamped or nonsense spin', () => {
  for (const a of [-1, 0, 0.5, 1, 2, 1e9]) {
    for (const f of [horizonRadius, iscoRadius, diskInner]) {
      const v = f(a);
      assert.ok(Number.isFinite(v) && v > 0, `${f.name}(${a}) = ${v}`);
    }
  }
});

test('the disk keeps the film geometry, with the ISCO only as a floor', () => {
  // DNEG put Gargantua's disk at r = 9.26M..18.70M; r_s = 2M gives 4.63..9.35
  assert.equal(DISK_IN, 4.63);
  assert.equal(DISK_OUT, 9.35);
  // Across the whole usable spin range the ISCO never reaches the disk, so the
  // inner edge is the film's number and not the last stable orbit.
  for (let a = 0; a <= SPIN_MAX; a += 0.02) {
    assert.equal(diskInner(a), DISK_IN, `the ISCO took over at a = ${a.toFixed(2)}`);
  }
  assert.ok(DISK_OUT / DISK_IN < 2.1, 'the annulus should be barely two to one');
});

test('the disk always clears the horizon and the photon sphere', () => {
  for (let a = 0; a <= SPIN_MAX; a += 0.02) {
    assert.ok(diskInner(a) > horizonRadius(a) * 3, 'disk too close to the horizon');
    assert.ok(diskInner(a) > 1.5, 'disk inside the Schwarzschild photon sphere');
  }
});
