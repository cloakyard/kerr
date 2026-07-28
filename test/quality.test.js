/* The adaptive quality controller.
   It is the one piece of the renderer that changes behaviour based on the
   machine it is running on, which makes it the one piece nobody ever sees
   misbehave on their own hardware. The properties that matter are: it does not
   run away, it does not oscillate, and it never leaves the band where the
   image still reads. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Q, tuneQuality } from '../src/render/quality.js';

const DEFAULTS = { scale: 0.85, steps: 180, dpr: 1 };
beforeEach(() => Object.assign(Q, DEFAULTS));

test('starts where the renderer expects', () => {
  assert.equal(Q.scale, 0.85);
  assert.equal(Q.steps, 180);
});

test('a slow frame drops both scale and steps, and says so', () => {
  assert.equal(tuneQuality(30), true);
  assert.ok(Q.scale < 0.85);
  assert.ok(Q.steps < 180);
});

test('a fast frame raises both, and says so', () => {
  assert.equal(tuneQuality(60), true);
  assert.ok(Q.scale > 0.85);
  assert.ok(Q.steps > 180);
});

test('the dead band between 42 and 57 changes nothing', () => {
  // Wide on purpose: a narrow band makes the scale oscillate against the music
  for (const fps of [42, 45, 50, 55, 57]) {
    Object.assign(Q, DEFAULTS);
    assert.equal(tuneQuality(fps), false, `fps ${fps} should be inside the dead band`);
    assert.deepEqual({ ...Q }, DEFAULTS);
  }
});

test('sustained slowness reaches the documented floor on BOTH axes', () => {
  let reallocs = 0;
  for (let i = 0; i < 200; i++) if (tuneQuality(10)) reallocs++;
  assert.equal(Q.scale, 0.5);
  assert.equal(Q.steps, 96, 'steps used to strand at 100 — the gate shut on scale alone');
  assert.ok(reallocs < 20, `floor reached in ${reallocs} steps, then should stop`);
  // at the floor it must stop asking, or the caller disposes and recreates
  // every render target once a second forever
  assert.equal(tuneQuality(10), false);
});

test('sustained speed reaches the documented ceiling on BOTH axes', () => {
  for (let i = 0; i < 200; i++) tuneQuality(120);
  assert.equal(Q.scale, 0.92);
  assert.equal(Q.steps, 220, 'steps used to strand at 200');
  assert.equal(tuneQuality(120), false);
});

test('a steps-only change does not ask for a reallocation', () => {
  // steps is a uniform; only scale changes the size of the render targets
  for (let i = 0; i < 200; i++) tuneQuality(10);      // both at the floor
  Q.steps = 200;                                      // scale still 0.5
  assert.equal(tuneQuality(10), false, 'moved steps but not scale — no realloc');
  assert.equal(Q.steps, 184, 'steps should still have moved');
});

test('scale and steps never leave the documented band', () => {
  // random walk through plausible and implausible frame rates
  let seed = 1;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 20000; i++) {
    tuneQuality(rnd() * 200);
    assert.ok(Q.scale >= 0.5 && Q.scale <= 0.92, `scale escaped: ${Q.scale}`);
    assert.ok(Q.steps >= 96 && Q.steps <= 220, `steps escaped: ${Q.steps}`);
  }
});

test('survives a garbage frame rate without corrupting state', () => {
  for (const fps of [0, -1, NaN, Infinity, -Infinity]) {
    Object.assign(Q, DEFAULTS);
    tuneQuality(fps);
    assert.ok(Number.isFinite(Q.scale) && Q.scale >= 0.5 && Q.scale <= 0.92, `scale after ${fps}: ${Q.scale}`);
    assert.ok(Number.isFinite(Q.steps) && Q.steps >= 96 && Q.steps <= 220, `steps after ${fps}: ${Q.steps}`);
  }
});

test('recovers: down then up returns toward the middle', () => {
  for (let i = 0; i < 20; i++) tuneQuality(20);
  assert.equal(Q.scale, 0.5);
  for (let i = 0; i < 20; i++) tuneQuality(120);
  assert.equal(Q.scale, 0.92);
});

test('drops faster than it climbs', () => {
  // asymmetric on purpose — falling behind should be corrected quickly,
  // climbing back should not overshoot into another stall
  Object.assign(Q, DEFAULTS);
  tuneQuality(10);
  const down = 0.85 - Q.scale;
  Object.assign(Q, DEFAULTS);
  tuneQuality(120);
  const up = Q.scale - 0.85;
  assert.ok(down > up, `down ${down} should exceed up ${up}`);
});
