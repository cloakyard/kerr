/* Output voicing and volume.
   The three voicings are a real signal-path change inside the engine — see
   Audio.VOICINGS. This module is only the part that decides which one is in
   force, explains the choice, and remembers it. */
import { $ } from './dom.js';
import { Audio } from '../audio/engine.js';
import { toast } from './hud.js';
import { classifyOutput } from './output.js';

const VOICE_KEY = 'kerr.voicing';
const VOICE_ORDER = ['auto', 'laptop', 'monitors', 'phones'];
const VOICE_LABEL = { auto:'AUTO', laptop:'BUILT-IN', monitors:'SPEAKERS', phones:'PHONES' };
const VOICE_DESC  = { laptop:'Voiced for laptop and phone speakers',
                      monitors:'Voiced for powered speakers',
                      phones:'Voiced for headphones' };

const MODE_NAME = { laptop:'Built-in', monitors:'Speakers', phones:'Headphones' };
let voicePref = 'auto', autoOut = classifyOutput();
let revision = 0, pollTimer, watchedContext;

function voiceWhy(){
  if (voicePref !== 'auto') return VOICE_DESC[voicePref];
  const o = autoOut;
  const name = o.label.length > 64 ? o.label.slice(0, 61) + '…' : o.label;
  if (o.source === 'label') return name + ' — ' + MODE_NAME[o.mode] + ' voicing';
  return (name ? name + ': type unknown.' : 'Output type unavailable.') + ' Using Built-in; choose your output if needed.';
}

function updateVoice(){
  const mode = voicePref, resolved = mode === 'auto' ? autoOut.mode : mode;
  // A refresh must not continually restart the eleven EQ/compression ramps.
  if (Audio.voicing !== resolved) Audio.setVoicing(resolved);
  // the segments track what you *chose*, so Auto stays lit while it is in charge
  document.querySelectorAll('.seg2 [data-voice]').forEach(b => {
    const on = b.dataset.voice === mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const b = $('bVoice');
  if (b){
    b.textContent = VOICE_LABEL[mode]; b.classList.toggle('on', mode !== 'auto');
    b.title = voiceWhy();
    b.setAttribute('aria-label', 'Change output voicing. ' + (mode === 'auto' ? 'Auto: ' : '') + voiceWhy());
  }
  const w = $('pickwhy');
  // Device labels may contain markup (or a personal device name).
  if (w && w.textContent !== voiceWhy()) w.textContent = voiceWhy();
}

function setVoice(mode){
  voicePref = VOICE_ORDER.includes(mode) ? mode : 'auto';
  revision++;
  clearTimeout(pollTimer);
  try { localStorage.setItem(VOICE_KEY, voicePref); } catch(e){}
  updateVoice();
  if (voicePref === 'auto') void refreshAuto(false);
}

function contextChanged(){ void refreshAuto(true); }

/* Read only already-exposed metadata. No permission prompts, output routing
   changes or saved device IDs. Recheck after resume and while visible/running
   because some browsers do not emit devicechange for every route change. */
export async function refreshAuto(announceChange = false){
  const c = Audio.ctx;
  if (c !== watchedContext){
    watchedContext?.removeEventListener('statechange', contextChanged);
    watchedContext?.removeEventListener('sinkchange', contextChanged);
    watchedContext = c;
    c?.addEventListener('statechange', contextChanged);
    c?.addEventListener('sinkchange', contextChanged);
  }
  clearTimeout(pollTimer);
  const request = ++revision;
  if (voicePref !== 'auto' || document.hidden) return;
  const sinkId = c?.sinkId ?? '';
  let devices = [];
  try { devices = await navigator.mediaDevices?.enumerateDevices() || []; } catch(e){}
  // A slower read from the previous output must not undo a newer result or a
  // manual selection made while enumeration was pending.
  if (request !== revision || voicePref !== 'auto') return;
  if (c !== Audio.ctx || sinkId !== (c?.sinkId ?? '')) { void refreshAuto(announceChange); return; }
  const was = autoOut.mode;
  autoOut = classifyOutput({ devices, sinkId });
  updateVoice();
  if (announceChange && autoOut.mode !== was) toast('Auto — ' + VOICE_DESC[autoOut.mode]);
  if (c?.state === 'running') pollTimer = setTimeout(() => refreshAuto(true), 2000);
}

document.querySelectorAll('.seg2 [data-voice]').forEach(b => {
  b.onclick = () => setVoice(b.dataset.voice);
});

export function cycleVoice(){
  const next = VOICE_ORDER[(VOICE_ORDER.indexOf(voicePref) + 1) % VOICE_ORDER.length];
  setVoice(next);
  toast(next === 'auto'
    ? 'Auto — ' + VOICE_DESC[autoOut.mode].replace('Voiced for ', '')
    : VOICE_DESC[next]);
}
$('bVoice').onclick = cycleVoice;

navigator.mediaDevices?.addEventListener('devicechange', contextChanged);
addEventListener('focus', contextChanged);
document.addEventListener('visibilitychange', contextChanged);

try { setVoice(localStorage.getItem(VOICE_KEY) || 'auto'); } catch(e){ setVoice('auto'); }

/* volume */
const VOL_KEY = 'kerr.vol';
const volEl = $('vol');
/* The wedge behind the slider is drawn in CSS and needs to know the level, so
   it reads it off --v. It has to land on .vtrack rather than on the input:
   custom properties inherit downward, and the pseudo-elements that use it
   belong to the parent. */
const volTrack = volEl.parentElement;
export function setVol(v, announceChange){
  v = Math.max(0, Math.min(1, v));
  Audio.vol = v;
  Audio.setVolume(v);
  const pct = Math.round(v * 100);
  volEl.value = String(pct);
  volTrack.style.setProperty('--v', pct + '%');
  try { localStorage.setItem(VOL_KEY, String(v)); } catch(e){}
  if (announceChange) toast('Volume ' + Math.round(v * 100) + '%');
}
volEl.oninput = () => setVol(volEl.value / 100, false);
/* Always run it once, even with nothing stored: --v has to be set for the wedge
   to match the slider, and leaving it unset made the CSS fallback silently
   responsible for agreeing with the value="" in the markup. */
try {
  const s = localStorage.getItem(VOL_KEY);
  setVol(s === null ? volEl.value / 100 : parseFloat(s), false);
} catch(e){ setVol(volEl.value / 100, false); }
