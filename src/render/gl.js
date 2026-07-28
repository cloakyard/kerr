/* The WebGL context and the two decisions that have to be made before any
   material exists: colour management, and whether float targets are available.
   Everything else in render/ assumes these are already settled. */
import { THREE } from '../three.js';

export const canvas = document.getElementById('gl');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias:false, alpha:false, powerPreference:'high-performance' });
renderer.autoClear = false;
renderer.setClearColor(0x000000, 0);

/* Colour management off, output left linear.
   three enabled automatic colour management in r152 and defaults
   outputColorSpace to sRGB. Every shader here is hand-written and already
   ends in an ACES tonemap plus a gamma encode, so letting three convert
   again would apply the transform twice. This reproduces the r128 default
   (LinearEncoding) explicitly rather than by accident. */
if (THREE.ColorManagement) THREE.ColorManagement.enabled = false;
if ('outputColorSpace' in renderer)
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace || THREE.NoColorSpace;

/* Half-float render targets.
   `capabilities.isWebGL2` disappeared when WebGL1 support was dropped, and
   OES_texture_half_float does not exist on a WebGL2 context — the old test
   silently fell through to 8-bit targets, which bands the disk and clips the
   bloom. Ask about rendering *to* float instead, which is the real question. */
export const HDR = (() => {
  const gl = renderer.getContext();
  const gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  const ok = gl2
    ? !!(renderer.extensions.get('EXT_color_buffer_half_float') ||
         renderer.extensions.get('EXT_color_buffer_float'))
    : !!renderer.extensions.get('OES_texture_half_float');
  return ok ? THREE.HalfFloatType : THREE.UnsignedByteType;
})();
