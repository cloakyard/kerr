# Contributing to KERR

Contributions are welcome! Here's how to get started:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

```bash
npm install
npm run dev      # rebuilds on change, serves http://localhost:8080
npm run check    # six fast static gates
npm test         # the real suite — run this before you push
```

## Two things worth knowing before you edit

**The layering is load-bearing.** `src/` is three layers and the dependency
arrows point one way: `audio/` imports nothing at all, `render/` imports
nothing above it, `direct/` composes both, and only `main.js` knows about all
three. `npm run check` enforces it. If a change seems to need an import
pointing the other way — the renderer reaching for the HUD, say — that is a
signal the code is in the wrong layer, not that the rule needs an exception.

**The comments are documentation.** A lot of the numbers in the shaders and the
camera presets are deliberately *not* the physically correct ones, and the
comment next to each says what was measured off the film and why the wrong
number is the right one. Read those before changing a constant, and write in
the same register when you add one.

**Put arithmetic where a test can reach it.** `render/kerr.js` and
`direct/output.js` are pure and import nothing, which is the only reason the
ISCO can be checked against Bardeen, Press & Teukolsky rather than against a
screenshot. If new logic needs a WebGL context or a `navigator` to run, that is
usually a sign the decision and the plumbing want to be separate.

## Before pushing

`npm run check` is the fast gate: the module tree bundles (which is also how
syntax errors and unresolved `#include`s get caught), the pinned three.js build
matches its hash, every `THREE.*` symbol you use is exported by
`src/three-entry.js`, the built page loads nothing from another origin, the
layering holds, and every shader resolves to a whole program.

`npm test` is the one that matters — 93 tests on `node:test`, with **no test
dependencies**. The browser tests drive whatever Chrome is already installed
over DevTools Protocol; if there is none they skip with a note rather than
failing. They are the only thing that catches a shader which will not compile,
a throw during boot, or a Content-Security-Policy that forbids something the
page needs, so it is worth having a Chrome around.

Both run automatically on `npm run deploy`.
