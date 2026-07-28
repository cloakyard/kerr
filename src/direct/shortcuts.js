/* Help panel and keyboard shortcuts.
   Every key here has a visible control behind it — the shortcuts drive the
   buttons rather than duplicating what they do, so the two can never drift. */
import { $ } from './dom.js';
import { Audio } from '../audio/engine.js';
import { toast } from './hud.js';
import { setVol, cycleVoice } from './voicing.js';
import { view } from './camera.js';

const helpEl = $('help');
const toggleHelp = on => {
  helpEl.classList.toggle('on', on === undefined ? !helpEl.classList.contains('on') : on);
};
$('bHelp').onclick = () => toggleHelp();
$('bClose').onclick = () => toggleHelp(false);
helpEl.addEventListener('click', e => { if (e.target === helpEl) toggleHelp(false); });

addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' && e.key.startsWith('Arrow')) return;
  if (e.code === 'Space'){ e.preventDefault(); $('bPause').click(); }
  else if (e.code === 'ArrowRight'){ e.preventDefault(); Audio.seek(Audio.time() + 10); }
  else if (e.code === 'ArrowLeft'){ e.preventDefault(); Audio.seek(Audio.time() - 10); }
  else if (e.code === 'ArrowUp'){ e.preventDefault(); setVol(Audio.vol + 0.05, true); }
  else if (e.code === 'ArrowDown'){ e.preventDefault(); setVol(Audio.vol - 0.05, true); }
  else if (e.key === 'r' || e.key === 'R'){ Audio.seek(0); toast('Restarted'); }
  else if (e.key === 'v' || e.key === 'V'){ cycleVoice(); }
  else if (e.key === 'f' || e.key === 'F'){ $('bFull').click(); }
  else if (e.key === 'h' || e.key === 'H' || e.key === '?'){ toggleHelp(); }
  else if (e.key === 'Escape'){ toggleHelp(false); }
  view.idleT = 0;
});
