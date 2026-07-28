/**
 * esbuild plugin: import a .glsl / .vert / .frag file and get its source as a
 * string, with `#include "other.glsl"` resolved relative to the including file.
 *
 * The shaders used to live in JavaScript template literals, which cost more
 * than it looked like it did: a stray backtick in a comment silently
 * terminated the string and the page died at load with nothing useful in the
 * console, `${GLSL_NOISE}` was an include in all but name, and no editor or
 * validator could see any of it. As real files they highlight, they validate
 * (see scripts/check.mjs), and a compile error names a file and a line.
 *
 * Includes are resolved once each — the noise helpers are pulled in by two
 * shaders, and pasting them twice into the same translation unit is a
 * redeclaration error rather than a convenience.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const INCLUDE = /^[ \t]*#include[ \t]+"([^"]+)"[ \t]*$/gm;

/** Resolve every `#include` in `file`, depth-first, each target at most once.
 *  `seen` doubles as the visited set and the watch list. Exported so
 *  test/glsl.test.js can drive it without going through esbuild. */
export async function expandIncludes(file, seen = new Set([file])) {
  const src = await readFile(file, 'utf8');
  const dir = dirname(file);
  const parts = [];
  let at = 0;

  for (const m of src.matchAll(INCLUDE)) {
    parts.push(src.slice(at, m.index));
    at = m.index + m[0].length;
    const target = resolve(dir, m[1]);
    if (seen.has(target)) continue;
    seen.add(target);
    parts.push(await expandIncludes(target, seen));
  }
  parts.push(src.slice(at));
  return parts.join('');
}

export const glsl = {
  name: 'glsl',
  setup(build) {
    build.onLoad({ filter: /\.(glsl|vert|frag)$/ }, async (args) => {
      const seen = new Set([args.path]);
      const contents = await expandIncludes(args.path, seen);
      // watchFiles so a change to an included file rebuilds its includers too
      return { contents, loader: 'text', watchFiles: [...seen] };
    });
  },
};
