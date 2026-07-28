/* Audio events in, camera transients out.
   The engine pushes {t, kind, v} and knows nothing about the picture; this is
   the only place that decides a kick means a shockwave and an impact means
   the camera gets pulled. */
import { SECTIONS } from '../audio/arrangement.js';
import { view } from './camera.js';
import { announce } from './hud.js';

export const rings = [];

function shockwave(strength){
  rings.push({ t:0, a:strength, w:0.016 + strength * 0.02 });
  if (rings.length > 5) rings.shift();
}

export function onEvent(ev){
  if (ev.kind === 'kick'){ shockwave(0.55 * ev.v); view.shake = Math.max(view.shake, 0.5 * ev.v); view.flash = Math.max(view.flash, 0.05 * ev.v); view.pull = Math.max(view.pull, 0.09 * ev.v); }
  else if (ev.kind === 'snare'){ view.flash = Math.max(view.flash, 0.09 * ev.v); view.shake = Math.max(view.shake, 0.3 * ev.v); view.roll += (Math.random() - 0.5) * 0.015 * ev.v; }
  else if (ev.kind === 'impact'){ shockwave(1.0 * ev.v); view.flash = Math.max(view.flash, 0.3 * ev.v); view.shake = Math.max(view.shake, 1.0 * ev.v); view.pull = Math.max(view.pull, 0.34 * ev.v); }
  else if (ev.kind === 'section'){ announce(SECTIONS[ev.v]); }
}

/* A dropped track has no scheduled events, so the onset detector stands in
   for the kick. Same transients, weaker, because a detected onset is a guess
   and a scheduled hit is not. */
export function onBeat(beat){
  shockwave(0.5 * beat);
  view.shake = Math.max(view.shake, 0.6 * beat);
  view.flash = Math.max(view.flash, 0.09 * beat);
  view.pull  = Math.max(view.pull, 0.14 * beat);
}
