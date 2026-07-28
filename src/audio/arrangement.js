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

export const SECTIONS = [
  { n:'DRIFT',         t:'intro',  b:12 },
  { n:'ASCENT',        t:'build',  b:8  },
  { n:'EVENT HORIZON', t:'drop',   b:16 },
  { n:'FALLING',       t:'break',  b:12 },
  { n:'ASCENT II',     t:'build',  b:8  },
  { n:'INGRESS',       t:'drop2',  b:16 },
  { n:'DILATION',      t:'bridge', b:12 },
  { n:'ASCENT III',    t:'build',  b:4  },
  { n:'SINGULARITY',   t:'final',  b:20 },
  { n:'HORIZON',       t:'outro',  b:12 }
];
let acc = 0;
for (const s of SECTIONS){ s.s = acc; acc += s.b; }
export const TOTAL_BARS = acc;                    // 120 bars -> 4:00
export const TOTAL_STEPS = TOTAL_BARS * 16;
export const DURATION = TOTAL_STEPS * STEP;

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
