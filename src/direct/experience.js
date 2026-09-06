/* User-directed scene state. Camera and renderer receive this from main.js,
   keeping controls independent of rendering and audio implementation. */
import { $ } from './dom.js';
import { resetCamera } from './camera.js';

export const experience = { shot:'cinematic', palette:'gargantua', response:1, cinema:false };
let installed = false, change = () => {}, cinemaOrigin = null;
const compactScene = matchMedia('(max-width: 1100px), (max-height: 560px)');
let scenePanel = null, viewButton = null, sceneOpen = false;

function syncScenePanel(){
  if (!scenePanel || !viewButton) return;
  const visible = !compactScene.matches || sceneOpen;
  document.body.classList.toggle('scene-open', compactScene.matches && sceneOpen);
  scenePanel.inert = !visible;
  viewButton.setAttribute('aria-expanded', String(visible));
}

/** The compact View panel is a non-modal disclosure. Desktop controls stay
 *  present; closing a disclosure only restores focus when it was inside. */
export function setScenePanel(on, { focus = true } = {}){
  if (!scenePanel || !compactScene.matches) return false;
  on = Boolean(on);
  if (sceneOpen === on) return false;
  const focusWasInside = scenePanel.contains(document.activeElement);
  sceneOpen = on;
  syncScenePanel();
  if (focus){
    if (on) $('shot').focus({ preventScroll:true });
    else if (focusWasInside) viewButton.focus({ preventScroll:true });
  }
  return true;
}

function installScenePanel(){
  scenePanel = $('scenePanel'); viewButton = $('bView');
  if (!scenePanel || !viewButton) return;
  syncScenePanel();
  viewButton.onclick = () => setScenePanel(!sceneOpen);
  compactScene.addEventListener('change', () => {
    // Keep a control available if a resize happens while it has focus.
    // Other transitions into compact mode start closed, without moving focus.
    sceneOpen = compactScene.matches && scenePanel.contains(document.activeElement);
    syncScenePanel();
  });
  addEventListener('pointerdown', e => {
    if (!sceneOpen || !compactScene.matches || scenePanel.contains(e.target) || viewButton.contains(e.target)) return;
    // Focusing View only when leaving an active panel gives a canvas click a
    // useful destination; a clicked native control then receives normal focus.
    setScenePanel(false);
  }, { capture:true });
  addEventListener('focusin', e => {
    if (sceneOpen && compactScene.matches && !scenePanel.contains(e.target) && !viewButton.contains(e.target))
      setScenePanel(false, { focus:false });
  });
}


export function setCinema(on){
  on = Boolean(on);
  if (document.body.classList.contains('boot') || experience.cinema === on) return;
  experience.cinema = on;
  if (on){ setScenePanel(false); cinemaOrigin = document.activeElement; }
  document.body.classList.toggle('cinema', on);
  $('hud').inert = on;
  $('bExitCinema').inert = !on;
  $('bCinema').setAttribute('aria-pressed', String(on));
  $('bCinema').setAttribute('aria-label', on ? 'Exit cinema mode' : 'Enter cinema mode');
  // The exit is outside the hidden HUD and remains available to keyboard,
  // touch and assistive technology users throughout cinema mode.
  if (on) $('bExitCinema').focus({ preventScroll:true });
  else if (cinemaOrigin?.isConnected && !cinemaOrigin.closest('[inert]')) cinemaOrigin.focus({ preventScroll:true });
  else $('bCinema').focus({ preventScroll:true });
  change(experience, 'cinema');
}

export function installExperience({ onReset = () => {}, onChange = () => {} } = {}){
  if (installed) return;
  installed = true;
  change = onChange;
  installScenePanel();
  $('bExitCinema').inert = true;
  $('shot').addEventListener('change', e => {
    const value = e.target.value;
    if (!['cinematic', 'close', 'orbit', 'edge', 'top', 'under'].includes(value)) return;
    experience.shot = value;
    resetCamera(value);
    change(experience, 'shot');
  });
  $('palette').addEventListener('change', e => {
    const value = e.target.value;
    if (!['gargantua', 'ember', 'polar'].includes(value)) return;
    experience.palette = value;
    document.body.dataset.palette = value;
    change(experience, 'palette');
  });
  $('response').addEventListener('input', e => {
    const value = Number(e.target.value);
    if (!Number.isFinite(value)) return;
    experience.response = Math.max(0, Math.min(2, value));
    $('responseValue').textContent = Math.round(experience.response * 100) + '%';
    $('response').style.setProperty('--response', experience.response * 50 + '%');
    $('response').setAttribute('aria-valuetext', Math.round(experience.response * 100) + ' percent');
    change(experience, 'response');
  });
  $('bReset').onclick = () => { resetCamera(experience.shot); onReset(); };
  $('bCinema').onclick = () => setCinema(!experience.cinema);
  $('bExitCinema').onclick = () => setCinema(false);
}
