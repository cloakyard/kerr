/* The #include resolver.
   It replaced `${GLSL_NOISE}` string interpolation, and it has one property
   that is easy to get wrong and impossible to spot by eye: an include pulled
   in twice is a redeclaration error at shader compile time, not a duplicate
   line. Both bh.frag and final.frag include noise.glsl. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandIncludes } from '../scripts/glsl.mjs';

const SHADERS = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'render', 'shaders');

const withFiles = async (files, fn) => {
  const dir = await mkdtemp(join(tmpdir(), 'kerr-glsl-'));
  try {
    for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body);
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

/* Assertions are on content and order, not byte-exact whitespace — the
   resolver leaves the newline the directive sat on, and GLSL does not care. */
const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);

test('an include is replaced by the file it names', () =>
  withFiles({ 'a.frag': 'top\n#include "b.glsl"\nbottom\n', 'b.glsl': 'MIDDLE\n' }, async (d) => {
    assert.deepEqual(lines(await expandIncludes(join(d, 'a.frag'))), ['top', 'MIDDLE', 'bottom']);
  }));

test('includes nest, innermost first', () =>
  withFiles({
    'a.frag': '#include "b.glsl"\nA\n',
    'b.glsl': 'B\n#include "c.glsl"\n',
    'c.glsl': 'C\n',
  }, async (d) => {
    assert.deepEqual(lines(await expandIncludes(join(d, 'a.frag'))), ['B', 'C', 'A']);
  }));

test('the same file included twice is emitted once', () =>
  withFiles({
    'a.frag': '#include "n.glsl"\n#include "n.glsl"\nBODY\n',
    'n.glsl': 'float noise(){ return 0.0; }\n',
  }, async (d) => {
    const out = await expandIncludes(join(d, 'a.frag'));
    assert.equal(out.match(/float noise/g).length, 1, 'duplicate would be a GLSL redeclaration');
    assert.ok(out.includes('BODY'));
  }));

test('a diamond include is emitted once', () =>
  withFiles({
    'a.frag': '#include "b.glsl"\n#include "c.glsl"\nBODY\n',
    'b.glsl': '#include "n.glsl"\nB\n',
    'c.glsl': '#include "n.glsl"\nC\n',
    'n.glsl': 'NOISE\n',
  }, async (d) => {
    const out = await expandIncludes(join(d, 'a.frag'));
    assert.equal(out.match(/NOISE/g).length, 1);
    assert.ok(out.includes('B') && out.includes('C') && out.includes('BODY'));
  }));

test('a circular include terminates instead of hanging', () =>
  withFiles({ 'a.frag': '#include "b.glsl"\nA\n', 'b.glsl': '#include "a.frag"\nB\n' }, async (d) => {
    const out = await expandIncludes(join(d, 'a.frag'));
    assert.ok(out.includes('A') && out.includes('B'));
  }));

test('a missing include fails loudly', () =>
  withFiles({ 'a.frag': '#include "nope.glsl"\n' }, async (d) => {
    await assert.rejects(() => expandIncludes(join(d, 'a.frag')), /ENOENT|nope\.glsl/);
  }));

test('only a whole-line directive counts', () =>
  withFiles({
    'a.frag': '// #include "b.glsl" in a comment\nfloat s = w #include "b.glsl";\n  #include "b.glsl"\n',
    'b.glsl': 'REAL\n',
  }, async (d) => {
    const out = await expandIncludes(join(d, 'a.frag'));
    // the indented one is real; the commented and mid-expression ones are not
    assert.equal(out.match(/REAL/g).length, 1);
    assert.ok(out.includes('// #include "b.glsl" in a comment'));
  }));

test('the real shaders resolve, and each carries the noise helpers exactly once', async () => {
  for (const name of ['bh.frag', 'final.frag']) {
    const out = await expandIncludes(join(SHADERS, name));
    assert.equal(out.match(/float hash21\(/g).length, 1, `${name} has duplicate noise helpers`);
    assert.ok(!out.includes('#include'), `${name} still has an unresolved include`);
    assert.ok(out.includes('void main()'), `${name} lost its entry point`);
  }
});

test('every shader defines main and declares a precision', async () => {
  for (const name of ['bh.frag', 'final.frag', 'bright.frag', 'blur.frag', 'particles.frag']) {
    const out = await expandIncludes(join(SHADERS, name));
    assert.match(out, /precision\s+(low|medium|high)p\s+float/, `${name} has no float precision`);
    assert.match(out, /void main\(\)/, `${name} has no main`);
  }
});

test('no shader carries a stray backtick', async () => {
  // The reason these are files at all: a backtick used to end the template
  // literal early and take the whole page down with it.
  for (const name of ['bh.frag', 'final.frag', 'bright.frag', 'blur.frag',
                      'particles.frag', 'particles.vert', 'quad.vert', 'noise.glsl']) {
    const out = await expandIncludes(join(SHADERS, name));
    assert.ok(!out.includes('`'), `${name} contains a backtick`);
    assert.ok(!out.includes('${'), `${name} contains a template interpolation`);
  }
});
