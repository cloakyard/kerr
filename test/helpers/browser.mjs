/* A browser, with no dependencies.
 *
 * Node 24 ships a global WebSocket, and Chrome speaks DevTools Protocol over
 * one, so driving a real browser costs a hundred lines here instead of a
 * hundred megabytes in node_modules. That matters for this project in
 * particular: the whole claim is that it has one dependency, and adding
 * Playwright to run one smoke test would have made that a lie in the test
 * directory.
 *
 * It finds whatever Chrome is already on the machine, including the copy
 * Playwright leaves in its cache, and skips the suite cleanly if there is
 * none.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir, homedir } from 'node:os';
import { join, extname, normalize } from 'node:path';

/* ---- finding a browser ------------------------------------------------- */

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

/** Playwright's cache, if the user has ever installed its chromium. */
async function fromPlaywrightCache() {
  const roots = [
    join(homedir(), 'Library', 'Caches', 'ms-playwright'),
    join(homedir(), '.cache', 'ms-playwright'),
  ];
  for (const root of roots) {
    let entries;
    try { entries = await readdir(root); } catch { continue; }
    // headless_shell first — it is the one built for exactly this
    for (const dir of entries.sort().reverse()) {
      for (const rel of [
        'chrome-mac/headless_shell',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
        'chrome-linux/headless_shell',
        'chrome-linux/chrome',
      ]) {
        const p = join(root, dir, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

export async function findChrome() {
  for (const p of CANDIDATES) if (p && existsSync(p)) return p;
  return await fromPlaywrightCache();
}

/* ---- a static server that applies the real production headers ---------- */

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Parse public/_headers into [{ pattern, headers }]. Cloudflare's format: a
 * path on its own line, then indented `Name: value` lines.
 *
 * Serving dist/ with these applied is the point — it means the smoke test
 * exercises the actual Content-Security-Policy, so a policy that forbids
 * something the page needs fails here rather than in production.
 */
export function parseHeaders(text) {
  const rules = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = { pattern: line.trim(), headers: [] };
      rules.push(current);
    } else if (current) {
      const i = line.indexOf(':');
      if (i > 0) current.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
    }
  }
  return rules;
}

const matches = (pattern, path) =>
  pattern.endsWith('/*') ? path.startsWith(pattern.slice(0, -1)) : pattern === path;

/**
 * Collect the headers for a path the way Cloudflare does: every matching rule
 * contributes, and a repeated name is *appended* rather than replaced.
 *
 * That detail is not pedantry. /sw.js matches both `/*` and its own rule, so
 * it is served two Content-Security-Policy headers, and a browser enforces the
 * intersection of every policy it is given — which is why the document's
 * policy lives in a meta tag and the header is the looser of the two. A test
 * server that collapsed duplicates would silently pass a configuration that
 * breaks in production.
 */
export function headersFor(rules, path) {
  const out = new Map();
  for (const r of rules) {
    if (!matches(r.pattern, path)) continue;
    for (const [k, v] of r.headers) {
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(v);
    }
  }
  return out;
}

export async function serve(root, headerRules = []) {
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const lookup = path === '/' ? '/index.html' : path;
    const file = join(root, normalize(lookup).replace(/^(\.\.[/\\])+/, ''));
    const headers = headersFor(headerRules, path);
    try {
      if ((await stat(file)).isDirectory()) throw new Error('dir');
      const body = await readFile(file);
      res.writeHead(200, {
        ...Object.fromEntries(headers),
        'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      });
      res.end(body);
    } catch {
      res.writeHead(404, Object.fromEntries(headers)).end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    server,
    origin: `http://127.0.0.1:${server.address().port}`,
    /* closeAllConnections() before close(): http.Server.close() waits for every
       open connection to end, and a browser holds keep-alive sockets. Without
       this the teardown hook blocks forever and takes the whole runner with
       it — silently, because a hung after() produces no output at all. */
    close: () => {
      server.closeAllConnections?.();
      return new Promise((r) => server.close(r));
    },
  };
}

/* ---- the protocol ------------------------------------------------------ */

class Session {
  constructor(ws, sessionId) {
    this.ws = ws;
    this.sessionId = sessionId;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.listeners = [];
  }

  handle(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      this.events.push(msg);
      for (const l of this.listeners) l(msg);
    }
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (this.sessionId) payload.sessionId = this.sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 30000);
    });
  }

  /** Evaluate in the page and return the value. Rejects on a thrown error. */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) {
      const e = r.exceptionDetails;
      throw new Error(e.exception?.description || e.text || 'evaluate threw');
    }
    return r.result.value;
  }
}

async function waitFor(fn, { timeout = 20000, interval = 100, what = 'condition' } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

/**
 * Launch headless Chrome, open one page, and return a Session plus the
 * console errors and uncaught exceptions collected since load.
 */
export async function launch(chromePath) {
  const userDataDir = await mkdtemp(join(tmpdir(), 'kerr-chrome-'));
  const child = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-sync', '--metrics-recording-only',
    // WebGL in headless comes from SwiftShader; without these the context
    // creation fails and every render assertion becomes a false negative.
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--mute-audio', '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,720',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });

  /* A browser outlives its parent by default, so a test runner that is killed
     mid-suite leaves Chrome behind — and they accumulate fast enough to bring
     the machine to its knees. Belt and braces: cleanup() on the happy path,
     and a process hook for every other way this ends. */
  const kill = () => { try { child.kill('SIGKILL'); } catch {} };
  process.once('exit', kill);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(sig, () => { kill(); process.exit(1); });
  }

  const cleanup = async () => {
    kill();
    process.removeListener('exit', kill);
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    // Chrome writes the port it actually picked into the profile directory
    const portFile = join(userDataDir, 'DevToolsActivePort');
    const port = await waitFor(async () => {
      try {
        const [p] = (await readFile(portFile, 'utf8')).split('\n');
        return p && Number(p);
      } catch { return null; }
    }, { timeout: 20000, what: 'Chrome to report its debugging port' });

    // fetch has no default timeout; a Chrome that opened the port but never
    // answers would hang here indefinitely
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`,
      { signal: AbortSignal.timeout(15000) })).json();
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    const sessions = new Map();
    const browser = new Session(ws, null);

    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      const target = msg.sessionId ? sessions.get(msg.sessionId) : browser;
      target?.handle(msg);
    });
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('devtools socket never opened')), 15000);
      ws.addEventListener('open', () => { clearTimeout(t); res(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(t); rej(new Error('devtools socket failed')); }, { once: true });
    });

    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Session(ws, sessionId);
    sessions.set(sessionId, page);

    const errors = [];
    page.listeners.push((msg) => {
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        errors.push('uncaught: ' + (d.exception?.description || d.text));
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description ?? '?').join(' '));
      } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        errors.push(`${msg.params.entry.source}: ${msg.params.entry.text}`);
      }
    });

    await page.send('Runtime.enable');
    await page.send('Log.enable');
    await page.send('Page.enable');

    return { page, errors, cleanup, stderr: () => stderr, waitFor };
  } catch (e) {
    await cleanup();
    throw new Error(`could not start Chrome: ${e.message}\n${stderr.slice(0, 500)}`);
  }
}

/**
 * Navigate and wait for the load event.
 *
 * The timeout is not paranoia. A navigation that is cancelled, or one a
 * service worker answers in a way that never produces a load event, leaves
 * this waiting forever — and a hung await inside a test hook takes the whole
 * runner down with no output at all, which is a great deal harder to diagnose
 * than a failed assertion.
 */
export async function goto(page, url, { timeout = 30000 } = {}) {
  let done;
  const loaded = new Promise((resolve, reject) => {
    const l = (m) => {
      if (m.method !== 'Page.loadEventFired') return;
      done();
      resolve();
    };
    const timer = setTimeout(() => { done(); reject(new Error(`navigation to ${url} never fired load`)); }, timeout);
    done = () => {
      clearTimeout(timer);
      const i = page.listeners.indexOf(l);
      if (i >= 0) page.listeners.splice(i, 1);
    };
    page.listeners.push(l);
  });
  await page.send('Page.navigate', { url });
  await loaded;
}
