// Local characters. The file button (bottom left, under the download button) opens a panel to its right: pick one
// picture or a folder, check what will be taken, name the character and add it, or import a character pack (角色包);
// ? explains the file names. Pictures can also be dropped on the window. For a local character
// the page also offers renaming (pencil next to reset) and opening its folder (under 找回角色).

function setLocalOpen(open) { setDockPanel($('local-panel'), open); }

function showLocalStatus(text) { $('local-status').textContent = text; }

// The app opens the file dialog and checks the choice: a folder with no usable file, without d, or with two files
// for one picture is refused at once; other unusable files are listed as not imported.
async function pickLocal(kind) {
  if (downloading || busy) return null;
  showLocalStatus('');
  $('local-form').hidden = true;
  return showPicked(await window.desktopAPI.pickLocal(kind));
}
let lastPicked = null;   // what the file dialog chose, waiting for a name
function showPicked(picked) {
  lastPicked = picked?.ok ? picked : null;
  if (!picked?.ok) {
    if (picked && !picked.cancelled) showLocalStatus(picked.message);
    return picked;
  }
  $('local-chosen').textContent = (picked.kind === 'folder' ? '資料夾：' : '圖片：') + picked.label
    + (picked.skipped.length ? '\n不會匯入：' + picked.skipped.join('、') : '');
  $('local-name').value = '';
  $('local-form').hidden = false;
  $('local-name').focus();
  return picked;
}

// JPG has no transparency: the whole picture shows. Asked before adding one: 取消, a tool that takes pictures (such
// as one that removes backgrounds; opened with them), or add it as it is. Resolves 'cancel', 'add' or the tool's id.
async function askOpaque() {
  const tools = pictureTools();
  const answer = await askDialog({ message: 'JPG 沒有透明背景', detail: '角色會連背景一起顯示。', buttons: [
    { label: '取消', value: 'cancel' },
    ...tools.map(tool => ({ label: tool.label, value: 'tool:' + tool.id })),
    { label: tools.length ? '直接加入' : '加入', value: 'add', kind: 'primary' }
  ] });
  return answer.value.startsWith('tool:') ? answer.value.slice(5) : answer.value;
}

async function addLocal() {
  if (downloading || busy) return null;
  if (lastPicked?.opaque) {
    const choice = await askOpaque();
    if (choice === 'cancel') return null;
    if (choice !== 'add') {
      // The chosen picture goes to the tool instead.
      const picture = await window.desktopAPI.pendingPicture();
      if (picture) { $('local-form').hidden = true; await openToolWith(choice, [new File([picture.data], picture.name, { type: picture.type })]); }
      return null;
    }
  }
  const result = await window.desktopAPI.addLocal($('local-name').value);
  if (!result?.ok) {
    showLocalStatus(result?.message || '無法加入角色。');
    return result;
  }
  $('local-form').hidden = true;
  await restoreFromApp(await window.desktopAPI.getState());
  showLocalStatus('已加入「' + result.name + '」' + (result.expressions ? '，含 ' + result.expressions + ' 個表情' : '') + '。'
    + (result.skipped.length ? '\n沒有匯入：' + result.skipped.join('、') : ''));
  return result;
}

// ---------- 角色包 ----------
// The app opens the pack, asks about characters already here (跳過 / 覆蓋) and leaves out those of extensions not
// installed; this page then starts again from the library and says what happened.
async function importPack() {
  if (downloading || busy) return null;
  showLocalStatus('');
  $('local-form').hidden = true;
  const result = await window.desktopAPI.importPack();
  if (!result?.ok) {
    if (result && !result.cancelled) showLocalStatus(result.message);
    return result;
  }
  if (result.added.length || result.replaced.length) await restoreFromApp(await window.desktopAPI.getState());
  const lines = [];
  if (result.added.length) lines.push('已匯入：' + result.added.join('、'));
  if (result.replaced.length) lines.push('已覆蓋：' + result.replaced.join('、'));
  if (result.skipped.length) lines.push('略過：' + result.skipped.join('、'));
  if (result.missing.length) lines.push('沒有安裝的擴充功能，其角色已略過：' + result.missing.join('、'));
  showLocalStatus(lines.join('\n') || '角色包裡沒有角色。');
  return result;
}

// ---------- Pictures dropped on the preview ----------
// Pictures dragged from Explorer onto the window are added like a tool's result. With local characters, a menu at
// the drop point asks where, once for all of them: 新角色 (each its own character) or the next expressions of one of
// them. A tool (which takes its own drops) and questions on screen leave drops alone.
const DROPPABLE = /\.(png|webp|svg|gif|jpe?g)$/i;
let droppedFiles = [], dragDepth = 0;

const acceptsDrops = () => !document.body.classList.contains('tool-mode') && $('dialog').hidden && !downloading && !busy;
const carriesFiles = event => [...(event.dataTransfer?.types || [])].includes('Files');

function setDropMenuOpen(open, x = 0, y = 0) {
  const menu = $('drop-menu');
  menu.hidden = !open;
  if (!open) return;
  const locals = [...library.values()].filter(isLocal), item = (label, id) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.onclick = () => { setDropMenuOpen(false); addDropped(id); };
    return button;
  };
  menu.replaceChildren(item('新角色', ''), ...locals.map(entry => item(characterLabel(entry), entry.id)));
  menu.style.left = Math.min(x, innerWidth - menu.offsetWidth - 8) + 'px';
  menu.style.top = Math.min(y, innerHeight - menu.offsetHeight - 8) + 'px';
}

async function addDropped(characterId) {
  const files = droppedFiles;
  droppedFiles = [];
  if (!files.length || !acceptsDrops()) return null;
  if (files.some(file => /\.jpe?g$/i.test(file.name))) {
    const choice = await askOpaque();
    if (choice === 'cancel') return null;
    if (choice !== 'add') return openToolWith(choice, files);
  }
  let answer = null;
  for (const file of files) {
    answer = await window.desktopAPI.addPicture(file.name.replace(/\.[^.]+$/, ''), new Uint8Array(await file.arrayBuffer()), characterId);
    if (!answer?.ok) break;
  }
  await restoreFromApp(await window.desktopAPI.getState());
  if (!answer?.ok) { setLocalOpen(true); showLocalStatus(answer?.message || '無法加入。'); }
  return answer;
}

function setUpDrops() {
  const dropping = on => document.body.classList.toggle('dropping', on);
  document.addEventListener('dragenter', event => { if (carriesFiles(event) && acceptsDrops()) { dragDepth++; dropping(true); } });
  document.addEventListener('dragleave', event => { if (carriesFiles(event) && --dragDepth <= 0) { dragDepth = 0; dropping(false); } });
  document.addEventListener('dragover', event => { if (carriesFiles(event) && acceptsDrops()) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
  document.addEventListener('drop', event => {
    if (!carriesFiles(event) || !acceptsDrops()) return;
    event.preventDefault();
    dragDepth = 0;
    dropping(false);
    const files = [...event.dataTransfer.files];
    droppedFiles = files.filter(file => DROPPABLE.test(file.name));
    if (!droppedFiles.length) { setLocalOpen(true); showLocalStatus('只接受 png、webp、svg、gif、jpg 圖片。'); return; }
    if ([...library.values()].some(isLocal)) setDropMenuOpen(true, event.clientX, event.clientY);
    else addDropped('');
  });
  document.addEventListener('pointerdown', event => { if (!event.target.closest?.('#drop-menu')) setDropMenuOpen(false); });
  window.addEventListener('keydown', event => { if (event.key === 'Escape') setDropMenuOpen(false); });
}

// ---------- Renaming and the folder ----------
function setRenaming(on) {
  $('rename-row').hidden = !on;
  if (!on) return;
  $('rename-input').value = currentEntry().name;
  $('rename-input').select();
}

async function saveRename() {
  const result = await window.desktopAPI.renameLocal(activeId, $('rename-input').value);
  if (!result?.ok) {
    $('errors').textContent = result?.message || '無法改名。';
    return result;
  }
  const entry = currentEntry();
  entry.name = result.name;
  $('character').selectedOptions[0].textContent = characterLabel(entry);
  if (lastOptions) renderLayers(lastOptions.layers || []);
  setRenaming(false);
  return result;
}

function setUpLocalPanel(state) {
  setUpDrops();
  $('local-toggle').onclick = () => setLocalOpen($('local-panel').hidden);
  // With no characters and nothing to download, the file panel starts open.
  if (!library.size && !state.download.available) setLocalOpen(true);
  $('local-pick-file').onclick = () => pickLocal('file');
  $('local-pick-folder').onclick = () => pickLocal('folder');
  $('local-pick-pack').onclick = importPack;
  $('local-help-toggle').onclick = () => {
    const open = $('local-help').hidden;
    $('local-help').hidden = !open;
    $('local-help-toggle').setAttribute('aria-expanded', String(open));
  };
  $('local-form').onsubmit = event => { event.preventDefault(); addLocal(); };
  $('character-rename').onclick = () => setRenaming($('rename-row').hidden);
  $('rename-cancel').onclick = () => setRenaming(false);
  $('rename-row').onsubmit = event => { event.preventDefault(); saveRename(); };
  $('local-open').onclick = () => window.desktopAPI.openLocalFolder(activeId);
}
