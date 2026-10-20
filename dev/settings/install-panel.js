// Desktop shortcut and 解除安裝 (the app's install.cjs). The shortcut is offered once, at the first start, and can be
// made again from 設定 › 桌面捷徑. 還原 › 解除安裝 (also started from Windows' Settings › Apps) asks first; Data, with
// the characters and settings, can be kept. The App then closes and its folder is deleted.

let install = { supported: false };

function showInstall(value) {
  install = value || { supported: false };
  $('shortcut-create').hidden = !install.supported || install.shortcut;
  $('uninstall').hidden = !install.supported;
}

async function offerShortcut() {
  const answer = await askDialog({ message: '要在桌面建立捷徑嗎？', detail: '之後也可以在「設定」裡建立。',
    buttons: [{ label: '不用', value: 'no' }, { label: '建立', value: 'yes', kind: 'primary' }] });
  showInstall(await window.desktopAPI.shortcut(answer.value === 'yes'));
}

async function uninstallApp() {
  const answer = await askDialog({
    title: '解除安裝', message: '要解除安裝角色桌面嗎？',
    detail: install.removable
      ? '桌面捷徑和應用程式清單裡的項目會移除，App 關閉後它的資料夾也會刪除。想留下角色，可以先用「匯出」。'
      : '桌面捷徑和應用程式清單裡的項目會移除。這是開發用的資料夾，檔案不會刪除。',
    checkbox: install.removable ? '保留 Data 資料夾（角色與設定）' : '',
    buttons: [{ label: '取消', value: 'cancel' }, { label: '解除安裝', value: 'ok', kind: 'danger' }]
  });
  if (answer.value !== 'ok') return null;
  const result = await window.desktopAPI.uninstall({ keepData: answer.checked });
  showInstall({ ...install, shortcut: false });
  return result;
}

function setUpInstall(state) {
  showInstall(state.install);
  $('shortcut-create').onclick = async () => {
    showInstall(await window.desktopAPI.shortcut(true));
    $('app-menu-status').textContent = install.shortcut ? '已在桌面建立捷徑' : '無法建立捷徑';
  };
  $('uninstall').onclick = uninstallApp;
  if (state.install?.askUninstall) uninstallApp();
  else if (state.install?.offerShortcut) offerShortcut();
}
