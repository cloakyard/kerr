/* Shortcuts act only on the scene. Native controls retain their own keys,
   and both overlays provide a complete keyboard journey back to the view. */
import { $ } from './dom.js';
import { Audio } from '../audio/engine.js';
import { toast } from './hud.js';
import { setVol, cycleVoice } from './voicing.js';
import { view } from './camera.js';
import { experience, setCinema, setScenePanel } from './experience.js';

const helpEl = $('help');
helpEl.inert = true;
let helpOrigin = null, restoreCinema = false;
function toggleHelp(on){
  on = on === undefined ? !helpEl.classList.contains('on') : Boolean(on);
  if (on === helpEl.classList.contains('on')) return;
  if (on){
    restoreCinema = experience.cinema;
    if (restoreCinema) setCinema(false);
    setScenePanel(false);
    helpOrigin = document.activeElement;
  }
  helpEl.inert = !on;
  helpEl.classList.toggle('on', on);
  helpEl.setAttribute('aria-hidden', String(!on));
  $('bHelp').setAttribute('aria-expanded', String(on));
  $('hud').inert = on;
  if (on){
    const close = $('bClose'), panel = helpEl.querySelector('.panel');
    close.focus({ preventScroll:true });
    // Sticky close stays in view on short layouts. If content enlargement or
    // another viewport still puts it outside the scrollport, reveal only the
    // missing portion without moving the document or losing keyboard focus.
    const buttonBounds = close.getBoundingClientRect(), bounds = panel.getBoundingClientRect();
    const top = bounds.top + panel.clientTop, bottom = top + panel.clientHeight;
    if (buttonBounds.bottom > bottom - 6) panel.scrollTop += buttonBounds.bottom - bottom + 6;
    else if (buttonBounds.top < top + 6) panel.scrollTop -= top + 6 - buttonBounds.top;
  } else {
    // Re-establish the original HUD focus before cinema captures its origin;
    // otherwise leaving cinema later would return to a hidden help button.
    if (helpOrigin?.isConnected && !helpOrigin.closest('[inert]')) helpOrigin.focus({ preventScroll:true });
    else $('bHelp').focus({ preventScroll:true });
    if (restoreCinema){ restoreCinema = false; setCinema(true); }
  }
}
$('bHelp').onclick = () => toggleHelp();
$('bClose').onclick = () => toggleHelp(false);
helpEl.addEventListener('click', e => { if (e.target === helpEl) toggleHelp(false); });

addEventListener('keydown', e => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  if (helpEl.classList.contains('on')){
    if (e.key === 'Escape' || e.key === 'h' || e.key === 'H' || e.key === '?'){
      e.preventDefault(); toggleHelp(false);
    } else if (e.key === 'Tab'){
      const items = [...helpEl.querySelectorAll('button, [href], select, input, [tabindex="0"]')].filter(el => !el.disabled);
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    }
    return;
  }
  if (e.key === 'Escape' && experience.cinema){ e.preventDefault(); setCinema(false); return; }
  if (e.key === 'Escape' && setScenePanel(false)){ e.preventDefault(); return; }
  // Range/select arrows and Space belong to that focused control. Buttons
  // need native Space/Enter activation rather than a second media action.
  const tag = e.target.tagName;
  if (e.target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;
  if (['BUTTON', 'A'].includes(tag) && (e.code === 'Space' || e.key === 'Enter')) return;
  if (document.body.classList.contains('boot')) return;
  let handled = true;
  if (e.code === 'Space') $('bPause').click();
  else if (e.code === 'ArrowRight') Audio.seek(Audio.time() + 10);
  else if (e.code === 'ArrowLeft') Audio.seek(Audio.time() - 10);
  else if (e.code === 'ArrowUp') setVol(Audio.vol + 0.05, true);
  else if (e.code === 'ArrowDown') setVol(Audio.vol - 0.05, true);
  else if (e.key === 'r' || e.key === 'R'){ Audio.seek(0); toast('Music restarted'); }
  else if (e.key === 'v' || e.key === 'V') cycleVoice();
  else if (e.key === 'f' || e.key === 'F') $('bFull').click();
  else if (e.key === 'c' || e.key === 'C') setCinema(!experience.cinema);
  else if (e.key === 'x' || e.key === 'X'){ $('bReset').click(); toast('View reset'); }
  else if (['1', '2', '3', '4', '5', '6'].includes(e.key)){
    $('shot').value = { 1:'cinematic', 2:'close', 3:'orbit', 4:'edge', 5:'top', 6:'under' }[e.key];
    $('shot').dispatchEvent(new Event('change'));
    toast($('shot').selectedOptions[0].textContent + ' camera');
  }
  else if (e.key === 'h' || e.key === 'H' || e.key === '?') toggleHelp();
  else handled = false;
  if (handled){ e.preventDefault(); view.idleT = 0; }
});
