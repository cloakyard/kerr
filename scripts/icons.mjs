#!/usr/bin/env node
/**
 * Rasterise the install icons from their SVG sources.
 *
 * Run by hand, like `npm run vendor:three` — the PNGs are committed, so a
 * build never needs this and CI never needs a rasteriser. Re-run it when
 * public/icon.svg or public/icon-maskable.svg changes.
 *
 * Uses macOS's own Quick Look, which is already installed on the machine this
 * project is developed on and produces a correct RGBA raster straight from the
 * viewBox. That makes this script the one macOS-only thing in the repo; it is
 * an authoring tool, not part of the build, so the trade is worth it.
 *
 *   npm run icons
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(root, 'public');
const OUT = join(PUBLIC, 'icons');

/* PNG sizes, and why each exists.
   192 + 512 "any"    the pair Chrome wants before it will offer an install
   512 maskable       Android launchers crop; see the note in icon-maskable.svg
   180 apple-touch    iOS ignores the manifest for home-screen bookmarks */
const JOBS = [
  { src: 'icon.svg',          out: 'icon-192.png',           size: 192 },
  { src: 'icon.svg',          out: 'icon-512.png',           size: 512 },
  { src: 'icon-maskable.svg', out: 'icon-maskable-512.png',  size: 512 },
  { src: 'icon.svg',          out: 'apple-touch-icon.png',   size: 180 },
];

if (process.platform !== 'darwin') {
  console.error('✗ scripts/icons.mjs uses macOS Quick Look. The PNGs are committed —');
  console.error('  regenerate them on a Mac, or replace public/icons/*.png by hand.');
  process.exit(1);
}

await mkdir(OUT, { recursive: true });
const tmp = await mkdtemp(join(tmpdir(), 'kerr-icons-'));

try {
  for (const { src, out, size } of JOBS) {
    const source = join(PUBLIC, src);
    if (!existsSync(source)) throw new Error(`missing source: ${src}`);
    execFileSync('qlmanage', ['-t', '-s', String(size), '-o', tmp, source], { stdio: 'pipe' });
    const produced = join(tmp, basename(src) + '.png');
    if (!existsSync(produced)) throw new Error(`Quick Look produced nothing for ${src}`);
    // sips guarantees the exact square; Quick Look fits the longest edge
    execFileSync('sips', ['-z', String(size), String(size), produced], { stdio: 'pipe' });
    await rename(produced, join(OUT, out));
    console.log(`  ✓ public/icons/${out.padEnd(24)} ${size}x${size}`);
  }
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('\nicons written. They are committed — remember to add them.');
