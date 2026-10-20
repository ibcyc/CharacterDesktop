// The title bar's window buttons (top right) are set up here too, so they work whatever else fails to start.
// Bottom right: the red power button (quits the app) and, right of it, the app menu: a round button with three
// lines that opens upward to 來源 (the sources popup), 工具 (the tools extensions bring, tool-host.js), 匯出
// (every character into a .cdpack), 設定 (UI 設定, ui-panel.js), 重啟 (restart the app) and 還原, whose choices open to
// its left: 所有角色設定, 完全還原 and 還原 UI 設定. Esc or a press anywhere else closes it, with its popups and its last
// message.

function setAppMenuOpen(open) {
  $('app-menu').hidden = !open;
  $('app-menu-toggle').setAttribute('aria-expanded', String(open));
  if (open) setGroupsOpen(false);
  else { setSourcesOpen(false); setToolsOpen(false); setResetOpen(false); setSettingsMenuOpen(false); setUiOpen(false); $('app-menu-status').textContent = ''; }
}
function setResetOpen(open) {
  $('reset-menu').hidden = !open;
  $('reset-toggle').setAttribute('aria-expanded', String(open));
}

// 匯出: the app asks where to save the pack and writes it.
async function exportPack() {
  if (downloading) return null;
  $('pack-export').disabled = true;
  $('app-menu-status').textContent = '正在匯出…';
  try {
    const result = await window.desktopAPI.exportPack();
    $('app-menu-status').textContent = result?.ok ? '已匯出 ' + result.count + ' 個角色：' + result.name : result?.cancelled ? '' : result?.message || '無法匯出。';
    return result;
  } finally {
    $('pack-export').disabled = false;
  }
}

function setUpAppMenu() {
  $('app-menu-toggle').onclick = () => setAppMenuOpen($('app-menu').hidden);
  $('pack-export').onclick = exportPack;
  $('reset-toggle').onclick = () => setResetOpen($('reset-menu').hidden);
  // One second level at a time: choosing an item of the menu closes the other items' submenus and popups first.
  const levels = { 'sources-toggle': setSourcesOpen, 'tools-toggle': setToolsOpen, 'settings-toggle': setSettingsMenuOpen, 'reset-toggle': setResetOpen };
  $('app-menu').addEventListener('click', event => {
    const item = event.target.closest('#app-menu > button, #app-menu > .menu-item > button');
    if (!item) return;
    for (const [id, setOpen] of Object.entries(levels)) if (id !== item.id) setOpen(false);
    setUiOpen(false);
  }, true);
  for (const action of ['minimize', 'maximize', 'close']) $('window-' + action).onclick = () => window.desktopAPI.windowAction(action);
  $('relaunch').onclick = () => window.desktopAPI.relaunch();
  $('quit').onclick = () => window.desktopAPI.quit();
  window.addEventListener('keydown', event => { if (event.key === 'Escape') setAppMenuOpen(false); });
  document.addEventListener('pointerdown', event => {
    if (!$('app-menu').hidden && !event.target.closest?.('.app-dock, #sources-panel, #ui-panel')) setAppMenuOpen(false);
  });
}
