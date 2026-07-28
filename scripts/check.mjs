#!/usr/bin/env node
/**
 * Pre-deploy checks. Nothing type-checks this code on the way past — these
 * are the guards that actually catch things.
 *
 *   1. the whole module tree bundles (and every #include resolves)
 *   2. the vendored three.js is byte-for-byte the pinned release
 *   3. the vendor entry exports every THREE symbol the app uses
 *   4. no reference in the built page points off this origin
 *   5. the layering holds: render/ and audio/ never import from direct/
 *   6. every shader resolves to a whole program
 *
 * Check 1 used to be `node --check` on a string carved out of the HTML,
 * because the whole app was one inline <script> and a stray backtick in a
 * shader comment would silently truncate it. esbuild does that job properly
 * now: a syntax error fails the build and names a file and a line.
 *
 * Check 5 is the one worth explaining. The three layers are a real DAG —
 * audio/ imports nothing, render/ imports nothing above it, direct/ composes
 * both — and that is what makes any of them possible to reason about alone.
 * It survived this long by discipline; now it is checked.
 */
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, extname } from 'node:path';
import { externalLoads } from './external.mjs';
import { expandIncludes } from './glsl.mjs';
import { build } from './build.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// vendor/three.bundle.js — three r185, tree-shaken from src/three-entry.js by
// `npm run vendor:three`. It is committed so the app build needs no network;
// the hash is here so a stale or hand-edited bundle cannot ship unnoticed.
const THREE_SHA256 = '3aa7573af497d2b8f3008d131c78034bb7b7f37a9c4540aaa479b9e919103d8d';

const fail = [];
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { fail.push(m); console.log(`  ✗ ${m}`); };

async function walk(dir, ext) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, ext)));
    else if (ext.includes(extname(e.name))) out.push(p);
  }
  return out;
}

// 1 — the module tree bundles
let page = null;
try {
  page = await build();
  ok(`bundles (${(Buffer.byteLength(page) / 1024).toFixed(0)} KB inlined)`);
} catch (e) {
  bad('build failed:\n      ' + String(e.message || e).split('\n').join('\n      '));
}

// 2 — vendored dependency is the bundle we expect
try {
  const buf = await readFile(join(root, 'vendor', 'three.bundle.js'));
  const sha = createHash('sha256').update(buf).digest('hex');
  const rev = buf.toString('utf8').match(/REVISION\s*[:=]\s*["'](\d+)["']/);
  if (sha === THREE_SHA256) ok(`vendor/three.bundle.js matches pinned build (three r${rev ? rev[1] : '?'})`);
  else bad(`vendor/three.bundle.js hash mismatch — run \`npm run vendor:three\`\n` +
           `      expected ${THREE_SHA256}\n      got      ${sha}`);
} catch {
  bad('vendor/three.bundle.js is missing — run `npm run vendor:three`');
}

// 3 — the vendor entry lists every symbol the app uses
const jsFiles = await walk(join(root, 'src'), ['.js']);
try {
  const entry = await readFile(join(root, 'src', 'three-entry.js'), 'utf8');
  const used = new Set();
  for (const f of jsFiles) {
    if (f.endsWith('three-entry.js')) continue;
    for (const m of (await readFile(f, 'utf8')).matchAll(/THREE\.([A-Za-z0-9_]+)/g)) used.add(m[1]);
  }
  const missing = [...used].filter((s) => !new RegExp(`\\b${s}\\b`).test(entry));
  if (missing.length) bad(`three-entry.js does not export: ${missing.join(', ')}`);
  else ok(`all ${used.size} THREE symbols are exported by the vendor entry`);
} catch {
  bad('src/three-entry.js is missing');
}

// 4 — nothing is *fetched* from another origin (metadata URLs are fine)
if (page) {
  const external = externalLoads(page);
  if (external.length) bad('external resource loads:\n      ' + external.join('\n      '));
  else ok('no external origins fetched');
}

// 5 — the layering holds
{
  const LAYER = /^src\/(audio|render|direct)\//;
  const FORBIDDEN = { audio: ['render', 'direct'], render: ['direct'], direct: [] };
  const breaches = [];
  for (const f of jsFiles) {
    const rel = relative(root, f).split('\\').join('/');
    const layer = (rel.match(LAYER) || [])[1];
    if (!layer) continue;
    const src = await readFile(f, 'utf8');
    for (const m of src.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)) {
      for (const banned of FORBIDDEN[layer]) {
        if (m[1].includes(`/${banned}/`) || m[1].startsWith(`./${banned}/`))
          breaches.push(`${rel} imports ${m[1]}  (${layer}/ must not depend on ${banned}/)`);
      }
    }
  }
  if (breaches.length) bad('layering violated:\n      ' + breaches.join('\n      '));
  else ok('layering holds — audio/ and render/ do not import from direct/');
}

/* 6 — every shader resolves and looks like a whole program.
   This deliberately stops short of running glslangValidator. The shaders use
   `uv`, `position`, `modelViewMatrix` and friends, which three.js injects into
   the source before compiling, so validating a .frag standalone reports a
   screenful of undeclared identifiers and you would need a hand-maintained
   copy of three's prologue here to avoid it — a copy that silently rots on
   every three.js bump. `npm test` compiles the real shaders in a real driver
   instead (test/smoke.test.js), which is the only check that can actually be
   trusted about GLSL. */
{
  const shaders = (await walk(join(root, 'src'), ['.vert', '.frag']));
  const errs = [];
  for (const f of shaders) {
    const name = relative(root, f);
    let src;
    try { src = await expandIncludes(f); }
    catch (e) { errs.push(`${name}: unresolved include — ${e.message}`); continue; }
    if (src.includes('#include')) errs.push(`${name}: include left unresolved`);
    if (!/void\s+main\s*\(\s*\)/.test(src)) errs.push(`${name}: no entry point`);
    if (src.includes('`')) errs.push(`${name}: contains a backtick`);
    const opens = (src.match(/\{/g) || []).length, closes = (src.match(/\}/g) || []).length;
    if (opens !== closes) errs.push(`${name}: unbalanced braces (${opens} open, ${closes} close)`);
  }
  if (errs.length) bad('shader problems:\n      ' + errs.join('\n      '));
  else ok(`all ${shaders.length} shaders resolve and are whole programs`);
}

if (fail.length) {
  console.log(`\n${fail.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
