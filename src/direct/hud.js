/* The readouts: arrangement map, transport, telemetry, spectrum, title cards.
   Everything that writes to the DOM every frame lives here, so the frame loop
   in main.js says `updateHud(...)` once instead of touching a dozen elements. */
import { $ } from './dom.js';
import { Audio } from '../audio/engine.js';
import { SECTIONS, BAR } from '../audio/arrangement.js';
import { BH } from '../render/bh.js';
import { Q } from '../render/quality.js';

const hud = $('hud'), mapEl = $('map'), playEl = $('play'), hintEl = $('hint'), dropEl = $('drop');
const dropName = $('dropName'), dropRule = $('dropRule');
const specCv = $('spec'), specCtx = specCv.getContext('2d');
let segs = [];

/* Set once the boot screen is dismissed. Before that there is nothing on
   screen to update, and the map has no width to measure. */
let live = false;

export function buildMap(){
  mapEl.querySelectorAll('.seg').forEach(n => n.remove());
  segs = [];
  if (Audio.mode === 'file'){
    const d = document.createElement('div');
    d.className = 'seg'; d.style.flex = '1'; d.title = 'YOUR TRACK';
    mapEl.appendChild(d); segs.push({ el:d, s:0, e:1, sec:{ n:'YOUR TRACK', t:'drop' } });
    fitMapLabels();
    return;
  }
  for (const s of SECTIONS){
    const d = document.createElement('div');
    d.className = 'seg'; d.style.flex = String(s.b);
    d.title = s.n;
    mapEl.appendChild(d);
    segs.push({ el:d, s:s.s * BAR, e:(s.s + s.b) * BAR, sec:s });
  }
  fitMapLabels();
}

/* A caption only earns its place if it fits its own segment. A bar-count
   heuristic cannot know that — at 768px "ASCENT II" ran straight into
   "INGRESS" — so measure the text against the rendered width instead, and
   redo it on resize. */
const measCtx = document.createElement('canvas').getContext('2d');
function labelWidth(text){
  measCtx.font = '7.5px ui-monospace, SFMono-Regular, Menlo, monospace';
  return measCtx.measureText(text).width + text.length * 7.5 * 0.14 + 12;
}
function fitMapLabels(){
  for (const s of segs){
    const w = s.el.getBoundingClientRect().width;
    if (w && labelWidth(s.sec.n) <= w) s.el.dataset.l = s.sec.n;
    else delete s.el.dataset.l;
  }
}

/* The HUD's half of a window resize. render/scene.js sizes the drawing
   buffers; this sizes the things made of DOM. Both are wired in main.js —
   neither calls the other. */
export function layoutHud(){
  specCv.width  = Math.floor(specCv.clientWidth  * Q.dpr);
  specCv.height = Math.floor(specCv.clientHeight * Q.dpr);
  fitMapLabels();
}

const fmt = s => { s = Math.max(0, s | 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const scrubEl = $('scrub');

/* Timeline: drag to scrub, hover for a time readout, keyboard accessible.
   It used to be click-to-jump only, with no indication of where you'd land. */
const posOf = e => {
  const r = mapEl.getBoundingClientRect();
  return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
};
let scrubbing = false;
mapEl.addEventListener('pointerdown', e => {
  scrubbing = true; mapEl.setPointerCapture(e.pointerId);
  Audio.seek(posOf(e) * Audio.duration());
  hintEl.classList.add('gone');
});
mapEl.addEventListener('pointermove', e => {
  const f = posOf(e);
  scrubEl.textContent = fmt(f * Audio.duration());
  // clamped so the readout never hangs off the edge at either end
  const w = mapEl.getBoundingClientRect().width, half = scrubEl.offsetWidth / 2;
  scrubEl.style.left = Math.max(half, Math.min(w - half, f * w)) + 'px';
  if (scrubbing) Audio.seek(f * Audio.duration());
});
mapEl.addEventListener('pointerup', () => { scrubbing = false; });
mapEl.addEventListener('pointercancel', () => { scrubbing = false; });
mapEl.addEventListener('keydown', e => {
  const d = Audio.duration();
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
    e.preventDefault(); e.stopPropagation();
    Audio.seek(Audio.time() + (e.key === 'ArrowRight' ? 5 : -5));
  } else if (e.key === 'Home'){ e.preventDefault(); Audio.seek(0); }
  else if (e.key === 'End'){ e.preventDefault(); Audio.seek(d - 1); }
});

let toastT = 0;
export function toast(msg){
  const el = $('toast');
  el.textContent = msg; el.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('on'), 1600);
}

$('bPause').onclick = () => { $('bPause').textContent = Audio.toggle() ? 'PAUSE' : 'RESUME'; };
$('bFull').onclick = () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
  else document.exitFullscreen();
};

export const setSection = text => { $('sect').textContent = text; };
export const setIdle = on => { hud.classList.toggle('idle', on && live); };

/* Reveal: the boot screen goes, the HUD arrives, the map gets built now that
   it finally has a width to measure against. */
export function revealHud(){
  live = true;
  document.body.classList.remove('boot');
  $('boot').classList.add('gone');
  hud.classList.add('on');
  buildMap();
  setTimeout(() => hintEl.classList.add('gone'), 9000);
}

/* Every section gets a title card, not just the three peaks — the piece opens
   on DRIFT and used to announce nothing at all. Peaks hold longer and run
   wider so they still read as the arrival they are. */
let announceT = 0, announceDur = 3.4, announcePeak = 0;
export function announce(sec){
  if (!sec) return;
  setSection(sec.n);
  const i = SECTIONS.indexOf(sec);
  const peak = sec.t === 'drop' || sec.t === 'drop2' || sec.t === 'final';
  $('dropIdx').textContent =
    String(i + 1).padStart(2, '0') + ' / ' + String(SECTIONS.length).padStart(2, '0');
  $('dropName').textContent = sec.n;
  announcePeak = peak ? 1 : 0;
  announceDur = peak ? 4.6 : 3.2;
  announceT = 1;
}

function drawSpectrum(){
  if (!Audio.freq) return;
  const c = specCtx, W = specCv.width, H = specCv.height;
  c.clearRect(0, 0, W, H);
  const N = 84;
  const bw = W / N;
  for (let i = 0; i < N; i++){
    const idx = Math.floor(Math.pow(i / N, 2.1) * 380) + 1;
    const v = Audio.freq[idx] / 255;
    const h = Math.pow(v, 1.4) * H;
    const warm = i < N * 0.45;
    c.fillStyle = warm ? 'rgba(255,178,87,' + (0.28 + v * 0.6) + ')'
                       : 'rgba(127,180,255,' + (0.22 + v * 0.55) + ')';
    c.fillRect(i * bw, H - h, Math.max(1, bw - 2 * Q.dpr), h);
  }
}

/** One frame of readouts. `dist` is the camera's orbital radius — the only
 *  number here the HUD cannot look up for itself. */
export function updateHud(t, dt, dist){
  if (!live) return;
  const dur = Audio.duration();
  $('t1').textContent = fmt(t); $('t2').textContent = fmt(dur);
  playEl.style.left = (Math.min(1, t / dur) * 100) + '%';
  for (const s of segs){
    const on = t >= s.s && t < s.e;
    s.el.classList.toggle('hot', on);
    s.el.classList.toggle('past', t >= s.e);
  }
  mapEl.setAttribute('aria-valuenow', String(Math.round((t / dur) * 100)));
  mapEl.setAttribute('aria-valuetext', fmt(t) + ' of ' + fmt(dur));
  /* Envelope: rise, hold, fall — the old curve was pow(a,2), already down
     to a fifth of its opacity by the halfway point, so it never landed. */
  if (announceT > 0){
    announceT -= dt / announceDur;
    const u = Math.min(1, Math.max(0, 1 - announceT));       // 0 -> 1 over its life
    const a = Math.min(1, u / 0.13) * Math.min(1, (1 - u) / 0.28);
    const ls = 0.34 + u * 0.12 + announcePeak * 0.06;
    dropEl.style.opacity = a.toFixed(3);
    dropName.style.letterSpacing = ls.toFixed(3) + 'em';
    dropName.style.textIndent = ls.toFixed(3) + 'em';        // keeps it optically centred
    dropRule.style.width = (Math.min(1, u / 0.4) * (110 + announcePeak * 70)).toFixed(0) + 'px';
  } else if (dropEl.style.opacity !== '0') dropEl.style.opacity = '0';
  drawSpectrum();
  // real telemetry now: the actual simulation state, not just a render scale
  $('tSpin').textContent = BH.spin.toFixed(2);
  $('tRh').innerHTML = BH.rh.toFixed(2) + ' r<sub>s</sub>';
  // ISCO is the true Kerr value for this spin; the rendered disk's inner
  // edge is held slightly further out so it clears the shadow silhouette
  $('tIsco').innerHTML = BH.isco.toFixed(2) + ' r<sub>s</sub>';
  $('tDin').innerHTML = BH.din.toFixed(2) + ' r<sub>s</sub>';
  $('tOrb').innerHTML = dist.toFixed(1) + ' r<sub>s</sub>';
  $('tQ').textContent = Q.steps + ' / ' + Q.scale.toFixed(2);
}
