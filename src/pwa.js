/* Install the service worker, and never let it matter if it fails.
 *
 * Registration is deliberately fire-and-forget. Offline support is a bonus on
 * top of a page that already works; a browser that refuses the worker — no
 * secure context, a locked-down profile, a policy that blocks workers outright
 * — should get the visualiser exactly as it is, with nothing logged and
 * nothing shown. The one thing that must never happen is a failed registration
 * taking the render down with it.
 *
 * Registered after `load` so it never competes with the first frame for
 * bandwidth or main-thread time. */
export function installServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // file:// has an opaque origin and no worker; opening dist/index.html
  // straight off disk is a supported way to run this and must not throw
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;

  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  });
}
