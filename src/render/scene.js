/* The compositor.
   Owns every render target, every material, and the order the passes run in.
   Nothing outside this module calls renderer.render — `pass()` is the only
   route to the GPU, and renderFrame() is the only route to `pass()`.

   The pass chain used to live in the frame loop up in direct/, which meant the
   camera layer was reaching in to drive `matBlur` thirty times a frame. It is
   here now, and this module exports four names instead of the nineteen that
   arrangement required. */
import { THREE } from '../three.js';
import { REDUCED } from '../motion.js';
import { renderer, HDR } from './gl.js';
import { Q, tuneQuality } from './quality.js';
import { pScene, pCam, uP } from './particles.js';
import QUAD_VS from './shaders/quad.vert';
import BH_FS from './shaders/bh.frag';
import BRIGHT_FS from './shaders/bright.frag';
import BLUR_FS from './shaders/blur.frag';
import FINAL_FS from './shaders/final.frag';
import RESOLVE_FS from './shaders/resolve.frag';

// One oversized triangle avoids duplicate fragment-helper work along the
// diagonal of a two-triangle quad, especially in the expensive ray pass.
const quadGeo = new THREE.BufferGeometry();
quadGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1,-1,0, 3,-1,0, -1,3,0]), 3));
quadGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0,0, 2,0, 0,2]), 2));
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quadScene = new THREE.Scene();
const quadMesh = new THREE.Mesh(quadGeo, new THREE.MeshBasicMaterial());
quadScene.add(quadMesh);

export const uBH = {
  uRes:{value:new THREE.Vector2(1,1)}, uTime:{value:0}, uAspect:{value:1},
  uTanFov:{value:0.5}, uSteps:{value:170},
  uCamPos:{value:new THREE.Vector3()}, uCamRight:{value:new THREE.Vector3()},
  uCamUp:{value:new THREE.Vector3()}, uCamFwd:{value:new THREE.Vector3()},
  uParticles:{value:null},
  uBass:{value:0}, uMid:{value:0}, uHigh:{value:0},
  uPulse:{value:0}, uEnergy:{value:0}, uChroma:{value:new THREE.Vector3(1.0,0.48,0.40)},
  uHeat:{value:0}, uJet:{value:0}, uLens:{value:1}, uDiskGain:{value:1},
  uSpin:{value:0.6}, uRh:{value:1}, uDin:{value:4.63}, uDout:{value:9.35},
  // DNEG's film treatment omits frequency and associated brightness shifts.
  uDoppler:{value:0.0}, uThick:{value:0.22}, uFringe:{value:1.0},
  uBhUv:{value:new THREE.Vector2(0.5,0.5)},
  uRings:{value:[0,1,2,3,4].map(()=>new THREE.Vector4(0,0,0.02,0))}
};

const uFin = {
  uScene:{value:null}, uBloom:{value:null}, uBloomWide:{value:null}, uFlare:{value:null},
  uBhUv:{value:new THREE.Vector2(0.5,0.5)}, uAspect:{value:1},
  uCA:{value:1}, uExposure:{value:1.05},
  uStreak:{value:0},
  uFlash:{value:0}, uBloomAmt:{value:0.85}, uFlareAmt:{value:0.55}
};
const uResolve = {
  tDiffuse:{value:null}, uTexel:{value:new THREE.Vector2(1,1)},
  uRes:{value:new THREE.Vector2(1,1)}, uTime:{value:0}, uGrain:{value:0.003}
};

const matBH     = new THREE.ShaderMaterial({ vertexShader:QUAD_VS, fragmentShader:BH_FS, uniforms:uBH, depthTest:false, depthWrite:false });
const matBright = new THREE.ShaderMaterial({ vertexShader:QUAD_VS, fragmentShader:BRIGHT_FS,
  // low enough that the whole disk body feeds the flare, not just the core —
  // veiling flare is scatter off everything bright, not a highlight effect
  uniforms:{ tDiffuse:{value:null}, uTexel:{value:new THREE.Vector2(1,1)}, uThresh:{value:0.55} }, depthTest:false, depthWrite:false });
const matBlur   = new THREE.ShaderMaterial({ vertexShader:QUAD_VS, fragmentShader:BLUR_FS,
  uniforms:{ tDiffuse:{value:null}, uDir:{value:new THREE.Vector2()} }, depthTest:false, depthWrite:false });
const matFinal  = new THREE.ShaderMaterial({ vertexShader:QUAD_VS, fragmentShader:FINAL_FS, uniforms:uFin, depthTest:false, depthWrite:false });
const matResolve = new THREE.ShaderMaterial({ vertexShader:QUAD_VS, fragmentShader:RESOLVE_FS, uniforms:uResolve, depthTest:false, depthWrite:false, toneMapped:false });

function pass(mat, target){
  quadMesh.material = mat;
  renderer.setRenderTarget(target || null);
  renderer.clear(true, false, false);
  renderer.render(quadScene, quadCam);
}

/* ---- render targets ---- */
let rtP, rtScene, rtA, rtB, rtC, rtD, rtMidA, rtMidB, rtDisplay;
let bufW = 1, bufH = 1;
const projectedOrigin = new THREE.Vector3();
const PALETTES = {
  gargantua: new THREE.Vector3(1.0, 0.48, 0.40),
  ember: new THREE.Vector3(1.0, 0.33, 0.095),
  polar: new THREE.Vector3(0.28, 0.64, 1.0)
};

function makeRT(w, h, type = HDR){
  return new THREE.WebGLRenderTarget(Math.max(2, w | 0), Math.max(2, h | 0), {
    minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter,
    format:THREE.RGBAFormat, type, depthBuffer:false, stencilBuffer:false
  });
}

function allocRT(){
  const w = Math.floor(bufW * Q.scale), h = Math.floor(bufH * Q.scale);
  [rtP, rtScene, rtA, rtB, rtC, rtD, rtMidA, rtMidB, rtDisplay].forEach(r => r && r.dispose());
  rtP = makeRT(w, h); rtScene = makeRT(w, h);
  rtA = makeRT(w / 2, h / 2); rtB = makeRT(w / 2, h / 2);
  rtMidA = makeRT(w / 4, h / 4); rtMidB = makeRT(w / 4, h / 4);
  // Display-encoded pixels need no HDR storage. Antialias this target using
  // its own texel size, then reconstruct at the canvas's full resolution.
  rtDisplay = makeRT(w, h, THREE.UnsignedByteType);
  // eighth res for the veiling flare: it needs a reach of a couple of hundred
  // pixels, which is free down here and ruinous at half res
  rtC = makeRT(w / 8, h / 8); rtD = makeRT(w / 8, h / 8);
  uBH.uRes.value.set(w, h);
  uBH.uAspect.value = w / h;
  uFin.uAspect.value = w / h;
  matBright.uniforms.uTexel.value.set(1 / rtScene.width, 1 / rtScene.height);
  uResolve.uTexel.value.set(1 / rtDisplay.width, 1 / rtDisplay.height);
}

/* Sizing the drawing buffers only. The HUD lays itself out on the same event
   — see direct/hud.js — rather than being called from here, which is what the
   old `typeof fitMapLabels === 'function'` guard was working around. */
export function resize(){
  const w = innerWidth, h = innerHeight;
  Q.dpr = Math.min(devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(Q.dpr);
  renderer.setSize(w, h, false);
  bufW = Math.floor(w * Q.dpr); bufH = Math.floor(h * Q.dpr);
  allocRT();
  pCam.aspect = w / h; pCam.updateProjectionMatrix();
  uResolve.uRes.value.set(bufW, bufH);
}

/* Measured fps in, reallocation out. The thresholds are quality.js's business;
   the render targets are this module's. */
export function retune(fps){
  if (tuneQuality(fps)) allocRT();
}

/* ---------------------------------------------------------------------------
   One frame.

   `cam` is the shot this instant — position, basis, field of view, plus the
   transients the camera layer is carrying (fall, shake, flash) and the two
   accumulated clocks the particle field integrates against. `look` is the
   eased section preset. Neither is interpreted here beyond being written to
   uniforms: the decisions about *why* the camera is where it is belong to
   direct/camera.js, and the decisions about how it is drawn belong here. */
export function renderFrame({ cam, look, audio, rings, time, dt, experience = {} }){
  const features = audio.features || {};
  uBH.uCamPos.value.copy(cam.pos);
  uBH.uCamFwd.value.copy(cam.fwd);
  uBH.uCamRight.value.copy(cam.right);
  uBH.uCamUp.value.copy(cam.up);
  uBH.uTanFov.value = cam.tanFov;
  uBH.uTime.value = cam.orbT;
  uBH.uBass.value = audio.bass; uBH.uMid.value = audio.mid; uBH.uHigh.value = audio.high;
  uBH.uPulse.value = (features.beatEnv || 0) * REDUCED;
  uBH.uEnergy.value = features.energy || audio.level;
  uBH.uChroma.value.lerp(PALETTES[experience.palette] || PALETTES.gargantua, 1 - Math.exp(-dt * 2.8));
  uBH.uHeat.value = look.heat * (0.45 + audio.level * 1.1);
  uBH.uJet.value = look.jet * (0.35 + audio.bass * 1.5);
  uBH.uLens.value = look.lens;
  uBH.uDiskGain.value = look.disk;
  uBH.uSteps.value = Q.steps;

  pCam.position.copy(cam.pos);
  pCam.up.copy(cam.up);
  pCam.lookAt(cam.target);
  pCam.fov = cam.fov;
  pCam.updateProjectionMatrix();

  // black hole screen position (the composition anchor)
  const proj = projectedOrigin.set(0, 0, 0).project(pCam);
  uBH.uBhUv.value.set(proj.x * 0.5 + 0.5, proj.y * 0.5 + 0.5);
  uFin.uBhUv.value.copy(uBH.uBhUv.value);

  // Age before packing. Splicing in the uniform loop skips the ring after it.
  for (let i = rings.length - 1; i >= 0; i--){
    rings[i].t += dt;
    if (rings[i].t > 2.2) rings.splice(i, 1);
  }
  for (let i = 0; i < 5; i++){
    const r = rings[i];
    const v = uBH.uRings.value[i];
    if (r){
      v.set(r.t * 0.62, r.a * Math.exp(-r.t * 2.6), r.w + r.t * 0.05, 0);
    } else v.set(0, 0, 0.02, 0);
  }

  uP.uTime.value = time;
  uP.uOrbT.value = cam.orbT; uP.uFlowT.value = cam.flowT;
  uP.uBass.value = audio.bass; uP.uMid.value = audio.mid; uP.uHigh.value = audio.high;
  uP.uPull.value = Math.max(0, cam.pull);
  uP.uEcc.value = 0.14 + Math.min(0.26, Math.max(0, cam.pull) * 0.7) + audio.level * 0.06;
  uP.uEye.value.copy(cam.pos);
  uP.uSizeScale.value = Q.scale * Q.dpr * (0.85 + audio.level * 0.5);
  uP.uChroma.value.copy(uBH.uChroma.value);

  uResolve.uTime.value = time;
  uFin.uCA.value = look.ca * (0.10 + audio.level * 0.22) * REDUCED;
  uFin.uExposure.value = look.exp;
  uFin.uFlash.value = cam.flash * REDUCED;
  uFin.uBloomAmt.value = 0.26 + audio.level * 0.19;
  uFin.uStreak.value = 0.12 + audio.high * 0.2;
  // Artist-tuned veiling flare inspired by Figure 16, without DNEG's measured
  // lens point-spread data. Preserve enough contrast to inspect the material.
  uFin.uFlareAmt.value = 0.12 + audio.level * 0.09;

  /* --- passes --- */
  renderer.setRenderTarget(rtP);
  renderer.clear(true, true, true);
  renderer.render(pScene, pCam);

  uBH.uParticles.value = rtP.texture;
  pass(matBH, rtScene);

  matBright.uniforms.tDiffuse.value = rtScene.texture;
  pass(matBright, rtA);
  const bw = 1 / rtA.width, bh = 1 / rtA.height;
  matBlur.uniforms.tDiffuse.value = rtA.texture; matBlur.uniforms.uDir.value.set(bw, 0); pass(matBlur, rtB);
  matBlur.uniforms.tDiffuse.value = rtB.texture; matBlur.uniforms.uDir.value.set(0, bh); pass(matBlur, rtA);
  // Retain tight bloom and build a separate middle scale instead of repeatedly
  // smearing the same highlights. Filaments retain their own local contrast.
  const mw = 1 / rtMidA.width, mh = 1 / rtMidA.height;
  matBlur.uniforms.tDiffuse.value = rtA.texture; matBlur.uniforms.uDir.value.set(mw, 0); pass(matBlur, rtMidB);
  matBlur.uniforms.tDiffuse.value = rtMidB.texture; matBlur.uniforms.uDir.value.set(0, mh); pass(matBlur, rtMidA);

  /* Downsample progressively to avoid a single 4× jump into the broad flare.
     The final pair spreads actual emitted light across the large lens halo. */
  const fw = 1 / rtC.width, fh = 1 / rtC.height;
  matBlur.uniforms.tDiffuse.value = rtMidA.texture; matBlur.uniforms.uDir.value.set(fw, 0); pass(matBlur, rtD);
  matBlur.uniforms.tDiffuse.value = rtD.texture; matBlur.uniforms.uDir.value.set(0, fh); pass(matBlur, rtC);
  matBlur.uniforms.tDiffuse.value = rtC.texture; matBlur.uniforms.uDir.value.set(fw * 3.4, 0); pass(matBlur, rtD);
  matBlur.uniforms.tDiffuse.value = rtD.texture; matBlur.uniforms.uDir.value.set(0, fh * 3.4); pass(matBlur, rtC);
  matBlur.uniforms.tDiffuse.value = rtC.texture; matBlur.uniforms.uDir.value.set(fw * 9.0, 0); pass(matBlur, rtD);
  matBlur.uniforms.tDiffuse.value = rtD.texture; matBlur.uniforms.uDir.value.set(0, fh * 9.0); pass(matBlur, rtC);

  uFin.uScene.value = rtScene.texture;
  uFin.uBloom.value = rtA.texture;
  uFin.uBloomWide.value = rtMidA.texture;
  uFin.uFlare.value = rtC.texture;
  pass(matFinal, rtDisplay);
  uResolve.tDiffuse.value = rtDisplay.texture;
  pass(matResolve, null);
}
