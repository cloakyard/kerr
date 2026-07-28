/* Pointer input: drag to orbit, wheel or pinch to fall in.
   Writes only to `view` — it never touches the renderer, so orbiting and
   drawing stay independent of each other. */
import { canvas } from '../render/gl.js';
import { view } from './camera.js';

let px = 0, py = 0;
const pointers = new Map();
let pinchDist = 0;

function pinchSpan(){
  const [a, b] = Array.from(pointers.values());
  return Math.hypot(a.x - b.x, a.y - b.y);
}

canvas.addEventListener('pointerdown', e => {
  pointers.set(e.pointerId, { x:e.clientX, y:e.clientY });
  px = e.clientX; py = e.clientY; view.idleT = 0;
  canvas.setPointerCapture(e.pointerId);
  if (pointers.size === 2) pinchDist = pinchSpan();
});
const endPointer = e => { pointers.delete(e.pointerId); pinchDist = 0; };
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('pointermove', e => {
  view.idleT = 0;
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x:e.clientX, y:e.clientY });
  if (pointers.size >= 2){
    // two-finger pinch to fall in — touch had no way to zoom before
    const d = pinchSpan();
    if (pinchDist > 0 && d > 0) view.zoom = Math.max(0.42, Math.min(2.6, view.zoom * (pinchDist / d)));
    pinchDist = d;
    return;
  }
  view.dragX += (e.clientX - px) * 0.004;
  view.dragY += (e.clientY - py) * 0.0022;
  view.dragY = Math.max(-0.55, Math.min(0.9, view.dragY));
  px = e.clientX; py = e.clientY;
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  view.zoom = Math.max(0.42, Math.min(2.6, view.zoom * (1 + e.deltaY * 0.0012)));
  view.idleT = 0;
}, { passive:false });

// the HUD used to keep fading out while you were using it
addEventListener('pointermove', () => { view.idleT = 0; }, { passive:true });
