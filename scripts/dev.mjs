#!/usr/bin/env node
/**
 * Dev: rebuild on change, serve dist/.
 *
 * Development used to run src/index.html straight from disk with no build at
 * all, which was a genuinely nice property to have. It went when the shaders
 * became real files — a browser cannot import a .frag as text — and rather
 * than keep a second, subtly different code path just for development, dev
 * and production now run the same builder. What you look at in the browser is
 * what ships, modulo minification.
 *
 * The rebuild is a full one because a full one is ~50 ms.
 */
import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from './build.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let building = false, again = false;

async function rebuild(why) {
  if (building) { again = true; return; }
  building = true;
  const t0 = Date.now();
  try {
    await build({ dev: true });
    console.log(`  rebuilt in ${Date.now() - t0}ms${why ? '  · ' + why : ''}`);
  } catch (e) {
    console.error('✗ ' + (e.message || e));
  }
  building = false;
  if (again) { again = false; rebuild(); }
}

await rebuild('initial');

let timer = null;
for (const dir of ['src', 'vendor', 'public']) {
  watch(join(root, dir), { recursive: true }, (_, file) => {
    clearTimeout(timer);
    timer = setTimeout(() => rebuild(file), 40);
  });
}

spawn(process.execPath, [join(root, 'scripts', 'serve.mjs'), 'dist'], { stdio: 'inherit' });
