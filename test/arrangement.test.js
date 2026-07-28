/* The score's arithmetic.
   These numbers are quoted on the boot screen ("4:00", "120 BPM") and drive
   the arrangement map, the scrubber and every section change. If a section's
   bar count is edited and the total silently stops being 120, nothing crashes
   — the piece just ends in the wrong place, which is exactly the kind of bug
   a render test would never catch. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BPM, SPB, STEP, BAR, SECTIONS, TOTAL_BARS, TOTAL_STEPS, DURATION,
  PROG, ARP, LEAD, mtof, frand,
} from '../src/audio/arrangement.js';

test('tempo maths is self-consistent', () => {
  assert.equal(BPM, 120);
  assert.equal(SPB, 0.5);
  assert.equal(STEP, 0.125);          // 16th note
  assert.equal(BAR, 2);               // 2.000s, as the comment claims
  assert.equal(BAR, SPB * 4);
  assert.equal(STEP * 16, BAR);
});

test('the piece is 120 bars and runs exactly four minutes', () => {
  assert.equal(TOTAL_BARS, 120);
  assert.equal(TOTAL_STEPS, 120 * 16);
  assert.equal(DURATION, 240);        // the "4:00" on the boot screen
});

test('section offsets are contiguous and cover the whole piece', () => {
  let at = 0;
  for (const s of SECTIONS) {
    assert.equal(s.s, at, `${s.n} starts at the wrong bar`);
    assert.ok(s.b > 0, `${s.n} has no length`);
    at += s.b;
  }
  assert.equal(at, TOTAL_BARS);
});

test('every section has a name and a type the camera knows about', () => {
  // CAM in direct/camera.js is keyed by these; a typo here is a black screen
  const KNOWN = new Set(['intro', 'build', 'drop', 'break', 'drop2', 'bridge', 'final', 'outro']);
  assert.equal(SECTIONS.length, 10);
  for (const s of SECTIONS) {
    assert.match(s.n, /^[A-Z][A-Z ]*I*$/, `odd section name: ${s.n}`);
    assert.ok(KNOWN.has(s.t), `${s.n} has unknown type "${s.t}"`);
  }
});

test('section names are unique', () => {
  assert.equal(new Set(SECTIONS.map((s) => s.n)).size, SECTIONS.length);
});

test('the progression is four chords of five notes, all in range', () => {
  assert.equal(PROG.length, 4);
  for (const c of PROG) {
    assert.equal(c.notes.length, 5);
    assert.ok(c.root >= 21 && c.root <= 108, 'root outside the piano');
    // voiced open across two octaves, ascending
    for (let i = 1; i < c.notes.length; i++) assert.ok(c.notes[i] > c.notes[i - 1]);
    assert.ok(c.notes.at(-1) - c.notes[0] <= 24, 'chord spans more than two octaves');
  }
});

test('the progression is i - VI - III - VII in D minor', () => {
  // D=38, Bb=34, F=41, C=36 as MIDI roots
  assert.deepEqual(PROG.map((c) => c.root), [38, 34, 41, 36]);
});

test('arp is two bars of eighths indexing real chord tones', () => {
  assert.equal(ARP.length, 2);
  for (const bar of ARP) {
    assert.equal(bar.length, 8);
    for (const i of bar) assert.ok(Number.isInteger(i) && i >= 0 && i < 5, `bad chord-tone index ${i}`);
  }
});

test('lead is 8 bars of eighths, rests as 0', () => {
  assert.equal(LEAD.length, 64);
  for (const n of LEAD) assert.ok(n === 0 || (n >= 21 && n <= 108), `bad lead note ${n}`);
});

test('mtof matches the standard tuning', () => {
  assert.equal(mtof(69), 440);                                  // A4
  assert.ok(Math.abs(mtof(60) - 261.6255653) < 1e-6);           // middle C
  assert.ok(Math.abs(mtof(81) - 880) < 1e-9);                   // an octave up
  assert.ok(Math.abs(mtof(57) - 220) < 1e-9);                   // an octave down
});

test('frand is deterministic and stays in [0, 1)', () => {
  assert.equal(frand(7), frand(7));
  assert.notEqual(frand(7), frand(8));
  for (let i = 0; i < 5000; i++) {
    const v = frand(i * 0.37);
    assert.ok(v >= 0 && v < 1, `frand(${i * 0.37}) = ${v} out of range`);
  }
});
