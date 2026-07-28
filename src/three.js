/* The one place the app touches the vendored bundle.
   vendor/three.bundle.js is an IIFE — tree-shaken from three-entry.js by
   `npm run vendor:three`, committed, and hash-pinned in scripts/check.mjs —
   which assigns a single global. Reading it here rather than in a dozen
   modules means the seam is greppable: if the vendoring strategy ever
   changes, this file is the only thing that has to know.

   It is deliberately not `import { X } from 'three'`. The bundle is committed
   precisely so that a build never has to resolve, download or re-shake the
   dependency, and so that check 2 can prove the shipped bytes are the pinned
   ones. */
export const THREE = globalThis.THREE;

if (!THREE) throw new Error('vendor/three.bundle.js did not load before the app');
