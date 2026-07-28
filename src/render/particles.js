/* Orbiting particle field.
   Rendered to its own target and sampled by the raymarcher, so the grains
   are lensed along with everything else rather than pasted over the top. */
import { THREE } from '../three.js';
import PARTICLES_VS from './shaders/particles.vert';
import PARTICLES_FS from './shaders/particles.frag';

export const pScene = new THREE.Scene();
export const pCam = new THREE.PerspectiveCamera(45, 1, 0.1, 400);

function buildParticles(count, rMin, rMax, thick, sizeMin, sizeMax, kind){
  const g = new THREE.BufferGeometry();
  const aP = new Float32Array(count * 4);
  const aQ = new Float32Array(count * 3);
  for (let i = 0; i < count; i++){
    const t = Math.pow(Math.random(), 0.62);
    const r = rMin + (rMax - rMin) * t;
    aP[i*4+0] = r;
    aP[i*4+1] = Math.random() * Math.PI * 2;
    aP[i*4+2] = (Math.random() * 2 - 1) * thick * (0.25 + 0.75 * Math.random());
    aP[i*4+3] = 0.72 + Math.random() * 0.62;
    aQ[i*3+0] = sizeMin + Math.random() * (sizeMax - sizeMin);
    aQ[i*3+1] = Math.random();
    aQ[i*3+2] = kind;
  }
  g.setAttribute('aP', new THREE.BufferAttribute(aP, 4));
  g.setAttribute('aQ', new THREE.BufferAttribute(aQ, 3));
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 400);
  return g;
}

export const uP = {
  uTime:{value:0}, uOrbT:{value:0}, uFlowT:{value:0},
  uBass:{value:0}, uMid:{value:0}, uHigh:{value:0},
  uPull:{value:0}, uEcc:{value:0.16}, uIsco:{value:3},
  uEye:{value:new THREE.Vector3()}, uSizeScale:{value:1}, uFade:{value:1}
};

/* Each grain runs a real orbit rather than a spun ring: a precessing
   ellipse on a slow inward spiral, reborn at the outer edge when it
   reaches the ISCO. uOrbT / uFlowT are accumulated on the CPU so tempo
   changes never snap a particle to a new position. */
const matP = new THREE.ShaderMaterial({
  uniforms: uP,
  transparent:true, depthTest:false, depthWrite:false, blending:THREE.AdditiveBlending,
  vertexShader: PARTICLES_VS,
  fragmentShader: PARTICLES_FS
});

/* Thin and sparse on purpose. Gargantua has no dusty halo — these are a
   fine shimmer riding in the disk plane, enough to give the music something
   to move, not a second visual layer competing with the raymarch.

   The radii come from the caller rather than from BH: this module has no
   opinion about where the disk is, and taking one would make it depend on
   render/bh.js, which already depends on the uniforms declared here. */
export function mountField(rMin, rMax){
  pScene.add(new THREE.Points(buildParticles(14000, rMin, rMax, 0.10, 0.7, 1.7, 0.0), matP));
}
