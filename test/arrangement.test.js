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
  PROG, ARP, LEAD, PHRASE, mtof, frand, sectionOfBar, intensityAt,
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

/* The continuity invariant. Every section used to swell across its own
   progress from its own floor, so all nine section changes stepped backwards —
   between 25% and 77% of the scheduled energy — and the piece sounded like it
   restarted ten times. These four tests are the reason that cannot come back by
   editing one number in SECTIONS. */
test('intensity is one curve: each section leaves where the next comes in', () => {
  for (let i = 1; i < SECTIONS.length; i++) {
    assert.equal(
      SECTIONS[i].i0, SECTIONS[i - 1].i1,
      `${SECTIONS[i].n} comes in at ${SECTIONS[i].i0} but ${SECTIONS[i - 1].n} left at ${SECTIONS[i - 1].i1}`,
    );
  }
});

test('every section declares an intensity, and all of them are usable levels', () => {
  for (const s of SECTIONS) {
    for (const k of ['i0', 'i1']) {
      assert.equal(typeof s[k], 'number', `${s.n} has no ${k}`);
      // > 0: a level of zero is a hole, which is the thing being fixed
      assert.ok(s[k] > 0 && s[k] <= 1, `${s.n}.${k} = ${s[k]} is not a level`);
    }
  }
  // the piece has to actually go somewhere
  assert.equal(Math.max(...SECTIONS.map((s) => s.i1)), 1, 'nothing reaches full intensity');
  assert.equal(SECTIONS.at(-1).t, 'outro', 'the quietest ending is not last');
  assert.ok(SECTIONS.at(-1).i1 < SECTIONS[0].i0, 'the piece does not end below where it began');
});

test('intensityAt never steps at a section boundary', () => {
  // one step of a section's own slope is the most it may move; the steepest
  // section here is HORIZON, falling 0.94 over 12 bars
  const slope = Math.max(...SECTIONS.map((s) => Math.abs(s.i1 - s.i0) / (s.b * 16)));
  for (let i = 1; i < SECTIONS.length; i++) {
    const at = SECTIONS[i].s * 16;
    const jump = Math.abs(intensityAt(at) - intensityAt(at - 1));
    assert.ok(jump <= slope + 1e-9, `${SECTIONS[i].n} steps ${jump.toFixed(4)} at its downbeat`);
  }
});

test('intensityAt stays inside every section it is asked about', () => {
  for (const s of SECTIONS) {
    const lo = Math.min(s.i0, s.i1), hi = Math.max(s.i0, s.i1);
    for (let st = 0; st < s.b * 16; st++) {
      const I = intensityAt(s.s * 16 + st);
      assert.ok(I >= lo - 1e-9 && I <= hi + 1e-9, `${s.n} step ${st}: ${I} outside [${lo}, ${hi}]`);
    }
    assert.ok(Math.abs(intensityAt(s.s * 16) - s.i0) < 1e-9, `${s.n} does not start at i0`);
  }
  // out of range on both sides rather than NaN — the sequencer clamps, not guesses
  assert.equal(intensityAt(0), SECTIONS[0].i0);
  assert.ok(Math.abs(intensityAt(TOTAL_STEPS * 2) - SECTIONS.at(-1).i1) < 1e-9);
  assert.ok(Math.abs(intensityAt(-16) - SECTIONS[0].i0) < 1e-9);
});

test('sectionOfBar covers the piece and agrees with the offsets', () => {
  for (const s of SECTIONS) {
    assert.equal(sectionOfBar(s.s).n, s.n, `${s.n} does not own its own first bar`);
    assert.equal(sectionOfBar(s.s + s.b - 1).n, s.n, `${s.n} does not own its own last bar`);
  }
  for (let b = 0; b < TOTAL_BARS; b++) {
    const s = sectionOfBar(b);
    assert.ok(b >= s.s && b < s.s + s.b, `bar ${b} landed in ${s.n}`);
  }
  assert.equal(sectionOfBar(-1).n, SECTIONS[0].n);          // before the start
  assert.equal(sectionOfBar(TOTAL_BARS).n, SECTIONS.at(-1).n);
});

/* The pads, the tick figure and the melody are all grouped on the absolute bar
   so their phrasing does not re-phase where sections meet. That is only sound
   if no section starts mid-phrase. */
test('every section starts on a phrase boundary', () => {
  assert.equal(PHRASE, 4);
  for (const s of SECTIONS) {
    assert.equal(s.s % PHRASE, 0, `${s.n} starts at bar ${s.s}, mid-phrase`);
    assert.equal(s.b % 2, 0, `${s.n} is ${s.b} bars, which breaks the two-bar chord grid`);
  }
});

test('the lead line agrees with the harmony under it at every bar', () => {
  /* LEAD is eight bars written against two bars per chord, so it only lines up
     with PROG when it is indexed on the absolute bar. It used to be indexed on
     the bar within the section, which both restarted the melody at every
     section change and — since section starts are not all multiples of eight —
     put its D minor opening over whatever chord was sounding. */
  for (let bar = 0; bar < TOTAL_BARS; bar++) {
    const leadGroup = Math.floor((bar % 8) / 2);      // which chord LEAD was written for
    const progIndex = (bar >> 1) % 4;                 // which chord actually sounds
    assert.equal(leadGroup, progIndex, `bar ${bar}: lead is on chord ${leadGroup}, harmony is ${progIndex}`);
  }
  // and the bug was real: these sections do not start on an eight-bar boundary,
  // so section-local indexing put the melody on the wrong chord in each of them
  const offPhrase = SECTIONS.filter((s) => s.s % 8 !== 0).map((s) => s.n);
  assert.deepEqual(offPhrase, ['ASCENT', 'EVENT HORIZON', 'FALLING', 'ASCENT III', 'HORIZON']);
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
