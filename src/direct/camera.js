/* Camera choreography.
   Presets per section type, the mutable state the shot is carrying, and the
   per-frame integration that turns the two into a position and a basis.

   This module decides *where the camera is and why*. It knows nothing about
   how the result gets drawn — updateCamera() returns a plain description of
   the shot and render/scene.js does the rest. */
import { THREE } from '../three.js';
import { REDUCED } from '../motion.js';
import { BAR, TOTAL_BARS } from '../audio/arrangement.js';

/* `spin` is the camera's orbit rate; `kerr` is the hole's own spin, which
   drives frame dragging, the horizon size and the disk's inner edge. */
/* Framings stay near the disk plane, where Gargantua reads best: the
   over-and-under lensed arcs close into a halo around the shadow. Jets are
   off throughout — the film's black hole has none.

   `disk` no longer dips far below 1. With the disk on one fixed chroma, the
   walk to white is done entirely by the tone curve, so a section that dims the
   disk does not just darken it — it drops the whole annulus into the part of
   the curve where the base colour shows, and Gargantua turns into a flat
   salmon ring with no white core at all. The quiet sections carry their weight
   through framing and motion instead.

   DNEG shot Gargantua from theta_c = 86.56 deg, i.e. 3.4 deg — 0.060 rad —
   above the disk plane, at r_c = 74.1M (37 r_s). That grazing angle is what
   folds the disk into the halo; lift the camera much past ten degrees and the
   arcs peel apart into an ordinary ringed planet. These elevations used to run
   out to 0.42 rad, four times the film's, so the signature closed silhouette
   only ever appeared in the two closest sections. They now sit around the
   film's angle and keep their relative spread.

   The fields of view came in too, by about a third. Gargantua is shot long —
   its shadow spans a good eighth of the frame width in the film's own plates,
   where these framings had it at a sixteenth, and at that scale the halo, the
   photon ring and the ragged rim all shrink below the size at which anyone can
   read them. */
const CAM = {
  intro : { d:40, e:0.085,fov:23, spin:0.026, heat:0.0,  jet:0.0, lens:0.9, disk:1.05, ca:0.35, exp:1.0,  kerr:0.5,  flow:0.7 },
  build : { d:31, e:0.070,fov:26, spin:0.042, heat:0.14, jet:0.0, lens:1.0, disk:1.05, ca:0.5,  exp:1.05, kerr:0.6,  flow:1.0 },
  drop  : { d:23, e:0.055,fov:32, spin:0.070, heat:0.34, jet:0.0, lens:1.1, disk:1.12, ca:0.8,  exp:1.06, kerr:0.72, flow:1.8 },
  break : { d:34, e:0.150,fov:24, spin:0.030, heat:0.06, jet:0.0, lens:0.95,disk:1.05, ca:0.4,  exp:1.0,  kerr:0.52, flow:0.8 },
  drop2 : { d:20, e:0.048,fov:36, spin:0.086, heat:0.44, jet:0.0, lens:1.15,disk:1.2,  ca:1.0,  exp:1.09, kerr:0.8,  flow:2.2 },
  bridge: { d:28, e:0.115,fov:29, spin:0.040, heat:0.2,  jet:0.0, lens:1.0, disk:1.1,  ca:0.5,  exp:1.05, kerr:0.62, flow:1.2 },
  final : { d:18, e:0.045,fov:40, spin:0.105, heat:0.6,  jet:0.0, lens:1.25,disk:1.3,  ca:1.2,  exp:1.12, kerr:0.88, flow:2.8 },
  outro : { d:54, e:0.200,fov:20, spin:0.018, heat:0.0,  jet:0.0, lens:0.85,disk:0.98, ca:0.3,  exp:0.95, kerr:0.45, flow:0.5 }
};

const FIELDS = ['d','e','fov','spin','heat','jet','lens','disk','ca','exp','kerr','flow'];

/** The eased preset — what the camera is actually looking like right now, as
 *  opposed to the section preset it is heading toward. */
export const cur = Object.assign({}, CAM.intro);

/* Everything the shot is carrying between frames.
   These were a dozen loose `let`s in one shared scope; naming the bag is what
   lets input.js and events.js write to them across a module boundary, and
   makes the set of things that persist frame to frame something you can read
   in one place. */
export const view = {
  azim: 0.6, zoom: 1, dragX: 0, dragY: 0,
  shake: 0, flash: 0, roll: 0,
  pull: 0, pullV: 0,        // camera fall: a damped spring, not a decay
  orbT: 0, flowT: 0,        // accumulated orbit / accretion clocks
  idleT: 0,
  key: 'intro'
};

const tmp = new THREE.Vector3();
const target = new THREE.Vector3();

/** Which section preset applies at time `t`. In file mode there are no
 *  sections, so loudness picks the framing instead. */
export function currentPreset(t, audio){
  if (audio.mode === 'file'){
    const e = audio.level;
    const key = e > 0.52 ? 'final' : e > 0.38 ? 'drop2' : e > 0.26 ? 'drop' : e > 0.15 ? 'bridge' : 'break';
    return { key, p:CAM[key] };
  }
  const bar = Math.floor(t / BAR);
  const sec = audio.sectionOfBar(Math.min(bar, TOTAL_BARS - 1));
  return { key:sec.t, p:CAM[sec.t], sec };
}

/** Ease toward `p`, integrate the transients, and return the shot. */
export function updateCamera(dt, p, audio, time){
  // ease the whole cinematic state toward the section preset
  const k = 1 - Math.pow(0.06, dt);
  for (const f of FIELDS) cur[f] += (p[f] - cur[f]) * k;

  // Camera fall as a damped spring. The old exponential decay slid back to
  // rest and felt weightless; this overshoots slightly and settles, which
  // reads as being tugged by something with mass.
  view.pullV += (-view.pull * 34 - view.pullV * 7.5) * dt;
  view.pull  += view.pullV * dt;

  // decay transients
  view.shake *= Math.pow(0.02, dt); view.flash *= Math.pow(0.008, dt);
  view.roll  += (0 - view.roll) * (1 - Math.pow(0.25, dt));
  view.dragX *= Math.pow(0.9, dt); view.dragY *= Math.pow(0.94, dt);
  view.idleT += dt;

  // Separate clocks for orbital phase and accretion inflow, both integrated
  // so a change of rate never snaps a particle to a new position.
  view.orbT  += dt * (1 + audio.level * 0.35 + Math.max(0, view.pull) * 1.2);
  view.flowT += dt * cur.flow * (1 + Math.max(0, view.pull) * 14);
  view.azim  += (cur.spin + audio.level * 0.05) * dt;

  const breath = Math.sin(time * 0.21) * 0.045 + Math.sin(time * 0.09) * 0.03;
  const dist = Math.max(4.2, cur.d * view.zoom * (1 + breath) * (1 - audio.bass * 0.035 - view.pull * 0.5));
  const elev = cur.e + view.dragY + Math.sin(time * 0.13) * 0.035;
  const az = view.azim + view.dragX;

  const sx = (Math.sin(time * 41.3) + Math.sin(time * 27.7)) * 0.5;
  const sy = (Math.sin(time * 35.1) + Math.sin(time * 19.3)) * 0.5;
  const sAmt = (view.shake * 0.11 + audio.bass * 0.012) * REDUCED;

  const cp = tmp.set(
    Math.cos(elev) * Math.cos(az) * dist,
    Math.sin(elev) * dist,
    Math.cos(elev) * Math.sin(az) * dist
  );
  target.set(sx * sAmt * 1.6, 0.55 + Math.sin(time * 0.17) * 0.35 + sy * sAmt * 1.6, 0);

  const fwd = new THREE.Vector3().subVectors(target, cp).normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(fwd, worldUp).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  const rollAmt = view.roll + Math.sin(time * 0.07) * 0.02 + view.shake * 0.012;
  const cr = Math.cos(rollAmt), sr = Math.sin(rollAmt);
  const r2 = right.clone().multiplyScalar(cr).addScaledVector(up, sr);
  const u2 = up.clone().multiplyScalar(cr).addScaledVector(right, -sr);

  const fov = cur.fov * (1 + audio.bass * 0.045 + view.shake * 0.03);

  return {
    pos: cp, fwd, right: r2, up: u2, target,
    fov, tanFov: Math.tan(fov * 0.5 * Math.PI / 180), dist,
    orbT: view.orbT, flowT: view.flowT,
    pull: view.pull, flash: view.flash, shake: view.shake
  };
}
