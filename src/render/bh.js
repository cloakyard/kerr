/* Live black hole state.
   The arithmetic lives in kerr.js, which is pure and tested; this file is the
   part that holds the current values and pushes them at the GPU. Splitting the
   two is the difference between being able to check the ISCO against Bardeen,
   Press & Teukolsky in a unit test and having to check it against a
   screenshot. */
import { clampSpin, horizonRadius, iscoRadius, diskInner, DISK_OUT } from './kerr.js';
import { uBH } from './scene.js';
import { uP } from './particles.js';

export const BH = { spin:0.6, rh:1, isco:3, din:4.63, dout:DISK_OUT };

export function setSpin(a) {
  a = clampSpin(a);
  BH.spin = a;
  BH.rh   = horizonRadius(a);
  BH.isco = iscoRadius(a);
  BH.din  = diskInner(a);
  BH.dout = DISK_OUT;
  uBH.uSpin.value = a;
  uBH.uRh.value   = BH.rh;
  uBH.uDin.value  = BH.din;
  uBH.uDout.value = BH.dout;
  uP.uIsco.value  = BH.din;
}

setSpin(0.6);
