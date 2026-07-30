/* The score, as data.
   Nothing here does anything — it is the piece written down. Change the shape
   of the music by editing this file; change how it sounds by editing
   engine.js. Keeping the two apart is the whole reason this is a module: the
   arrangement used to start on line 423 of a 2,500-line document. */

/* 120 BPM, but written in half-time: the felt pulse is 60 — one beat per
   second, a clock. Eighth notes carry the arpeggio; whole sections move on
   two-bar harmonic changes. */
export const BPM = 120;
export const SPB = 60 / BPM;          // seconds per beat
export const STEP = SPB / 4;          // 16th note
export const BAR = SPB * 4;           // 2.000s

/* `i0`/`i1` are the intensity the section is entered at and left at.

   Dynamics used to belong to the section: every branch of the sequencer swelled
   across its own `p = 0..1`, so all ten sections crescendoed from their own
   floor. Measured across the seams that cost between 25% and 77% of the
   scheduled energy at every one of the nine section changes — a build would
   climb to its ceiling and the drop it was building to would begin at 41% of
   it. Ten crescendos in a row is ten restarts, which is exactly what it
   sounded like.

   So intensity belongs to the piece. Each section names where it comes in and
   where it goes out, and `i1` of one *is* `i0` of the next — a test asserts
   that, so the curve cannot be broken by editing one number. Sections still
   fall: FALLING and HORIZON are supposed to. They just fall from where the
   previous section left off instead of cutting to their own floor, so the
   release reads as release rather than as a new beginning. */
export const SECTIONS = [
  { n:'DRIFT',         t:'intro',  b:12, i0:0.10, i1:0.34 },
  { n:'ASCENT',        t:'build',  b:8,  i0:0.34, i1:0.72 },
  { n:'EVENT HORIZON', t:'drop',   b:16, i0:0.72, i1:0.86 },
  { n:'FALLING',       t:'break',  b:12, i0:0.86, i1:0.44 },
  { n:'ASCENT II',     t:'build',  b:8,  i0:0.44, i1:0.80 },
  { n:'INGRESS',       t:'drop2',  b:16, i0:0.80, i1:0.92 },
  { n:'DILATION',      t:'bridge', b:12, i0:0.92, i1:0.62 },
  { n:'ASCENT III',    t:'build',  b:4,  i0:0.62, i1:0.88 },
  { n:'SINGULARITY',   t:'final',  b:20, i0:0.88, i1:1.00 },
  { n:'HORIZON',       t:'outro',  b:12, i0:1.00, i1:0.06 }
];
let acc = 0;
for (const s of SECTIONS){ s.s = acc; acc += s.b; }
export const TOTAL_BARS = acc;                    // 120 bars -> 4:00
export const TOTAL_STEPS = TOTAL_BARS * 16;
export const DURATION = TOTAL_STEPS * STEP;

export const sectionOfBar = bar => {
  for (let i = SECTIONS.length - 1; i >= 0; i--) if (bar >= SECTIONS[i].s) return SECTIONS[i];
  return SECTIONS[0];
};

/* Intensity at an absolute step: linear inside the section, and continuous
   across every boundary because neighbours share the endpoint. Everything the
   sequencer scales — pad levels, tick density, timpani weight — hangs off this
   one number, so there is a single place the shape of the piece lives. */
export const intensityAt = step => {
  const s = sectionOfBar(Math.floor(step / 16));
  const p = (step - s.s * 16) / (s.b * 16);
  return s.i0 + (s.i1 - s.i0) * Math.max(0, Math.min(1, p));
};

/* Pads, the tick figure and the melody are grouped on the *absolute* bar, never
   on the bar within the section, so their phrasing does not re-phase when a
   section changes. That is only sound if every section starts on a four-bar
   boundary — PHRASE is the grid, and a test holds the section lengths to it. */
export const PHRASE = 4;

/* i - VI - III - VII in D minor, voiced open across two octaves so the
   organ and string ranks have room to stack without turning to mud. */
export const PROG = [
  { root:38, notes:[50, 53, 57, 62, 65] },  // Dm : D3 F3 A3 D4 F4
  { root:34, notes:[46, 50, 53, 58, 62] },  // Bb : Bb2 D3 F3 Bb3 D4
  { root:41, notes:[48, 53, 57, 60, 65] },  // F  : C3 F3 A3 C4 F4
  { root:36, notes:[48, 52, 55, 60, 64] }   // C  : C3 E3 G3 C4 E4
];

// the ticking figure — chord-tone indices, one per eighth note, alternating bars
export const ARP = [
  [0, 2, 4, 2, 1, 3, 4, 3],
  [4, 2, 0, 2, 3, 1, 2, 1]
];

// slow solo line over 8 bars, one slot per eighth note; 0 = rest
export const LEAD = [
  69,0,0,0, 74,0,0,0,    // Dm : A4 -> D5
  72,0,0,0, 69,0,0,0,    //      C5 -> A4
  74,0,0,0, 77,0,0,0,    // Bb : D5 -> F5
  74,0,0,0, 72,0,0,0,    //      D5 -> C5
  72,0,0,0, 69,0,0,0,    // F  : C5 -> A4
  65,0,0,0, 69,0,0,0,    //      F4 -> A4
  74,0,0,0, 76,0,0,0,    // C  : D5 -> E5
  74,0,0,0, 72,0,0,0     //      D5 -> C5
];

export const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
export const frand = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
