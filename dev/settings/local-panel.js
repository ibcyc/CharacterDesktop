// Local characters. The file button (bottom left, under the download button) opens a panel to its right: pick one
// picture or a folder, check what will be taken, name the character and add it, or import a character pack (角色包);
// ? explains the file names. For a local character
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
function showPicked(picked) {
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

async function addLocal() {
  if (downloading || busy) return null;
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
