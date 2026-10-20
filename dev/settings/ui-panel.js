// UI 設定 (設定 in the app menu; its popup opens where 來源's does): how the settings window looks. The window is
// transparent; 背景透明度 sets how much of what is behind it shows through the dark tint, and 模糊 blurs it (only where
// Windows gives the window its Acrylic glass). Only the background changes; the controls keep their look.
// 還原 › 還原 UI 設定 puts both back to their defaults (an opaque background, 模糊 on).

let uiDefaults = { transparency: 0, blur: true };

function showUi(ui) {
  $('ui-transparency').value = ui.transparency;
  $('ui-transparency-label').textContent = ui.transparency + '%';
  $('ui-blur').checked = ui.blur;
  // The tint: opaque at 0 % (the default), gone at 100 %; at 28 % its edge is .72 and its centre .45, the Acrylic
  // look the window had before.
  const clear = 1 - ui.transparency / 100, style = document.documentElement.style;
  style.setProperty('--tint-edge', clear.toFixed(3));
  style.setProperty('--tint-center', (clear ** 2.43).toFixed(3));
  style.setProperty('--vignette', Math.min(1, clear * .764).toFixed(3));
}

function setSettingsMenuOpen(open) {
  $('settings-menu').hidden = !open;
  $('settings-toggle').setAttribute('aria-expanded', String(open));
}
function setUiOpen(open) {
  $('ui-panel').hidden = !open;
  $('ui-toggle').setAttribute('aria-expanded', String(open));
  // UI 設定 replaces the 設定 submenu it was chosen from.
  if (open) setSettingsMenuOpen(false);
}

function setUpUiPanel(state) {
  uiDefaults = state.uiDefaults || uiDefaults;
  showUi(state.ui || uiDefaults);
  $('ui-blur-field').hidden = !state.glass;
  $('settings-toggle').onclick = () => setSettingsMenuOpen($('settings-menu').hidden);
  $('ui-toggle').onclick = () => setUiOpen($('ui-panel').hidden);
  // The window follows the slider at once; the app keeps the value when it is let go.
  const current = () => ({ transparency: Number($('ui-transparency').value), blur: $('ui-blur').checked });
  $('ui-transparency').oninput = () => showUi(current());
  $('ui-transparency').onchange = async () => showUi(await window.desktopAPI.setUi(current()));
  $('ui-blur').onchange = async () => showUi(await window.desktopAPI.setUi(current()));
  $('reset-ui').onclick = async () => showUi(await window.desktopAPI.resetUi());
  window.addEventListener('keydown', event => { if (event.key === 'Escape') setUiOpen(false); });
}
