#!/usr/bin/env node
/**
 * Generate every icon from public/logo.svg, the same mark inlined into the
 * masthead by the build. The only differences are background and safe-area
 * padding; the geometry, colour and optical weight remain the same.
 *
 * Run by hand, like `npm run vendor:three` — the PNGs are committed, so a
 * build never needs this and CI never needs a rasteriser. Re-run it when
 * public/logo.svg changes. Generated SVGs and PNGs are committed together.
 *
 * Uses the same local Chrome/CDP harness as browser validation, with no extra
 * dependencies. Its transparent canvas preserves the favicon's rounded
 * corners; Quick Look can flatten those to white. Set CHROME_PATH if needed.
 *
 *   npm run icons
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { findChrome, launch, goto } from '../test/helpers/browser.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(root, 'public');

/* PNG sizes, and why each exists.
   192 + 512 "any"    the pair Chrome wants before it will offer an install
   512 maskable       Android launchers crop; see the note in icon-maskable.svg
   180 apple-touch    iOS ignores the manifest for home-screen bookmarks
   64 favicon        fallback for browsers that do not use SVG tab icons */
const JOBS = [
  { src: 'favicon.svg',      out: 'favicon.png',                 size: 64 },
  { src: 'icon.svg',         out: 'icons/icon-192.png',           size: 192 },
  { src: 'icon.svg',         out: 'icons/icon-512.png',           size: 512 },
  { src: 'icon-maskable.svg',out: 'icons/icon-maskable-512.png',  size: 512 },
  { src: 'icon.svg',         out: 'icons/apple-touch-icon.png',   size: 180 },
];

const chrome = await findChrome();
if (!chrome) throw new Error('No Chrome found. Set CHROME_PATH to regenerate icons.');

const logo = await readFile(join(PUBLIC, 'logo.svg'), 'utf8');
const match = logo.match(/<svg\b[^>]*viewBox="0 0 42 42"[^>]*>([\s\S]*?)<\/svg>/);
if (!match) throw new Error('public/logo.svg must use the canonical 42 x 42 viewBox');
const geometry = match[1].trim();
const color = logo.match(/\bcolor="([^"]+)"/)?.[1];
if (!color) throw new Error('public/logo.svg must define the brand colour');

function iconSVG(size, radius = 0) {
  // The maskable mark occupies 44/64 of the tile. Its furthest point is
  // (20 + stroke/2) * 44/42 = 21.9, inside the 25.6 safe-circle radius.
  const offset = (64 - size) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" color="${color}" role="img" aria-label="KERR">
  <!-- Generated from logo.svg by npm run icons. -->
  <rect width="64" height="64" rx="${radius}" fill="#05060a"/>
  <g transform="translate(${offset} ${offset}) scale(${size / 42})">
    ${geometry}
  </g>
</svg>\n`;
}

await writeFile(join(PUBLIC, 'favicon.svg'), iconSVG(58, 14));
await writeFile(join(PUBLIC, 'icon.svg'), iconSVG(54));
await writeFile(join(PUBLIC, 'icon-maskable.svg'), iconSVG(44));
await mkdir(join(PUBLIC, 'icons'), { recursive: true });
const ctx = await launch(chrome);

try {
  await ctx.page.send('Emulation.setDefaultBackgroundColorOverride', { color:{ r:0, g:0, b:0, a:0 } });
  for (const { src, out, size } of JOBS) {
    const svg = await readFile(join(PUBLIC, src), 'utf8');
    await ctx.page.send('Emulation.setDeviceMetricsOverride', { width:size, height:size, deviceScaleFactor:1, mobile:false });
    await goto(ctx.page, 'data:image/svg+xml,' + encodeURIComponent(svg));
    await ctx.page.eval('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const { data } = await ctx.page.send('Page.captureScreenshot', { format:'png', fromSurface:true, captureBeyondViewport:false });
    await writeFile(join(PUBLIC, out), Buffer.from(data, 'base64'));
    console.log(`  ✓ public/${out.padEnd(30)} ${size}x${size}`);
  }
} finally {
  await ctx.cleanup();
}

console.log('\nicons written. They are committed — remember to add them.');
