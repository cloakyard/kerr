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

/* Read the signals; output.js decides what they mean. outputLatency is only
   meaningful once the context is actually running — before the first gesture
   it reads 0, which would look exactly like a wired output. */
function detectOutput(){
  const c = Audio.ctx;
  return classifyOutput({
    ua: navigator.userAgent,
    uaMobile: navigator.userAgentData && navigator.userAgentData.mobile,
    maxTouchPoints: navigator.maxTouchPoints,
    latency: c && c.state === 'running' ? (c.outputLatency || 0) : 0
  });
}

let voicePref = 'auto', autoOut = null;

function voiceWhy(){
  if (voicePref !== 'auto') return VOICE_DESC[voicePref];
  // says what was observed and what was chosen from it — the browser knows
  // the device class and whether the link is wireless, and nothing more
  const o = autoOut;
  // the space before the break matters: aria-live reads the text layer, where
  // a bare <br> would run the two sentences together
  if (o.wireless) return 'Wireless output — voiced for <b>headphones</b>. <br>On powered speakers, tap Speakers';
  return (o.handheld ? 'Phone or tablet' : 'Laptop or desktop') + ' — voiced for <b>built-in</b>';
}

function setVoice(mode){
  if (!VOICE_ORDER.includes(mode)) mode = 'auto';
  voicePref = mode;
  autoOut = detectOutput();
  Audio.setVoicing(mode === 'auto' ? autoOut.mode : mode);
  try { localStorage.setItem(VOICE_KEY, mode); } catch(e){}
  // the segments track what you *chose*, so Auto stays lit while it is in charge
  document.querySelectorAll('.seg2 [data-voice]').forEach(b => {
    const on = b.dataset.voice === mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const b = $('bVoice');
  if (b){ b.textContent = VOICE_LABEL[mode]; b.classList.toggle('on', mode !== 'auto'); }
  const w = $('pickwhy');
  if (w) w.innerHTML = voiceWhy();
}

/* Re-run the guess. outputLatency means nothing until the context is running,
   so the wireless check cannot happen until after the first gesture, and the
   device list changes again whenever headphones are plugged in or a speaker
   wakes up. Only ever while Auto is in charge — an explicit choice should not
   be second-guessed by a heuristic. */
export function refreshAuto(announceChange){
  if (voicePref !== 'auto') return;
  const was = autoOut && autoOut.mode;
  setVoice('auto');
  if (announceChange && was && autoOut.mode !== was) toast(VOICE_DESC[autoOut.mode]);
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

if (navigator.mediaDevices && 'ondevicechange' in navigator.mediaDevices){
  // outputLatency still reports the old sink for a moment after a swap
  navigator.mediaDevices.addEventListener('devicechange', () => setTimeout(() => refreshAuto(true), 400));
}

try { setVoice(localStorage.getItem(VOICE_KEY) || 'auto'); } catch(e){ setVoice('auto'); }

/* volume */
const VOL_KEY = 'kerr.vol';
const volEl = $('vol');
export function setVol(v, announceChange){
  v = Math.max(0, Math.min(1, v));
  Audio.vol = v;
  Audio.setVolume(v);
  volEl.value = String(Math.round(v * 100));
  try { localStorage.setItem(VOL_KEY, String(v)); } catch(e){}
  if (announceChange) toast('Volume ' + Math.round(v * 100) + '%');
}
volEl.oninput = () => setVol(volEl.value / 100, false);
try { const s = localStorage.getItem(VOL_KEY); if (s !== null) setVol(parseFloat(s), false); } catch(e){}
