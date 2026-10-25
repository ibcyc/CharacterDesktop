// 音效 (bottom right, left of 組合): the sound library, the files in Data\Sounds. Sounds are added by putting files
// there (打開資料夾; mp3, wav, ogg, m4a or flac); ▶ plays one here, 🗑 deletes it after asking (characters using it
// then play none); the volume is for every sound. Characters choose their sounds under 互動音效 (interaction-panel.js).

const PLAY = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
let hearing = null;   // the sound playing here

function setSoundsOpen(open) {
  $('sounds-panel').hidden = !open;
  $('sounds-toggle').setAttribute('aria-expanded', String(open));
  if (!open) return;
  setAppMenuOpen(false);
  setGroupsOpen(false);
  refreshSounds();
}

// Plays a library sound at the set volume (read afresh each time: a file in the folder may have changed).
async function playSound(name) {
  const sound = await window.desktopAPI.soundData(name);
  if (!sound) return null;
  const url = URL.createObjectURL(new Blob([sound.data], { type: sound.mime })), audio = new Audio(url);
  audio.volume = Number($('sound-volume').value) / 100;
  audio.onpause = audio.onerror = () => URL.revokeObjectURL(url);
  audio.play().catch(() => {});
  return audio;
}

async function hear(name) {
  hearing?.pause();
  hearing = await playSound(name);
}

function renderSounds({ sounds, volume }) {
  soundNames = sounds;
  syncInteraction();
  $('sound-volume').value = volume;
  $('sound-volume-label').textContent = volume + '%';
  const list = $('sounds-list');
  if (!sounds.length) {
    const empty = document.createElement('p');
    empty.className = 'groups-empty';
    empty.textContent = '還沒有音效。把音效檔放進資料夾。';
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...sounds.map(name => {
    const item = document.createElement('div'), play = document.createElement('button'), remove = document.createElement('button');
    item.className = 'group-item sound-item';
    item.dataset.name = name;
    play.type = remove.type = 'button';
    play.className = 'group-name';
    play.innerHTML = PLAY;
    play.append(' ' + name.replace(/\.[^.]+$/, ''));
    play.title = name;
    play.onclick = () => hear(name);
    remove.className = 'icon-button';
    remove.innerHTML = TRASH;
    remove.title = remove.ariaLabel = '刪除音效';
    remove.onclick = async () => {
      if (!await confirmDialog('要刪除音效「' + name + '」嗎？', { detail: '用到它的角色就不會再播放這個音效。', ok: '刪除', danger: true })) return;
      const next = await window.desktopAPI.deleteSound(name);
      if (next) await restoreFromApp(await window.desktopAPI.getState());
      renderSounds(next || await window.desktopAPI.listSounds());
    };
    item.append(play, remove);
    return item;
  }));
}
async function refreshSounds() { renderSounds(await window.desktopAPI.listSounds()); }

function setUpSounds() {
  $('sounds-toggle').onclick = () => setSoundsOpen($('sounds-panel').hidden);
  $('sounds-open').onclick = async () => { await window.desktopAPI.openSounds(); refreshSounds(); };
  const sendVolume = latestOnly(value => window.desktopAPI.setVolume(value));
  $('sound-volume').oninput = () => {
    $('sound-volume-label').textContent = $('sound-volume').value + '%';
    if (hearing) hearing.volume = Number($('sound-volume').value) / 100;
    sendVolume(Number($('sound-volume').value));
  };
  window.addEventListener('keydown', event => { if (event.key === 'Escape') setSoundsOpen(false); });
  document.addEventListener('pointerdown', event => {
    if (!$('sounds-panel').hidden && !event.target.closest?.('.sounds-dock, #dialog')) setSoundsOpen(false);
  });
  // Files put in the folder (in Explorer) show when the window comes back.
  window.addEventListener('focus', () => refreshSounds());
  refreshSounds();
}
