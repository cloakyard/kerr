/* The architecture, as an assertion.
   Three layers with the arrows pointing one way is the whole reason this
   codebase is navigable, and it is exactly the kind of property that decays
   one convenient import at a time. Nothing here reads a single line of logic —
   it reads the import statements. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src');

async function walk(dir, exts = ['.js']) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, exts)));
    else if (exts.includes(extname(e.name))) out.push(p);
  }
  return out;
}

const files = (await walk(SRC)).filter((f) => !f.endsWith('three-entry.js'));
const rel = (p) => relative(SRC, p).split('\\').join('/');

const sources = new Map();
for (const f of files) sources.set(f, await readFile(f, 'utf8'));

/** Relative imports only — bare specifiers would be a dependency, and there
 *  are none. Shader imports are edges too, but not to .js files. */
function importsOf(file) {
  const out = [];
  for (const m of sources.get(file).matchAll(/import\s+(?:[^'"]*?\s+from\s+)?['"](\.[^'"]+)['"]/g)) {
    out.push({ spec: m[1], path: resolve(dirname(file), m[1]) });
  }
  return out;
}

test('the layering holds: audio/ and render/ never import from direct/', () => {
  const FORBIDDEN = { audio: ['render', 'direct'], render: ['direct'], direct: [] };
  const breaches = [];
  for (const f of files) {
    const layer = (rel(f).match(/^(audio|render|direct)\//) || [])[1];
    if (!layer) continue;
    for (const { spec } of importsOf(f)) {
      for (const banned of FORBIDDEN[layer]) {
        if (spec.includes(`${banned}/`)) breaches.push(`${rel(f)} → ${spec}`);
      }
    }
  }
  assert.deepEqual(breaches, [], 'layering violated:\n' + breaches.join('\n'));
});

test('audio/ is a leaf: it imports nothing outside itself', () => {
  for (const f of files.filter((f) => rel(f).startsWith('audio/'))) {
    for (const { spec } of importsOf(f)) {
      assert.ok(!spec.includes('..'), `${rel(f)} reaches outside audio/: ${spec}`);
    }
  }
});

test('there are no import cycles', () => {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map(files.map((f) => [f, WHITE]));
  const cycles = [];
  const dfs = (n, stack) => {
    colour.set(n, GREY);
    stack.push(n);
    for (const { path } of importsOf(n)) {
      if (!colour.has(path)) continue;                       // shaders, etc.
      if (colour.get(path) === GREY) cycles.push([...stack.slice(stack.indexOf(path)), path].map(rel).join(' → '));
      else if (colour.get(path) === WHITE) dfs(path, stack);
    }
    stack.pop();
    colour.set(n, BLACK);
  };
  for (const f of files) if (colour.get(f) === WHITE) dfs(f, []);
  assert.deepEqual(cycles, [], 'import cycles:\n' + cycles.join('\n'));
});

test('every module is reachable from main.js', () => {
  const seen = new Set();
  const reach = (n) => {
    if (seen.has(n)) return;
    seen.add(n);
    for (const { path } of importsOf(n)) if (sources.has(path)) reach(path);
  };
  reach(join(SRC, 'main.js'));
  const orphans = files.filter((f) => !seen.has(f)).map(rel);
  assert.deepEqual(orphans, [], 'dead modules: ' + orphans.join(', '));
});

test('every relative import resolves to a file that exists', () => {
  const missing = [];
  for (const f of files) {
    for (const { spec, path } of importsOf(f)) {
      if (/\.(glsl|vert|frag)$/.test(spec)) continue;        // checked in glsl.test.js
      if (!sources.has(path)) missing.push(`${rel(f)} → ${spec}`);
    }
  }
  assert.deepEqual(missing, [], 'unresolvable imports:\n' + missing.join('\n'));
});

test('nothing imports three except the one shim that is allowed to', () => {
  for (const f of files) {
    if (rel(f) === 'three.js') continue;
    assert.ok(!/globalThis\.THREE|window\.THREE/.test(sources.get(f)),
      `${rel(f)} reaches for the global instead of importing src/three.js`);
  }
});

test('the vendor entry never uses a namespace import', async () => {
  // `import * as THREE` pulls in the whole library and defeats tree-shaking,
  // which is the entire point of vendoring it
  // anchored to the start of a line so the comment explaining the rule — which
  // necessarily contains the words — does not trip it
  const entry = await readFile(join(SRC, 'three-entry.js'), 'utf8');
  assert.ok(!/^\s*import\s+\*\s+as/m.test(entry), 'namespace import in the vendor entry');
});

test('the vendor entry exports every THREE symbol the app uses', async () => {
  const entry = await readFile(join(SRC, 'three-entry.js'), 'utf8');
  const used = new Set();
  for (const src of sources.values()) {
    for (const m of src.matchAll(/THREE\.([A-Za-z0-9_]+)/g)) used.add(m[1]);
  }
  const missing = [...used].filter((s) => !new RegExp(`\\b${s}\\b`).test(entry));
  assert.deepEqual(missing, [], 'not exported by src/three-entry.js: ' + missing.join(', '));
  assert.ok(used.size > 15, 'symbol scan found suspiciously little');
});

test('no module exports something nothing imports', async () => {
  const imported = new Map();
  for (const f of files) {
    for (const { path } of importsOf(f)) {
      const clause = sources.get(f).match(
        new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"][^'"]*${
          rel(path).split('/').pop().replace('.', '\\.')}['"]`));
      if (!clause) continue;
      if (!imported.has(path)) imported.set(path, new Set());
      for (const n of clause[1].split(',')) {
        const name = n.trim().split(/\s+as\s+/)[0].trim();
        if (name) imported.get(path).add(name);
      }
    }
  }
  /* Constants the tests import to assert against rather than re-hardcoding.
     Exporting them is deliberate; anything else on this list is dead API. */
  const FOR_TESTS = new Set(['BPM', 'WIRELESS_LATENCY', 'SPIN_MAX', 'DISK_IN']);
  const dead = [];
  for (const f of files) {
    const used = imported.get(f) || new Set();
    for (const m of sources.get(f).matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/gm)) {
      if (!used.has(m[1]) && !FOR_TESTS.has(m[1])) dead.push(`${rel(f)}: ${m[1]}`);
    }
  }
  assert.deepEqual(dead, [], 'exported but never imported:\n' + dead.join('\n'));
});
