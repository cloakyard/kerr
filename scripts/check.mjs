#!/usr/bin/env node
/**
 * Pre-deploy checks. Everything lives in one HTML file, so nothing type-checks
 * it on the way past — these are the guards that actually catch things.
 *
 *   1. the inline <script> parses as JavaScript
 *   2. the vendored three.js is byte-for-byte the pinned release
 *   3. no reference points off this origin
 *
 * Check 1 exists because GLSL lives in template literals: a stray backtick in
 * a shader comment silently terminates the string and the page dies at load.
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { externalLoads } from './external.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// vendor/three.bundle.js — three r185, tree-shaken from src/three-entry.js by
// `npm run vendor:three`. It is committed so the app build needs no toolchain;
// the hash is here so a stale or hand-edited bundle cannot ship unnoticed.
const THREE_SHA256 = '3aa7573af497d2b8f3008d131c78034bb7b7f37a9c4540aaa479b9e919103d8d';

const fail = [];
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { fail.push(m); console.log(`  ✗ ${m}`); };

const html = await readFile(join(root, 'src', 'index.html'), 'utf8');

// 1 — the inline script parses
const script = html.match(/<script>\n([\s\S]*?)\n<\/script>/);
if (!script) {
  bad('no inline <script> block found');
} else {
  const tmp = join(tmpdir(), `kerr-check-${process.pid}.js`);
  writeFileSync(tmp, script[1]);
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    ok(`inline script parses (${(script[1].length / 1024).toFixed(0)} KB)`);
  } catch (e) {
    bad('inline script has a syntax error:\n' + String(e.stderr || e.message).trim());
  } finally {
    unlinkSync(tmp);
  }
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

// 3 — the vendor entry lists every symbol the page uses
try {
  const entry = await readFile(join(root, 'src', 'three-entry.js'), 'utf8');
  const used = [...new Set([...html.matchAll(/THREE\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))];
  const missing = used.filter((s) => !new RegExp(`\\b${s}\\b`).test(entry));
  if (missing.length) bad(`three-entry.js does not export: ${missing.join(', ')}`);
  else ok(`all ${used.length} THREE symbols are exported by the vendor entry`);
} catch {
  bad('src/three-entry.js is missing');
}

// 4 — nothing is *fetched* from another origin (metadata URLs are fine)
const external = externalLoads(html);
if (external.length) bad('external resource loads:\n      ' + external.join('\n      '));
else ok('no external origins fetched');

if (fail.length) {
  console.log(`\n${fail.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
