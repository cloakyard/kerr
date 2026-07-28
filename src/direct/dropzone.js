/* "Drop in your own audio file".
   The boot copy promised it long before the page accepted a drop. Takes a
   callback rather than reaching for the boot sequence itself — what happens
   to the file is main.js's business, not the drop target's. */
import { $ } from './dom.js';
import { toast } from './hud.js';

const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|flac|aac|opus)$/i;

export function installDropZone(onFile){
  const dzEl = $('dz');
  let dzDepth = 0;

  addEventListener('dragenter', e => {
    if (!Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault(); dzDepth++; dzEl.classList.add('on');
  });
  addEventListener('dragover', e => {
    if (dzDepth) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
  });
  addEventListener('dragleave', () => { if (--dzDepth <= 0){ dzDepth = 0; dzEl.classList.remove('on'); } });
  addEventListener('drop', e => {
    e.preventDefault(); dzDepth = 0; dzEl.classList.remove('on');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    if (!/^audio\//.test(f.type) && !AUDIO_EXT.test(f.name)){
      toast('That is not an audio file'); return;
    }
    onFile(f);
    toast(f.name.slice(0, 40));
  });

  // the same journey through the file picker, for anyone not dragging
  $('bLoad').onclick = () => $('file').click();
  $('own').onclick = () => $('file').click();
  $('file').onchange = e => {
    const f = e.target.files[0];
    if (f) onFile(f);
  };
}
