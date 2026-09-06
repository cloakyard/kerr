/* Shared, read-only layout probes for the browser regressions and captures. */
export async function setViewport(page, { width, height, touch = false }, { reducedMotion = false } = {}) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor:1, mobile:touch, screenWidth:width, screenHeight:height,
  });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled:touch, maxTouchPoints:touch ? 5 : 1 });
  await page.send('Emulation.setEmulatedMedia', {
    features:[{ name:'prefers-reduced-motion', value:reducedMotion ? 'reduce' : 'no-preference' }],
  });
}

export async function frameSettled(page, count = 3) {
  return page.eval(`new Promise(resolve => {
    let left = ${count};
    const next = () => --left <= 0 ? resolve(true) : requestAnimationFrame(next);
    requestAnimationFrame(next);
  })`);
}

export async function inspectLayout(page) {
  return page.eval(`(${layoutProbe.toString()})()`);
}

function layoutProbe() {
  const bounds = element => {
    const r = element.getBoundingClientRect();
    return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom };
  };
  const hiddenReason = element => {
    if (!element || element.hidden || element.closest('[inert]')) return 'hidden or inert';
    for (let node = element; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0)
        return (node.id || node.className || node.tagName) + ': ' + [style.display, style.visibility, style.opacity].join('/');
    }
    const r = element.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? null : 'empty bounds';
  };
  const visible = element => hiddenReason(element) === null;
  const candidates = [...document.querySelectorAll('button, select, input:not([type=file]), #map')];
  const controls = candidates
    .filter(visible).map(element => {
      const r = bounds(element), x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { id:element.id || element.getAttribute('data-voice') || element.textContent.trim(),
        tag:element.tagName, ...r, hit:!!hit && (hit === element || element.contains(hit)),
        disabled:element.disabled || false };
    });
  const regions = {};
  for (const selector of ['.identity', '.tr', '.scene-controls', '.deck', '.intro-content', '#help .panel']) {
    const element = document.querySelector(selector);
    if (visible(element)) regions[selector] = { ...bounds(element), scrollWidth:element.scrollWidth,
      clientWidth:element.clientWidth, scrollHeight:element.scrollHeight, clientHeight:element.clientHeight };
  }
  return { viewport:{ width:innerWidth, height:innerHeight, dpr:devicePixelRatio },
    visualViewport:window.visualViewport ? { width:visualViewport.width, height:visualViewport.height, scale:visualViewport.scale } : null,
    scrollWidth:document.documentElement.scrollWidth, clientWidth:document.documentElement.clientWidth,
    touch:matchMedia('(pointer:coarse)').matches, reducedMotion:matchMedia('(prefers-reduced-motion:reduce)').matches,
    bodyClass:document.body.className, controls, regions,
    hiddenControls:candidates.filter(element => !visible(element)).map(element => ({ id:element.id || element.dataset.voice,
      reason:hiddenReason(element), ...bounds(element) })) };
}
