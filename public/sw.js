/* Service worker: offline, without staleness.
 *
 * Network-first, on purpose. The whole application is one document that must
 * revalidate on every load — that is why public/_headers sets
 * `max-age=0, must-revalidate` on it — and a cache-first worker would quietly
 * undo that, serving yesterday's build to someone who reloaded specifically to
 * get today's. So every request goes to the network first and the cache is
 * only consulted when the network is not there.
 *
 * That makes the cache pure upside: it can never serve something stale while
 * you are online, and it means the page works on a plane.
 *
 * There is very little to cache. The document carries the entire app — no JS
 * bundle, no stylesheet, no textures, no audio — so the offline story is one
 * HTML file plus the icons.
 */
const VERSION = 'kerr-v1';

/* Warmed at install so the very first offline load works even if the visitor
   never came back. Everything else is cached as it is fetched. */
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      // individually, so one 404 does not abort the whole install
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;

  // Only GETs from this origin. A dropped audio file is a blob: URL and never
  // reaches the network; nothing else here is cross-origin by construction.
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        // Opaque and error responses are not worth keeping
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        // A navigation to any path should still land on the app
        if (req.mode === 'navigate') {
          const shell = await caches.match('/index.html');
          if (shell) return shell;
        }
        return new Response('offline', { status: 503, statusText: 'offline' });
      })
  );
});
