/* ============================================================================
   KERR — cinematic black hole audio visualizer

   The composition root. Every module below is independent of the others in
   its own layer; this is the only file that knows about all three:

     audio/    Web Audio synthesis, the arrangement, the analyser
     render/   geodesic raymarch, particle field, post chain
     direct/   camera choreography, event translation, HUD

   The dependency arrows all point inward — direct/ reads render/ and audio/,
   render/ reads neither, audio/ reads nothing at all. Keep it that way: the
   moment render/ imports from direct/, the layering is decoration.
   ========================================================================== */
import { Audio } from './audio/engine.js';
import { renderFrame, resize, retune } from './render/scene.js';
import { BH, setSpin } from './render/bh.js';
import { mountField } from './render/particles.js';
import { cur, view, currentPreset, updateCamera } from './direct/camera.js';
import { rings, onEvent, onBeat } from './direct/events.js';
import { layoutHud, updateHud, setSection, setIdle, revealHud, buildMap } from './direct/hud.js';
import { refreshAuto } from './direct/voicing.js';
import { installDropZone } from './direct/dropzone.js';
import { $ } from './direct/dom.js';
import { installServiceWorker } from './pwa.js';
import './direct/input.js';
import './direct/shortcuts.js';

/* How much of the disk the shimmer covers. render/particles.js has no opinion
   about where the disk is and render/bh.js has no opinion about what is drawn
   in it, so the two are introduced here. */
mountField(BH.din * 1.02, BH.dout * 1.04);

/* ---- boot ---- */
let started = false;

function begin(fn){
  if (!Audio.ready) Audio.init();
  fn ? fn() : Audio.start();
  // first gesture: the context is finally running, so outputLatency can be read
  setTimeout(() => refreshAuto(true), 350);
  if (started){ buildMap(); return; }
  started = true;
  revealHud();
}

$('go').onclick = () => begin();
installDropZone(f => begin(() => Audio.loadFile(f)));

/* In file mode there are no named sections, so the label describes the
   energy the onset detector is seeing instead. */
const FILE_LABEL = { final:'PEAK', drop2:'HIGH', drop:'DRIVE', bridge:'MOTION', break:'CALM' };

/* ---- frame ---- */
let last = performance.now(), frames = 0, fpsAcc = 0;

function frame(now){
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  fpsAcc += dt; frames++;

  if (Audio.ready){
    Audio.update();
    Audio.popEvents(onEvent);
    if (Audio.mode === 'file' && Audio.beat > 0) onBeat(Audio.beat);
  }

  const t = Audio.ready ? Audio.time() : 0;
  const { key, p, sec } = currentPreset(t, Audio);
  if (key !== view.key){
    view.key = key;
    if (Audio.mode === 'synth'){ if (sec) setSection(sec.n); }
    else setSection(FILE_LABEL[key]);
  }

  const time = performance.now() / 1000;
  const cam = updateCamera(dt, p, Audio, time);
  setSpin(cur.kerr);
  setIdle(view.idleT > 6);

  renderFrame({ cam, look:cur, audio:Audio, rings, time, dt });
  updateHud(t, dt, cam.dist);

  /* adaptive quality — measured here because this is where the clock is,
     decided in render/quality.js, applied in render/scene.js */
  if (fpsAcc > 1.0){
    retune(frames / fpsAcc);
    frames = 0; fpsAcc = 0;
  }
}

/* ---- go ---- */
function onResize(){ resize(); layoutHud(); }
addEventListener('resize', onResize);
onResize();
requestAnimationFrame(frame);
installServiceWorker();
