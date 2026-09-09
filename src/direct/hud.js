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
    mapEl.appendChild(d); segs.push({ el:d, s:0, e:Audio.duration(), sec:{ n:'YOUR TRACK', t:'drop' } });
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
  measCtx.font = '6.5px ui-monospace, SFMono-Regular, Menlo, monospace';
  return measCtx.measureText(text).width + text.length * 6.5 * 0.12 + 12;
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
let scrubPointer = null;
mapEl.addEventListener('pointerdown', e => {
  if (e.button !== 0 || scrubPointer !== null) return;
  scrubPointer = e.pointerId; mapEl.setPointerCapture(e.pointerId);
  Audio.seek(posOf(e) * Audio.duration());
  hintEl.classList.add('gone');
});
mapEl.addEventListener('pointermove', e => {
  const f = posOf(e);
  scrubEl.textContent = fmt(f * Audio.duration());
  // clamped so the readout never hangs off the edge at either end
  const w = mapEl.getBoundingClientRect().width, half = scrubEl.offsetWidth / 2;
  scrubEl.style.left = Math.max(half, Math.min(w - half, f * w)) + 'px';
  if (scrubPointer === e.pointerId) Audio.seek(f * Audio.duration());
});
const endScrub = e => { if (e.pointerId === scrubPointer) scrubPointer = null; };
mapEl.addEventListener('pointerup', endScrub);
mapEl.addEventListener('pointercancel', endScrub);
mapEl.addEventListener('lostpointercapture', endScrub);
addEventListener('blur', () => { scrubPointer = null; });
mapEl.addEventListener('keydown', e => {
  const d = Audio.duration();
  if (e.code === 'Space'){ e.preventDefault(); e.stopPropagation(); $('bPause').click(); }
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
    e.preventDefault(); e.stopPropagation();
    Audio.seek(Audio.time() + (e.key === 'ArrowRight' ? 5 : -5));
  } else if (e.key === 'Home'){ e.preventDefault(); e.stopPropagation(); Audio.seek(0); }
  else if (e.key === 'End'){ e.preventDefault(); e.stopPropagation(); Audio.seek(d - 1); }
});

let toastT = 0;
export function toast(msg){
  const el = $('toast');
  el.textContent = msg; el.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('on'), 1600);
}

/* The button holds an SVG, so its state is a class and an aria-label — writing
   textContent here would replace the icon with a word and never put it back. */
$('bPause').onclick = () => {
  const playing = Audio.toggle();
  $('bPause').classList.toggle('paused', !playing);
  $('bPause').setAttribute('aria-label', playing ? 'Pause' : 'Resume');
};
const fullEl = $('bFull'), fullLabel = fullEl.querySelector('.fullscreen-label');
let fullscreenPending = false;
function syncFullscreen(){
  const active = !!document.fullscreenElement;
  fullEl.classList.toggle('fullscreen', active);
  fullLabel.textContent = active ? 'Exit fullscreen' : 'Fullscreen';
  fullEl.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
  fullEl.title = (active ? 'Exit fullscreen' : 'Enter fullscreen') + ' (F)';
}
// Use browser state so Escape, browser controls and rejected requests cannot
// leave an exit icon on a windowed view (or an enter icon in fullscreen).
document.addEventListener('fullscreenchange', syncFullscreen);
syncFullscreen();
fullEl.onclick = async () => {
  if (fullscreenPending) return;
  fullscreenPending = true;
  try {
    if (!document.fullscreenElement){
      if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else toast('Fullscreen is not available in this browser');
    } else await document.exitFullscreen();
  } catch(e){ toast('Fullscreen is not available in this view'); }
  finally { fullscreenPending = false; syncFullscreen(); }
};
$('bScore').onclick = () => {
  Audio.start();
  buildMap();
  setSection('DRIFT');
  toast('Original score');
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
  layoutHud();
  $('boot').inert = true;
  $('bPause').focus({ preventScroll:true });
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

const spectrum = new Float32Array(112);
function drawSpectrum(dt){
  const c = specCtx, W = specCv.width, H = specCv.height;
  if (!W || !H) return;
  c.clearRect(0, 0, W, H);
  const N = spectrum.length, bw = W / N, base = H - 2 * Q.dpr;
  const sampleRate = Audio.ctx?.sampleRate || 48000;
  const bins = Audio.freq?.length || 2048;
  const binHz = sampleRate / (bins * 2);
  const smooth = 1 - Math.exp(-Math.min(dt, .05) * 17);
  // Logarithmic band aggregation keeps the display calibrated across audio
  // sample rates and FFT sizes. A restrained curve carries the shape while
  // finer bars make individual harmonics visible without overpowering it.
  for (let i = 0; i < N; i++){
    const from = Math.max(1, Math.floor(20 * Math.pow(800, i / N) / binHz));
    const to = Math.min(bins - 1, Math.max(from, Math.ceil(20 * Math.pow(800, (i + 1) / N) / binHz)));
    let v = 0;
    for (let j = from; j <= to; j++) v = Math.max(v, (Audio.freq?.[j] || 0) / 255);
    spectrum[i] += (Math.pow(v, 1.65) - spectrum[i]) * smooth;
  }
  c.strokeStyle = 'rgba(154,180,162,.13)'; c.lineWidth = Q.dpr * .6;
  c.beginPath(); c.moveTo(0, base); c.lineTo(W, base); c.stroke();
  for (let i = 0; i < N; i++){
    const v = spectrum[i], h = v * (H - 4 * Q.dpr);
    c.fillStyle = `rgba(193,163,118,${.05 + v * .20})`;
    c.fillRect(i * bw, base - h, Math.max(Q.dpr * .5, bw - 2 * Q.dpr), h);
  }
  const gradient = c.createLinearGradient(0, 0, W, 0);
  gradient.addColorStop(0, 'rgba(158,184,174,.42)');
  gradient.addColorStop(.28, 'rgba(221,183,130,.78)');
  gradient.addColorStop(.7, 'rgba(207,195,162,.57)');
  gradient.addColorStop(1, 'rgba(124,172,178,.34)');
  c.strokeStyle = gradient; c.lineWidth = .9 * Q.dpr;
  c.beginPath();
  for (let i = 0; i < N; i++){
    const x = (i + .5) * bw, y = base - spectrum[i] * (H - 4 * Q.dpr);
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.stroke();
}

const hudEls = Object.fromEntries(['t1','t2','trackTitle','audioSource','audioStatus','bPause','bScore','tempo','beatDot','tSpin','tRh','tIsco','tDin','tOrb','tQ'].map(id => [id, $(id)]));
const writeText = (el, value) => { if (el.textContent !== value) el.textContent = value; };
let readoutT = 0, lastError = '', mapDuration = 0, mapMode = '';

/** One frame of readouts. `dist` is the camera's orbital radius — the only
 *  number here the HUD cannot look up for itself. */
export function updateHud(t, dt, dist){
  if (!live) return;
  const dur = Audio.duration();
  writeText(hudEls.t1, fmt(t)); writeText(hudEls.t2, Audio.loading ? '–:––' : fmt(dur));
  if (Audio.mode !== mapMode || Math.abs(dur - mapDuration) > .1){
    mapMode = Audio.mode; mapDuration = dur; buildMap();
  }
  const file = Audio.mode === 'file';
  writeText(hudEls.trackTitle, file ? Audio.trackName || 'Your track' : 'The gravity of sound');
  hudEls.trackTitle.title = file ? Audio.trackName || 'Your track' : 'Original generative score · Organ, strings and timpani';
  writeText(hudEls.audioSource, file ? 'LOCAL AUDIO' : 'GENERATIVE SCORE');
  const status = Audio.error ? 'PLAYBACK ERROR' : Audio.loading ? 'LOADING…' : !Audio.playing ? 'PAUSED' : file ? 'AUDIO REACTIVE' : 'LIVE SYNTHESIS';
  writeText(hudEls.audioStatus, status);
  hudEls.audioStatus.title = Audio.error || '';
  hudEls.bPause.classList.toggle('paused', !Audio.playing);
  hudEls.bPause.setAttribute('aria-label', Audio.playing ? 'Pause' : 'Resume');
  hudEls.bScore.hidden = !file;
  if (Audio.error && Audio.error !== lastError) toast(Audio.error);
  lastError = Audio.error || '';
  const features = Audio.features || {};
  const confident = !file || features.beatConfidence > .5;
  writeText(hudEls.tempo, confident && features.bpm ? String(Math.round(features.bpm)) : !file ? '120' : '—');
  hudEls.tempo.parentElement.setAttribute('aria-label', confident ? 'Tempo ' + hudEls.tempo.textContent + ' beats per minute' : 'Listening for a steady beat');
  hudEls.beatDot.style.opacity = (.2 + Math.min(1, features.beatEnv || 0) * .8).toFixed(2);
  hudEls.beatDot.style.boxShadow = `0 0 ${Math.round((features.beatEnv || 0) * 8)}px rgba(215,170,120,.5)`;
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
    const ls = 0.16 + u * 0.025 + announcePeak * 0.02;
    dropEl.style.opacity = a.toFixed(3);
    dropName.style.letterSpacing = ls.toFixed(3) + 'em';
    dropName.style.textIndent = ls.toFixed(3) + 'em';        // keeps it optically centred
    dropRule.style.width = (Math.min(1, u / 0.4) * (110 + announcePeak * 70)).toFixed(0) + 'px';
  } else if (dropEl.style.opacity !== '0') dropEl.style.opacity = '0';
  drawSpectrum(dt);
  // Telemetry refreshes eight times a second, leaving the animation budget
  // to the image rather than reparsing identical DOM strings every frame.
  readoutT += dt;
  if (readoutT < .125) return;
  readoutT = 0;
  writeText(hudEls.tSpin, BH.spin.toFixed(2));
  hudEls.tRh.innerHTML = BH.rh.toFixed(2) + ' r<sub>s</sub>';
  hudEls.tIsco.innerHTML = BH.isco.toFixed(2) + ' r<sub>s</sub>';
  hudEls.tDin.innerHTML = BH.din.toFixed(2) + ' r<sub>s</sub>';
  hudEls.tOrb.innerHTML = dist.toFixed(1) + ' r<sub>s</sub>';
  writeText(hudEls.tQ, Q.steps + ' / ' + Q.scale.toFixed(2));
}
