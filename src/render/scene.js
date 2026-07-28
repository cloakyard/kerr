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

const quadGeo = new THREE.PlaneGeometry(2, 2);
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
  uHeat:{value:0}, uJet:{value:0}, uLens:{value:1}, uDiskGain:{value:1},
  uSpin:{value:0.6}, uRh:{value:1}, uDin:{value:4.63}, uDout:{value:9.35},
  /* The film's disk carries no frequency shifts at all. This keeps a whisper
     — pow(shift, 0.15) spans about +/-6% across the disk, far below the point
     where an eye reads it as a lopsided image, but enough that the near edge
     is not perfectly flat. */
  uDoppler:{value:0.05}, uThick:{value:0.22}, uFringe:{value:1.0},
  uBhUv:{value:new THREE.Vector2(0.5,0.5)},
  uRings:{value:[0,1,2,3,4].map(()=>new THREE.Vector4(0,0,0.02,0))}
};

const uFin = {
  uScene:{value:null}, uBloom:{value:null}, uFlare:{value:null}, uRes:{value:new THREE.Vector2(1,1)},
  uBhUv:{value:new THREE.Vector2(0.5,0.5)}, uAspect:{value:1},
  uCA:{value:1}, uExposure:{value:1.05}, uTime:{value:0}, uGrain:{value:0.008},
  uFlash:{value:0}, uBloomAmt:{value:0.85}, uFlareAmt:{value:0.55}
};

const matBH     = new THREE.ShaderMaterial({ vertexShader:QUAD_VS, fragmentShader:BH_FS, uniforms:uBH, depthTest:false, depthWrite:false });
const matBright = new THREE.ShaderMaterial({ vertexShader:QUAD_VS, fragmentShader:BRIGHT_FS,
  // low enough that the whole disk body feeds the flare, not just the core —
  // veiling flare is scatter off everything bright, not a highlight effect
  uniforms:{ tDiffuse:{value:null}, uThresh:{value:0.55} }, depthTest:false, depthWrite:false });
const matBlur   = new THREE.ShaderMaterial({ vertexShader:QUAD_VS, fragmentShader:BLUR_FS,
  uniforms:{ tDiffuse:{value:null}, uDir:{value:new THREE.Vector2()} }, depthTest:false, depthWrite:false });
const matFinal  = new THREE.ShaderMaterial({ vertexShader:QUAD_VS, fragmentShader:FINAL_FS, uniforms:uFin, depthTest:false, depthWrite:false });

function pass(mat, target){
  quadMesh.material = mat;
  renderer.setRenderTarget(target || null);
  renderer.clear(true, false, false);
  renderer.render(quadScene, quadCam);
}

/* ---- render targets ---- */
let rtP, rtScene, rtA, rtB, rtC, rtD;
let bufW = 1, bufH = 1;

function makeRT(w, h){
  return new THREE.WebGLRenderTarget(Math.max(2, w | 0), Math.max(2, h | 0), {
    minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter,
    format:THREE.RGBAFormat, type:HDR, depthBuffer:false, stencilBuffer:false
  });
}

function allocRT(){
  const w = Math.floor(bufW * Q.scale), h = Math.floor(bufH * Q.scale);
  [rtP, rtScene, rtA, rtB, rtC, rtD].forEach(r => r && r.dispose());
  rtP = makeRT(w, h); rtScene = makeRT(w, h);
  rtA = makeRT(w / 2, h / 2); rtB = makeRT(w / 2, h / 2);
  // eighth res for the veiling flare: it needs a reach of a couple of hundred
  // pixels, which is free down here and ruinous at half res
  rtC = makeRT(w / 8, h / 8); rtD = makeRT(w / 8, h / 8);
  uBH.uRes.value.set(w, h);
  uBH.uAspect.value = w / h;
  uFin.uAspect.value = w / h;
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
  uFin.uRes.value.set(bufW, bufH);
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
export function renderFrame({ cam, look, audio, rings, time, dt }){
  uBH.uCamPos.value.copy(cam.pos);
  uBH.uCamFwd.value.copy(cam.fwd);
  uBH.uCamRight.value.copy(cam.right);
  uBH.uCamUp.value.copy(cam.up);
  uBH.uTanFov.value = cam.tanFov;
  uBH.uTime.value = time;
  uBH.uBass.value = audio.bass; uBH.uMid.value = audio.mid; uBH.uHigh.value = audio.high;
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
  const proj = new THREE.Vector3(0, 0, 0).project(pCam);
  uBH.uBhUv.value.set(proj.x * 0.5 + 0.5, proj.y * 0.5 + 0.5);
  uFin.uBhUv.value.copy(uBH.uBhUv.value);

  for (let i = 0; i < 5; i++){
    const r = rings[i];
    const v = uBH.uRings.value[i];
    if (r){
      r.t += dt;
      v.set(r.t * 0.62, r.a * Math.exp(-r.t * 2.6), r.w + r.t * 0.05, 0);
      if (r.t > 2.2) rings.splice(i, 1);
    } else v.set(0, 0, 0.02, 0);
  }

  uP.uTime.value = time;
  uP.uOrbT.value = cam.orbT; uP.uFlowT.value = cam.flowT;
  uP.uBass.value = audio.bass; uP.uMid.value = audio.mid; uP.uHigh.value = audio.high;
  uP.uPull.value = Math.max(0, cam.pull);
  uP.uEcc.value = 0.14 + Math.min(0.26, Math.max(0, cam.pull) * 0.7) + audio.level * 0.06;
  uP.uEye.value.copy(cam.pos);
  uP.uSizeScale.value = Q.scale * Q.dpr * (0.85 + audio.level * 0.5);

  uFin.uTime.value = time;
  uFin.uCA.value = look.ca * (0.22 + audio.level * 0.6) * REDUCED;
  uFin.uExposure.value = look.exp;
  uFin.uFlash.value = cam.flash * REDUCED;
  uFin.uBloomAmt.value = 0.36 + audio.level * 0.28;
  /* Restrained on purpose. A veiling flare genuinely does wash light across
     the shadow — DNEG's own flared plate (their Figure 16) fills it to a pale
     grey — but the film itself sits far nearer the unflared render, shadow
     reading black with the glow felt around the disk rather than inside the
     hole. Pushed past about a quarter this lifts the silhouette to a muddy
     brown and the whole image loses its floor. */
  uFin.uFlareAmt.value = 0.16 + audio.level * 0.18;

  /* --- passes --- */
  renderer.setRenderTarget(rtP);
  renderer.clear(true, true, true);
  renderer.render(pScene, pCam);

  uBH.uParticles.value = rtP.texture;
  pass(matBH, rtScene);

  matBright.uniforms.tDiffuse.value = rtScene.texture;
  pass(matBright, rtA);
  const bw = 1 / (bufW * Q.scale * 0.5), bh = 1 / (bufH * Q.scale * 0.5);
  matBlur.uniforms.tDiffuse.value = rtA.texture; matBlur.uniforms.uDir.value.set(bw, 0); pass(matBlur, rtB);
  matBlur.uniforms.tDiffuse.value = rtB.texture; matBlur.uniforms.uDir.value.set(0, bh); pass(matBlur, rtA);
  matBlur.uniforms.tDiffuse.value = rtA.texture; matBlur.uniforms.uDir.value.set(bw * 2.6, 0); pass(matBlur, rtB);
  matBlur.uniforms.tDiffuse.value = rtB.texture; matBlur.uniforms.uDir.value.set(0, bh * 2.6); pass(matBlur, rtA);

  /* Veiling flare: drop the same bright pass to an eighth and keep widening.
     Rendering into rtC at a quarter of rtA's linear size is itself the
     downsample, then three separable pairs at rising step reach roughly 200
     source pixels — a genuine soft halo around the disk rather than the tight
     rim the half-res chain gives. */
  const fw = 1 / (bufW * Q.scale * 0.125), fh = 1 / (bufH * Q.scale * 0.125);
  matBlur.uniforms.tDiffuse.value = rtA.texture; matBlur.uniforms.uDir.value.set(fw, 0); pass(matBlur, rtD);
  matBlur.uniforms.tDiffuse.value = rtD.texture; matBlur.uniforms.uDir.value.set(0, fh); pass(matBlur, rtC);
  matBlur.uniforms.tDiffuse.value = rtC.texture; matBlur.uniforms.uDir.value.set(fw * 3.4, 0); pass(matBlur, rtD);
  matBlur.uniforms.tDiffuse.value = rtD.texture; matBlur.uniforms.uDir.value.set(0, fh * 3.4); pass(matBlur, rtC);
  matBlur.uniforms.tDiffuse.value = rtC.texture; matBlur.uniforms.uDir.value.set(fw * 9.0, 0); pass(matBlur, rtD);
  matBlur.uniforms.tDiffuse.value = rtD.texture; matBlur.uniforms.uDir.value.set(0, fh * 9.0); pass(matBlur, rtC);

  uFin.uScene.value = rtScene.texture;
  uFin.uBloom.value = rtA.texture;
  uFin.uFlare.value = rtC.texture;
  pass(matFinal, null);
}
