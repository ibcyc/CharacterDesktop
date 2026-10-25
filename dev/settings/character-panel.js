// Character panel (top left), general choices first and finer ones below: character (rename for local characters,
// reset, delete), mirroring for pictures (other kinds place their own switch), the kind's own controls, expression,
// 細部調整 for pictures.
// The app keeps each character's choices in its profile; `profiles` mirrors them on this page.

let profiles = {};
let restoring = false;   // true while the page restores the app's state; nothing is sent back meanwhile

function profileOf(id) { return profiles[id] ??= {}; }
previewHooks.startFor = id => {
  const profile = profiles[id] || {};
  return { look: profile.look ?? null, expression: profile.expression ?? '', mirror: profile.mirror === true, options: profile.options ?? null };
};

// Sends the selection to the app, which shows it on the desktop and remembers the look.
async function publishSelection() {
  syncCharacterControls();
  if (restoring || !ready || !activeId) return;
  const look = activeKind.look();
  if (look) profileOf(activeId).look = look;
  await window.desktopAPI.setSelection({ characterId: activeId, look, expression: $('expression').value });
}

// Mirroring and an extension character's own settings, kept by the app.
async function setMirror(on) {
  if (!activeId) return;
  if (on) profileOf(activeId).mirror = true; else delete profileOf(activeId).mirror;
  activeKind.setMirror(on);
  await window.desktopAPI.setMirror(activeId, on);
}
async function saveCharacterOptions(options) {
  const saved = await window.desktopAPI.setCharacterOptions(activeId, options);
  if (saved) profileOf(activeId).options = saved;
  return saved;
}

// Controls that do not apply are hidden rather than disabled; disabling is kept only while something loads.
function syncCharacterControls() {
  const hasCharacter = !!activeId;
  // Until the first character arrives only the buttons that add characters are offered.
  $('status').hidden = !library.size;
  $('desktop-panel').hidden = !library.size;
  $('character-field').hidden = !library.size;
  $('character-reset').hidden = !hasCharacter;
  $('character-delete').hidden = !hasCharacter;
  $('character-reset').disabled = $('character-delete').disabled = $('character').disabled || downloading;
  $('expression-field').hidden = !hasCharacter || !$('expression').options.length;
  $('mirror-field').hidden = !hasCharacter || kindOf(currentEntry())?.tuning !== true;
  $('mirror-toggle').checked = profiles[activeId]?.mirror === true;
  for (const kind of characterKinds.values()) kind.sync(currentEntry());
  syncTuningControls();
  syncInteraction();
}

// The character menu (a list menu, expression-menu.js): a pin on each character; pinned ones come first.
const PIN = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M15 3l6 6-2 1-3.5 3.5.5 4.5-2 2-4-4-5.5 5.5-1.5-1.5L8.5 14l-4-4 2-2 4.5.5L14.5 5l.5-2z"/></svg>';
let characterMenu = null;
function pinOf(item, option) {
  const pin = document.createElement('button'), on = pinned.has(option.value);
  pin.type = 'button';
  pin.className = 'pin';
  pin.innerHTML = PIN;
  pin.title = pin.ariaLabel = on ? '取消釘選' : '釘選';
  pin.setAttribute('aria-pressed', String(on));
  pin.addEventListener('click', event => { event.stopPropagation(); pinCharacter(option.value, !on); });
  item.classList.toggle('pinned', on);
  item.appendChild(pin);
}
async function pinCharacter(id, on) {
  const pins = await window.desktopAPI.pin(id, on);
  if (pins) loadLibrary([...library.values()], pins);
}

// Both actions are done by the app, which then reloads this page.
async function resetCharacter() {
  const entry = currentEntry();
  if (!entry || downloading) return;
  if (!await confirmDialog('要把「' + entry.name + '」恢復成預設狀態嗎？', { detail: '外觀、表情、高度、鏡像與這個角色的所有設定都會重設。', ok: '恢復預設' })) return;
  await window.desktopAPI.resetCharacter(activeId);
}
async function deleteCharacter() {
  const entry = currentEntry();
  if (!entry || downloading) return;
  const after = isLocal(entry) ? '它的資料夾 Data\\Local\\' + entry.folder + ' 也會一起刪除。' : '刪除後需要重新加入才能再使用。';
  if (!await confirmDialog('要刪除「' + entry.name + '」嗎？', { detail: after, ok: '刪除', danger: true })) return;
  await window.desktopAPI.deleteCharacter(activeId);
}

// 還原 (in the app menu, bottom right). 所有角色設定: every character's settings back to defaults, as if each were
// reset; the characters and their places on the desktop stay. The app reloads this page.
async function resetCharacters() {
  if (downloading) return;
  if (!await confirmDialog('要還原所有角色的設定嗎？', { detail: '每個角色的外觀、表情、高度、鏡像、細部調整與其他設定都會回到預設；角色本身與桌面上的位置保留。', ok: '還原' })) return;
  await window.desktopAPI.resetCharacters();
}
// 完全還原: every character and setting is deleted, as on a fresh install. The app reloads this page.
async function resetAll() {
  if (downloading) return;
  if (!await confirmDialog('要完全還原嗎？', { detail: '所有角色與所有設定都會刪除，App 會回到剛安裝的狀態。\n這個動作無法復原。', ok: '完全還原', danger: true })) return;
  await window.desktopAPI.resetAll();
}

// Loads the library and the current selection from the app (at start and after adding a character).
async function restoreFromApp(state) {
  restoring = true;
  try {
    profiles = structuredClone(state.characters || {});
    activeId = '';
    currentKey = '';
    loadLibrary(state.library || [], state.pinned || []);
    setBusy(false);
    if (library.size) {
      const selection = state.selection || {};
      const id = library.has(String(selection.characterId)) ? String(selection.characterId) : library.keys().next().value;
      const start = previewHooks.startFor(id);
      await selectCharacter(id, id === String(selection.characterId) ? { ...start, look: selection.look, expression: selection.expression } : start);
    }
  } finally {
    restoring = false;
  }
  await publishSelection();
}

function setUpCharacterPanel() {
  document.addEventListener('preview:loaded', publishSelection);
  document.addEventListener('preview:expression', () => {
    // Only an expression picked from the menu is remembered, never a fallback.
    if (activeId) {
      profileOf(activeId).expression = $('expression').value;
      window.desktopAPI.rememberExpression(activeId, $('expression').value);
    }
    publishSelection();
  });
  $('character-delete').onclick = deleteCharacter;
  characterMenu = createExpressionMenu($('character'), { preview: false, decorate: pinOf });
  // Names stay as they are in every language.
  for (const id of ['character', 'character-button', 'character-list']) $(id).translate = false;
  $('mirror-toggle').onchange = event => setMirror(event.target.checked);
  // Right-clicking a character on the desktop edits it here.
  window.desktopAPI.onEditCharacter(id => { if (id !== activeId && library.has(id) && !busy) selectCharacter(id); });
  $('character-reset').onclick = resetCharacter;
  $('reset-all').onclick = resetAll;
  $('reset-settings').onclick = resetCharacters;
  new MutationObserver(syncCharacterControls).observe($('character'), { attributes: true, attributeFilter: ['disabled'] });
}
