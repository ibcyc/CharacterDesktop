// Download (bottom left): a round button that opens the URL bar; downloads a character and switches to it, or every
// character of a .txt list (清單). Only extensions download; without one that does, the button is not shown.

let downloading = false;
let list = null;                 // the list being downloaded: { index, total, cancelled }
const LIST_PAUSE_MS = 3000;      // between two characters of a list, to go easy on the websites

function setDownloading(value) {
  downloading = value;
  $('download-toggle').classList.toggle('busy', value);
  $('download-start').disabled = value;
  for (const id of ['local-pick-file', 'local-pick-folder', 'local-add']) $(id).disabled = value;
  $('download-url').disabled = value;
  $('download-cancel').hidden = !value && !list;
  $('download-list').disabled = value || !!list;
  $('download-cancel').disabled = false;
  $('reset-all').disabled = $('reset-settings').disabled = value;
  $('download-progress').classList.toggle('active', value);
  setBusy(value);
  syncCharacterControls();
}

// The panels of the bottom-left dock open to the right of their round buttons, one at a time; Esc closes them.
// Returns whether the panel changed. Extensions use it for their own dock buttons (CharacterDesktop.dockPanel).
function setDockPanel(panel, open) {
  if (panel.hidden === !open) return false;
  if (open) for (const other of document.querySelectorAll('.download-dock .download-panel')) if (other !== panel) setDockPanel(other, false);
  panel.hidden = !open;
  document.querySelector('[aria-controls="' + panel.id + '"]')?.setAttribute('aria-expanded', String(open));
  return true;
}
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') for (const panel of document.querySelectorAll('.download-dock .download-panel')) setDockPanel(panel, false);
});

function setDownloadOpen(open) {
  if (setDockPanel($('download-panel'), open) && open) $('download-url').focus();
}

// ? next to 下載並加入: which websites the installed extensions download from.
function renderDownloadHelp(sources) {
  const help = $('download-help');
  help.replaceChildren('可以下載的網站（擴充功能）：');
  const note = document.createElement('div');
  note.className = 'help-note';
  note.textContent = '清單：選一個 .txt，一行一個網址（# 開頭是註解），會一個一個下載；已經有的角色會跳過。';
  for (const source of sources) {
    const line = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = source.name;
    line.append(name, '：' + source.site + (source.author ? '，著作者 ' + source.author : ''));
    help.appendChild(line);
  }
  help.appendChild(note);
}

// One address; in a list, its messages start with its place in the list and the bar stays open.
const listPrefix = () => list ? '（' + list.index + '/' + list.total + '）' : '';
async function downloadFromURL(url) {
  if (downloading) return { ok: false, message: '已有下載進行中。' };
  setDownloadOpen(true);
  $('download-url').value = url;
  setDownloading(true);
  $('download-progress').value = 0;
  $('download-status').textContent = listPrefix() + '準備下載…';
  let existing = null;   // an already downloaded character to switch to afterwards
  try {
    const result = await window.desktopAPI.download(url);
    // The address bar empties once the character is in the library (new or already there).
    if (result.ok || result.duplicate) $('download-url').value = '';
    if (result.ok) {
      await restoreFromApp(await window.desktopAPI.getState());
      $('download-status').textContent = listPrefix() + '完成：' + result.name + (result.summary ? '，' + result.summary : '') + '，已自動保存並切換角色。';
      $('download-progress').value = 100;
      if (result.warnings?.length) $('errors').textContent = result.warnings.join('\n');
      // The bar closes by itself a moment after a successful download (not while a list goes on).
      if (!list) setTimeout(() => { if (!downloading && !list) setDownloadOpen(false); }, 2500);
    } else {
      $('download-status').textContent = listPrefix() + result.message;
      if (result.duplicate && !list && library.has(result.id) && result.id !== activeId) existing = result.id;
    }
    return result;
  } catch (error) {
    const result = { ok: false, message: error.message || String(error) };
    $('download-status').textContent = result.message;
    return result;
  } finally {
    setDownloading(false);
    if (existing) selectCharacter(existing);
  }
}

// 清單: every address of a .txt (one a line; blank lines, lines starting with # and repeats are left out), one after
// another with a pause between them. Characters already here are skipped at once; 取消 stops the rest.
function linksOf(text) {
  return [...new Set(String(text).split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')))].slice(0, 300);
}
async function downloadList(text) {
  if (downloading || list) return null;
  const links = linksOf(text);
  setDownloadOpen(true);
  if (!links.length) { $('download-status').textContent = '清單裡沒有網址。'; return null; }
  list = { index: 0, total: links.length, cancelled: false };
  const summary = { added: [], existing: [], failed: [], cancelled: false };
  let rested = true;   // no pause before the first character, nor after one that was already here
  try {
    for (const link of links) {
      if (!rested) {
        $('download-cancel').hidden = false;
        $('download-status').textContent = listPrefix() + '稍等一下再下載下一個…';
        for (let waited = 0; waited < LIST_PAUSE_MS && !list.cancelled; waited += 100) await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (list.cancelled) break;
      list.index++;
      const result = await downloadFromURL(link);
      rested = !!result.duplicate;
      if (result.ok) summary.added.push(result.name);
      else if (result.duplicate) summary.existing.push(link);
      else if (result.cancelled) list.cancelled = true;
      else summary.failed.push(link + '：' + result.message);
    }
  } finally {
    summary.cancelled = list.cancelled;
    list = null;
    setDownloading(false);
  }
  $('download-url').value = '';
  $('download-status').textContent = '清單' + (summary.cancelled ? '已取消' : '完成') + '：新增 ' + summary.added.length + ' 個、已經有 ' + summary.existing.length + ' 個、失敗 ' + summary.failed.length + ' 個。';
  if (summary.failed.length) $('errors').textContent = '清單中無法下載：\n' + summary.failed.join('\n');
  return summary;
}

function setUpDownloadPanel(state) {
  $('download-toggle').hidden = !state.download.available;
  if (!state.download.available) return;
  renderDownloadHelp(state.sources.filter(source => source.downloads));
  $('download-help-toggle').onclick = () => {
    const open = $('download-help').hidden;
    $('download-help').hidden = !open;
    $('download-help-toggle').setAttribute('aria-expanded', String(open));
  };
  $('download-toggle').onclick = () => setDownloadOpen($('download-panel').hidden);
  // With no characters yet, the URL bar starts open.
  if (!library.size) setDownloadOpen(true);
  $('download-form').onsubmit = event => { event.preventDefault(); if (!list) downloadFromURL($('download-url').value); };
  $('download-cancel').onclick = () => {
    $('download-cancel').disabled = true;
    $('download-status').textContent = '正在取消…';
    if (list) list.cancelled = true;
    window.desktopAPI.cancelDownload();
  };
  $('download-list').onclick = () => $('download-list-file').click();
  $('download-list-file').onchange = async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (file) downloadList(await file.text());
  };
  window.desktopAPI.onDownloadProgress(progress => {
    $('download-progress').value = progress.percent;
    $('download-status').textContent = listPrefix() + progress.message;
  });
}
