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
/* Film view starts 3.4 degrees above the disk. Its score choreography can
   change the framing, while inspection presets hold exact angles. The hole
   keeps one spin throughout: changing the music must not morph its geometry. */
const CAM = {
  intro : { d:40, e:0.060,fov:23, spin:0.026, heat:0.0,  jet:0.0, lens:0.9, disk:1.05, ca:0.35, exp:1.0,  kerr:0.6,  flow:0.7 },
  build : { d:31, e:0.070,fov:26, spin:0.042, heat:0.14, jet:0.0, lens:1.0, disk:1.05, ca:0.5,  exp:1.05, kerr:0.6,  flow:1.0 },
  drop  : { d:23, e:0.055,fov:32, spin:0.070, heat:0.34, jet:0.0, lens:1.1, disk:1.12, ca:0.8,  exp:1.06, kerr:0.6, flow:1.8 },
  break : { d:34, e:0.150,fov:24, spin:0.030, heat:0.06, jet:0.0, lens:0.95,disk:1.05, ca:0.4,  exp:1.0,  kerr:0.6, flow:0.8 },
  drop2 : { d:20, e:0.048,fov:36, spin:0.086, heat:0.44, jet:0.0, lens:1.15,disk:1.2,  ca:1.0,  exp:1.09, kerr:0.6,  flow:2.2 },
  bridge: { d:28, e:0.115,fov:29, spin:0.040, heat:0.2,  jet:0.0, lens:1.0, disk:1.1,  ca:0.5,  exp:1.05, kerr:0.6, flow:1.2 },
  final : { d:18, e:0.045,fov:40, spin:0.105, heat:0.6,  jet:0.0, lens:1.25,disk:1.3,  ca:1.2,  exp:1.12, kerr:0.6, flow:2.8 },
  outro : { d:54, e:0.200,fov:20, spin:0.018, heat:0.0,  jet:0.0, lens:0.85,disk:0.98, ca:0.3,  exp:0.95, kerr:0.6, flow:0.5 }
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
  key: 'intro', shot: 'cinematic', manual: false, interacting: false,
  screenX: 0, screenY: 0, framing: 1
};

const tmp = new THREE.Vector3();
const target = new THREE.Vector3();
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
const r2 = new THREE.Vector3(), u2 = new THREE.Vector3();
const SHOTS = {
  close: { d:27, e:0.060, fov:28, spin:0.016 },
  orbit: { d:40, e:0.52, fov:32, spin:0 },
  edge:  { d:37, e:0, fov:29, spin:0 },
  top:   { d:44, e:Math.PI / 2, fov:42, spin:0 },
  under: { d:44, e:-Math.PI / 2, fov:42, spin:0 }
};
const GEOMETRY = new Set(['d', 'e', 'fov', 'spin']);
const wrapAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

/** A deliberate camera cut. Exact cardinal elevations let a user inspect the
 *  disk in its own plane and at either pole without a permanent near miss. */
export function resetCamera(shotName = view.shot){
  if (shotName !== 'cinematic' && !Object.hasOwn(SHOTS, shotName)) shotName = 'cinematic';
  view.shot = shotName; view.manual = false;
  view.azim = 0.6; view.dragX = view.dragY = 0; view.zoom = 1;
  view.shake = view.flash = view.roll = view.pull = view.pullV = 0;
  view.idleT = 0;
  // An explicit shot is a cut into the live composition, not a continuation
  // of the introductory pan. Keep portrait's space above the music deck.
  const wide = !(innerWidth <= 1100 && innerWidth < innerHeight), aspect = innerWidth / Math.max(1, innerHeight);
  view.screenX = 0; view.screenY = wide ? 0 : 0.12;
  view.framing = Math.max(1, (!wide || shotName === 'cinematic' ? 1.30 : 1.12) / aspect);
  const shot = SHOTS[shotName] || CAM.intro;
  for (const f of GEOMETRY) cur[f] = shot[f];
  cur.kerr = 0.6;
}

/** Unrestricted spherical orbit. Elevation is periodic rather than clamped,
 *  so dragging can pass continuously through either pole and hemisphere. */
export function orbitCamera(deltaAz, deltaElevation){
  if (!Number.isFinite(deltaAz) || !Number.isFinite(deltaElevation)) return;
  if (deltaAz === 0 && deltaElevation === 0) return;
  view.manual = true;
  view.dragX = wrapAngle(view.dragX + deltaAz);
  view.dragY = wrapAngle(view.dragY + deltaElevation);
  view.idleT = 0;
}
let fileKey = 'break', fileHold = 0;

/** Which section preset applies at time `t`. In file mode there are no
 *  sections, so loudness picks the framing instead. */
export function currentPreset(t, audio){
  if (audio.mode === 'file'){
    const e = audio.level;
    const key = e > 0.52 ? 'final' : e > 0.38 ? 'drop2' : e > 0.26 ? 'drop' : e > 0.15 ? 'bridge' : 'break';
    // A music phrase needs a shot that can settle. Instant threshold changes
    // otherwise make a quiet boundary oscillate between two framings.
    if (key !== fileKey && t >= fileHold){ fileKey = key; fileHold = t + 4; }
    if (t < fileHold - 4) fileHold = t;
    return { key:fileKey, p:CAM[fileKey] };
  }
  const bar = Math.floor(t / BAR);
  const sec = audio.sectionOfBar(Math.min(bar, TOTAL_BARS - 1));
  return { key:sec.t, p:CAM[sec.t], sec };
}

/** Ease toward `p`, integrate the transients, and return the shot. */
export function updateCamera(dt, p, audio, time, experience = {}, boot = false){
  const shotName = Object.hasOwn(SHOTS, experience.shot) ? experience.shot : 'cinematic';
  if (shotName !== view.shot) resetCamera(shotName);
  const shot = SHOTS[shotName];
  const cinematic = shotName === 'cinematic' || shotName === 'close';
  const inspect = view.manual || !cinematic;
  const base = REDUCED && experience.response !== 0 ? p : CAM.intro;
  // ease the whole cinematic state toward the section preset
  const k = 1 - Math.pow(0.06, dt);
  for (const f of FIELDS){
    if (view.manual && GEOMETRY.has(f)) continue;
    cur[f] += ((shot && f in shot ? shot[f] : base[f]) - cur[f]) * k;
  }
  const aspect = innerWidth / Math.max(1, innerHeight);
  const wide = !(innerWidth <= 1100 && innerWidth < innerHeight);
  const compositionEase = REDUCED ? k : 1;
  view.screenX += ((boot && wide ? 0.35 : 0) - view.screenX) * compositionEase;
  const shortLayout = innerHeight <= 560 && aspect > 1;
  // These are the music-deck and toolbar layout budgets, kept in pixels so
  // tablet and medium desktop windows preserve a usable viewing stage.
  const playerReserve = shortLayout ? 120 : innerWidth <= 1100 ? 230 : 190;
  const stageTop = shortLayout ? 64 : 90;
  const filmY = Math.max(0, (playerReserve - stageTop) / innerHeight);
  const screenY = experience.cinema ? 0 : boot ? (!wide ? 0.50 : 0)
    : shotName === 'cinematic' ? filmY : !wide || shortLayout ? 0.12 : 0;
  view.screenY += (screenY - view.screenY) * compositionEase;
  // Keep the complete silhouette in a portrait viewport, and leave room for
  // the introductory copy beside it on wide screens.
  // Film view keeps both lensed disk tips within narrow desktop screens;
  // close passage retains its deliberate approach framing.
  const fit = Math.max(1, (!wide || shotName === 'cinematic' ? 1.30 : 1.12) / aspect) * (boot && wide ? Math.max(1.27, 1.8 / aspect) : 1);
  view.framing += (fit - view.framing) * compositionEase;

  // Camera fall as a damped spring. The old exponential decay slid back to
  // rest and felt weightless; this overshoots slightly and settles, which
  // reads as being tugged by something with mass.
  view.pullV += (-view.pull * 34 - view.pullV * 7.5) * dt;
  view.pull  += view.pullV * dt;

  // decay transients
  view.shake *= Math.pow(0.02, dt); view.flash *= Math.pow(0.008, dt);
  view.roll  += (0 - view.roll) * (1 - Math.pow(0.25, dt));
  view.idleT += dt;

  // Separate clocks for orbital phase and accretion inflow, both integrated
  // so a change of rate never snaps a particle to a new position.
  view.orbT  += dt * (0.7 + audio.mid * 0.7 + audio.level * 0.35 + Math.max(0, view.pull) * 1.2) * REDUCED;
  view.flowT += dt * cur.flow * (1 + Math.max(0, view.pull) * 14) * REDUCED;
  // A drag holds the chosen elevation, distance and FOV, not the life of the
  // cinematic sky. Pause its orbit while a pointer is down, then continue from
  // the released angle. Inspection presets and reduced motion stay stationary.
  view.azim += (cinematic && !view.interacting ? cur.spin + audio.level * 0.025 : 0) * dt * REDUCED;

  const cameraMotion = inspect ? 0 : REDUCED;
  const breath = (Math.sin(time * 0.14) * 0.018 + Math.sin(time * 0.07) * 0.012) * cameraMotion;
  const fov = cur.fov * (1 + audio.bass * 0.018 * cameraMotion);
  const requestedDistance = cur.d * view.zoom * view.framing * (1 + breath)
    * (1 - (audio.bass * 0.018 + view.pull * 0.25) * cameraMotion);
  // Fit the final ray cone, after score distance/FOV, breathing and audio
  // pull. A constant aspect multiplier only fitted the introductory shot.
  // Eleven r_s includes the ~10.6 r_s lensed silhouette plus edge space.
  // Multiplying the floor by zoom preserves a deliberate manual approach.
  const fittedDistance = !boot && shotName === 'cinematic' && aspect < 1.30
    ? 11 * view.zoom / (Math.tan(fov * 0.5 * Math.PI / 180) * aspect) : 0;
  const elev = cur.e + view.dragY;
  // Fit the available distance above AND below the current screen origin.
  // Film moves up within this stage; cardinal cuts keep their exact centered
  // target on desktop and gain room by pulling back. Explicit zoom scales the
  // fit, while Close passage and cinema retain their intentional full framing.
  const stageFraction = Math.max(0.20, Math.min(
    1 - view.screenY - 2 * stageTop / innerHeight,
    1 + view.screenY - 2 * playerReserve / innerHeight));
  const stageDistance = !boot && !experience.cinema && shotName !== 'close'
    ? (5.7 + 5.1 * Math.abs(Math.sin(elev))) * view.zoom
      / (Math.tan(fov * 0.5 * Math.PI / 180) * stageFraction) : 0;
  const dist = Math.max(12.0, requestedDistance, fittedDistance, stageDistance);
  const az = view.azim + view.dragX;

  const sx = (Math.sin(time * 41.3) + Math.sin(time * 27.7)) * 0.5;
  const sy = (Math.sin(time * 35.1) + Math.sin(time * 19.3)) * 0.5;
  const sAmt = (view.shake * 0.045 + audio.bass * 0.005) * cameraMotion;

  const cp = tmp.set(
    Math.cos(elev) * Math.cos(az) * dist,
    Math.sin(elev) * dist,
    Math.cos(elev) * Math.sin(az) * dist
  );
  const halfHeight = dist * Math.tan(fov * 0.5 * Math.PI / 180);
  // The analytic spherical tangents stay defined at both poles. A fixed
  // world-up cross product collapses at ±90° and flips on crossing them.
  right.set(Math.sin(az), 0, -Math.cos(az));
  up.set(-Math.sin(elev) * Math.cos(az), Math.cos(elev), -Math.sin(elev) * Math.sin(az));
  target.copy(right).multiplyScalar(sx * sAmt - view.screenX * halfHeight * aspect)
    .addScaledVector(up, sy * sAmt - view.screenY * halfHeight);
  fwd.subVectors(target, cp).normalize();
  // Re-orthogonalize against the final, possibly off-center viewing ray.
  // This preserves the continuous tangent frame even with portrait framing.
  right.addScaledVector(fwd, -right.dot(fwd)).normalize();
  up.crossVectors(right, fwd).normalize();
  const rollAmt = (view.roll + Math.sin(time * 0.07) * 0.008 + view.shake * 0.005) * cameraMotion;
  const cr = Math.cos(rollAmt), sr = Math.sin(rollAmt);
  r2.copy(right).multiplyScalar(cr).addScaledVector(up, sr);
  u2.copy(up).multiplyScalar(cr).addScaledVector(right, -sr);

  return {
    pos: cp, fwd, right: r2, up: u2, target,
    fov, tanFov: Math.tan(fov * 0.5 * Math.PI / 180), dist, elevation:elev, azimuth:az,
    orbT: view.orbT, flowT: view.flowT,
    pull: view.pull, flash: view.flash, shake: view.shake
  };
}
