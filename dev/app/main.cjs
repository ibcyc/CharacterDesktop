// Main process: owns the character library, the settings and all windows, and answers the pages over IPC.
// Each character on the desktop has its own window; syncPets() derives the windows from the saved state.
// Characters are the user's own pictures (local.cjs). Extensions (extensions.cjs) may add other kinds of characters,
// usually downloaded from a website; without any, the app never goes online.
const { app, BrowserWindow, ipcMain, Tray, nativeImage, screen, dialog, session, nativeTheme, shell } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { createStore } = require('./store.cjs');
const { createPetWindow } = require('./pet-window.cjs');
const { createLocal, isLocal, planFile, planFolder } = require('./local.cjs');
const { loadExtensions } = require('./extensions.cjs');
const pack = require('./pack.cjs');
const profiles = require('./profiles.cjs');

// ---------- Command line and folders ----------
const argValue = name => process.argv.find(arg => arg.startsWith(name + '='))?.slice(name.length + 1);
const selfTest = process.argv.includes('--self-test');
const appRoot = app.isPackaged ? path.dirname(process.execPath) : __dirname;
const dataRoot = argValue('--data-dir') ? path.resolve(argValue('--data-dir')) : path.join(appRoot, 'Data');
const extensionsRoot = argValue('--extensions-dir') ? path.resolve(argValue('--extensions-dir')) : path.join(appRoot, 'Extensions');
const store = createStore(dataRoot);
const local = createLocal(path.join(dataRoot, 'Local'));
const startup = require('./startup.cjs').createStartup(app);
// Desktop shortcut, the entry in Settings › Apps and 解除安裝 (install.cjs). The self-tests use a desktop folder of
// their own and never touch the registry or delete a folder; what would have been done is kept in installCalls.
const installCalls = [];
const install = require('./install.cjs').createInstall({
  app, shell, exe: process.execPath, root: appRoot, version: app.getVersion(),
  ...(selfTest ? {
    desktop: () => { const folder = path.join(path.dirname(dataRoot), 'Desktop'); fs.mkdirSync(folder, { recursive: true }); return folder; },
    run: async (file, args) => { installCalls.push([file, ...args]); return true; },
    removeLater: job => installCalls.push(['remove', job])
  } : {})
});
let askUninstall = process.argv.includes('--uninstall');   // started from Settings › Apps: 解除安裝 is asked
const installState = () => ({
  supported: install.supported, shortcut: install.hasShortcut(), removable: install.removable,
  offerShortcut: install.supported && !selfTest && !state.shortcutAsked && !install.hasShortcut()
});

app.setPath('userData', dataRoot);
app.setPath('sessionData', path.join(dataRoot, 'Chromium'));
app.setPath('crashDumps', path.join(dataRoot, 'CrashDumps'));
app.setAppLogsPath(path.join(dataRoot, 'Logs'));
app.setName('角色桌面');
nativeTheme.themeSource = 'dark';
// Windows 11 22H2+ can show the settings window over a blurred Acrylic backdrop; older systems keep the opaque theme.
const glass = process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621;

// ---------- Library, extensions and settings ----------
// state.selection is the character being edited in the settings page; state.visible shows or hides every character at once.
let library = store.read('library.json', []);
// Each extension gets its own data folder, with Characters/<character id> for its characters' files, and sees only
// its own characters; in the self-tests it must stay offline.
const extensionData = id => path.join(dataRoot, 'Extensions', id);
const charactersOf = id => library.filter(entry => entry.extension === id);
const charactersFolder = id => path.join(extensionData(id), 'Characters');
const { loaded: extensions, problems: extensionProblems } = loadExtensions(extensionsRoot, id => ({
  id, appVersion: app.getVersion(), dataFolder: extensionData(id), charactersFolder: charactersFolder(id), offline: selfTest, library: () => charactersOf(id),
  update: entry => updateCharacter(id, entry), remove: characterId => removeCharacter(id, characterId), log: error => store.log(error)
}));
for (const problem of extensionProblems) store.log(problem);
const extensionOf = entry => entry && !isLocal(entry) ? extensions.find(extension => extension.id === entry.extension) || null : null;
// A character is available when its extension is installed, or (local) while its pictures are there. The others
// stay in the library with their settings, hidden, and come back with their extension or their pictures.
const available = entry => isLocal(entry) ? !entry.missing : !!extensionOf(entry);
const shownLibrary = () => library.filter(available);
const findEntry = id => library.find(entry => String(entry.id) === String(id) && available(entry));
const inLibrary = id => library.some(entry => String(entry.id) === String(id));
// Characters that are pictures use 細部調整: local ones, and those of an extension that says so (tuning: true).
const tunable = entry => isLocal(entry) || extensionOf(entry)?.tuning === true;
// The files an extension keeps for one of its characters; they go with the character, even without the extension.
function removeCharacterFiles(entry) {
  if (isLocal(entry) || !profiles.isId(entry?.extension) || !profiles.isId(entry?.id)) return;
  fs.rmSync(path.join(charactersFolder(entry.extension), String(entry.id)), { recursive: true, force: true });
}

const freshState = () => ({ visible: true, selection: { characterId: '', look: null, expression: '' }, characters: {}, layers: [], pinned: [], groups: [], active: {}, ui: {} });
const uiNow = () => ({ ...profiles.UI_DEFAULTS, ...state.ui });
const state = { ...freshState(), ...profiles.cleanSettings(store.read('settings.json', {})) };

const pets = new Map();   // character id -> its desktop window (pet-window.cjs); stacking order comes from state.layers
let settings = null, tray = null, quitting = false, saveTimer = null, downloadJob = null, lastStack = [], lastRaised = [];
let pendingLocal = null;   // the picture or folder chosen in the file dialog, waiting for a name
let notices = [];          // news for the settings page, shown once (such as characters whose pictures were deleted)
let fileTest = null;       // self-tests: { exportFile, importFile, saveFile } instead of the file dialogs
const profileOf = id => state.characters[String(id)] ??= {};
const desktopOf = id => profileOf(id).desktop ??= profiles.cleanDesktop();
const currentId = () => state.selection.characterId;

// What an extension's character shows, checked by its extension; and the key of the height kept for that look.
const cleanLook = (entry, look) => extensionOf(entry)?.cleanLook?.(entry, look) ?? null;
function lookKeyOf(selection) {
  const entry = findEntry(selection?.characterId);
  return entry && !isLocal(entry) ? String(extensionOf(entry).lookKey?.(entry, selection.look) ?? '0') : '0';
}
// The character being edited shows exactly what the settings page shows; the others show their saved profile.
const selectionOf = id => String(id) === currentId() ? state.selection : profiles.selectionFor(state.characters, findEntry(id), cleanLook);
const heightOf = id => profiles.heightFor(state.characters, id, lookKeyOf(selectionOf(id)));
// An extension character's own settings, checked by its extension.
function optionsOf(id) {
  const entry = findEntry(id), extension = extensionOf(entry);
  return extension?.cleanOptions ? extension.cleanOptions(entry, profileOf(id).options) : null;
}

function rememberPositions() {
  for (const [id, pet] of pets) { const { x, y } = pet.bounds(); Object.assign(desktopOf(id), { x, y }); }
}
function saveSettings() {
  rememberPositions();
  store.write('settings.json', state);
}
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { saveSettings(); } catch (error) { store.log(error); } }, 250);
}

// ---------- Settings window and tray ----------
function safeWindow(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Pages may not navigate on their own; reloads are started from here (see reloadSettings).
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('render-process-gone', (_, details) => store.log(JSON.stringify(details)));
}
const isFrom = (event, win) => !!win && !win.isDestroyed() && event.sender === win.webContents;
const fromSettings = event => isFrom(event, settings);
function petFrom(event) {
  for (const [id, pet] of pets) if (isFrom(event, pet.window)) return { id, pet };
  return null;
}

function showSettings() {
  const reveal = () => { if (!selfTest) { if (settings.isMinimized()) settings.restore(); settings.show(); settings.focus(); } };
  if (settings && !settings.isDestroyed()) { reveal(); return settings; }
  settings = new BrowserWindow({
    width: 1180, height: 1000, minWidth: 850, minHeight: 700, title: 'CharacterDesktop v' + app.getVersion(), show: false,
    // Transparent, with the page's own title bar: what is behind the window shows through its background (UI 設定),
    // blurred where Windows gives the window its Acrylic glass and 模糊 is on.
    frame: false, transparent: true, backgroundColor: '#00000000', ...(glass && uiNow().blur ? { backgroundMaterial: 'acrylic' } : {}),
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  safeWindow(settings);
  settings.setMenu(null);
  // Closing the settings window only hides it; the desktop characters stay.
  settings.on('close', event => { if (!quitting) { event.preventDefault(); settings.hide(); } });
  // Back to the front, perhaps after deleting pictures in Explorer: the library is checked again.
  settings.on('focus', afterLocalCheck);
  settings.webContents.on('did-start-loading', dropQuestions);
  settings.loadFile(path.join(__dirname, 'settings.html'));
  settings.once('ready-to-show', reveal);
  settings.webContents.once('did-finish-load', reveal);
  return settings;
}
const toSettings = (channel, value) => { if (settings && !settings.isDestroyed()) settings.webContents.send(channel, value); };

// Questions to the user are asked by the settings page, in its own style (dialog.js): askInPage resolves with
// { value, checked }, or null when the page reloads or is gone before an answer.
const questions = new Map();
let lastQuestion = 0;
function askInPage(question) {
  if (!settings || settings.isDestroyed()) return Promise.resolve(null);
  return new Promise(resolve => {
    const id = ++lastQuestion;
    questions.set(id, resolve);
    toSettings('desktop:ask', { id, ...question });
  });
}
function dropQuestions() {
  for (const resolve of questions.values()) resolve(null);
  questions.clear();
}

// Reloads the settings page so every control starts again from the saved state.
function reloadSettings() {
  setImmediate(() => { if (settings && !settings.isDestroyed()) settings.webContents.reload(); });
}

// The tray icon, without a menu: a left click hides every character or shows them again, a right click opens the
// settings. Quitting is the power button in the settings window. Its tip says what a left click does now.
function toggleVisible() {
  state.visible = !state.visible;
  publish();
  persist();
}
const trayTip = () => '角色桌面：左鍵' + (state.visible ? '全隱藏' : '恢復顯示') + ' · 右鍵開啟設定';
function updateTray() { if (tray && !tray.isDestroyed()) tray.setToolTip(trayTip()); }
function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'icon.png')));
  updateTray();
  tray.on('click', toggleVisible);
  tray.on('right-click', showSettings);
}

// ---------- Characters on the desktop ----------
// Everything one desktop window needs to draw its character.
function packetFor(id) {
  const entry = findEntry(id) || null;
  return {
    entry, selection: selectionOf(id), options: optionsOf(id), mirror: profiles.mirrorFor(state.characters, id), autoPoke: profiles.autoPokeOf(desktopOf(id)),
    tuning: tunable(entry) ? profiles.tuningFor(state.characters, id) : null, locked: desktopOf(id).locked
  };
}

function createPet(id, slot) {
  const desktop = desktopOf(id);
  const pet = createPetWindow({
    height: heightOf(id),
    savedBounds: Number.isFinite(desktop.x) ? { x: desktop.x, y: desktop.y } : null,
    slot,
    opacity: desktop.opacity,
    preload: path.join(__dirname, 'preload.cjs'),
    page: path.join(__dirname, 'pet.html'),
    safeWindow,
    onMove: persist,
    // Closing a desktop window takes that character off the desktop.
    onCloseRequest() {
      if (quitting) return false;
      desktopOf(id).shown = false;
      publish();
      persist();
      return true;
    }
  });
  pets.set(id, pet);
}

// ---------- Groups (組合) ----------
// A group keeps its members as they were when it was made (profiles.cjs). Out on the desktop (active) its members show
// that way, one row in the layer list at the group's own place, and move together: like a character, where it is
// dropped is its place from now on (other changes while it is out are only for then). Each member's own profile waits
// in the group's `previous` and comes back when the group closes. A character is out with one group at most.
// One group out can be edited at a time (editing): its members are rows of their own in the layer list, to put in
// order; a member can leave the group; 保存 keeps their order and how they are now as the group, ✕ goes back to it.
let editing = null;   // { groupId, order: [members, front first], removed: [members that left] }
const groupOf = id => state.groups.find(group => group.id === String(id)) || null;
const groupKey = group => 'G:' + group.id;
const editingOf = group => editing?.groupId === group.id ? editing : null;
// A group's members now: while it is edited, in the order and without those that left.
const membersOf = group => editingOf(group) ? editing.order : group.members;
const activeGroupOf = id => state.groups.find(group => state.active[group.id] && membersOf(group).includes(String(id))) || null;
const groupMembers = group => membersOf(group).filter(id => findEntry(id));
// A member as the group has it, on the desktop.
function asInGroup(group, id) {
  const profile = structuredClone(group.profiles[id]);
  return { ...profile, desktop: profiles.cleanDesktop({ ...profile.desktop, shown: true }) };
}
const shownMembers = group => groupMembers(group).filter(id => state.characters[id]?.desktop?.shown);
// A character's own profile: while it is out with a group, the one it had before.
const ownProfile = id => (activeGroupOf(id) ? state.active[activeGroupOf(id).id].previous[String(id)] : state.characters[String(id)]) || {};

// What the layer list shows, front first: characters on the desktop by themselves, and groups out (one row each;
// the group being edited as its members, each a row).
function desktopUnits() {
  return state.layers.flatMap(key => {
    if (key.startsWith('G:')) {
      const group = groupOf(key.slice(2));
      if (!group || !state.active[group.id]) return [];
      if (editingOf(group)) return shownMembers(group).map(id => ({ key: id, id, editing: group }));
      return shownMembers(group).length ? [{ key, group }] : [];
    }
    return state.characters[key]?.desktop?.shown && findEntry(key) && !activeGroupOf(key) ? [{ key, id: key }] : [];
  });
}
// The characters on the desktop, front first (a group's members at its place, in its own order).
const onDesktop = () => desktopUnits().flatMap(unit => unit.group ? shownMembers(unit.group) : [unit.id]);

// Windows already out go where the group (or a member's own profile) has them.
function movePets(ids) {
  for (const id of ids) {
    const pet = pets.get(id), desktop = desktopOf(id);
    if (pet && Number.isFinite(desktop.x)) pet.moveTo(desktop.x, desktop.y);
  }
}

// 組合: the characters chosen (two or more, each on the desktop by itself) become a group, which is out at once
// where the frontmost of them was.
function createGroup(name, ids) {
  const chosen = new Set((Array.isArray(ids) ? ids : []).map(String));
  const members = onDesktop().filter(id => chosen.has(id) && !activeGroupOf(id));
  if (members.length < 2 || members.length !== chosen.size) return { ok: false, message: '請選兩個以上在桌面上的角色。' };
  rememberPositions();
  let number = 1;
  while (groupOf('G' + number)) number++;
  const group = {
    id: 'G' + number, name: String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40) || '組合 ' + number, members,
    profiles: Object.fromEntries(members.map(id => [id, profiles.cleanProfile(state.characters[id])]))
  };
  state.groups.push(group);
  state.active[group.id] = { previous: Object.fromEntries(members.map(id => [id, structuredClone(state.characters[id])])) };
  state.layers.splice(Math.max(0, state.layers.findIndex(key => members.includes(key))), 0, groupKey(group));
  publish();
  persist();
  return { ok: true, id: group.id, name: group.name };
}

// A saved group out on the desktop: its members as the group has them, until it closes.
function openGroup(id) {
  const group = groupOf(id);
  if (!group) return { ok: false, message: '找不到這個組合。' };
  if (state.active[group.id]) return { ok: true };
  const members = groupMembers(group), taken = members.map(activeGroupOf).find(Boolean);
  if (!members.length) return { ok: false, message: '這個組合的角色都不在角色清單裡了。' };
  if (taken) return { ok: false, message: '「' + findEntry(members.find(member => activeGroupOf(member) === taken)).name + '」已經在組合「' + taken.name + '」裡，請先關掉那個組合。' };
  rememberPositions();
  state.active[group.id] = { previous: Object.fromEntries(members.map(member => [member, structuredClone(state.characters[member] || {})])) };
  for (const member of members) state.characters[member] = asInGroup(group, member);
  if (!state.layers.includes(groupKey(group))) state.layers.unshift(groupKey(group));
  state.visible = true;
  publish();
  movePets(members);
  persist();
  return { ok: true };
}

// The group goes; each member is again as it was before the group came out (where it was, if it was on the desktop).
// An edit not saved is left.
function closeGroup(id) {
  const group = groupOf(id), active = group && state.active[group.id];
  if (!active) return false;
  if (editingOf(group)) editing = null;
  for (const [member, previous] of Object.entries(active.previous)) if (inLibrary(member)) state.characters[member] = previous;
  delete state.active[group.id];
  publish();
  movePets(Object.keys(active.previous));
  persist();
  return true;
}

function deleteGroup(id) {
  const group = groupOf(id);
  if (!group) return false;
  closeGroup(group.id);
  state.groups = state.groups.filter(item => item !== group);
  state.layers = state.layers.filter(key => key !== groupKey(group));
  publish();
  persist();
  return true;
}

// ✎: the group (brought out if it is not) is edited.
function editGroup(id) {
  const group = groupOf(id);
  if (!group) return { ok: false, message: '找不到這個組合。' };
  if (editing && editing.groupId !== group.id) return { ok: false, message: '請先保存或取消正在編輯的組合「' + groupOf(editing.groupId).name + '」。' };
  const opened = openGroup(group.id);
  if (!opened.ok) return opened;
  editing ??= { groupId: group.id, order: groupMembers(group), removed: [] };
  publish();
  return { ok: true };
}
// 從組合中移除: the member leaves the group being edited and is again as it was before (a group keeps one at least).
function leaveGroup(id) {
  const group = editing && groupOf(editing.groupId), active = group && state.active[group.id];
  if (!active || !editing.order.includes(String(id)) || editing.order.length < 2) return false;
  if (active.previous[id]) state.characters[id] = active.previous[id];
  delete active.previous[id];
  editing.order = editing.order.filter(member => member !== String(id));
  editing.removed.push(String(id));
  publish();
  movePets([String(id)]);
  persist();
  return true;
}
// 保存: the members now (how they are, their order; those that left are gone) become the group; it stays out.
// Members not shown (their extension or pictures gone) stay as the group had them, at their places in its order.
function saveGroupEdit() {
  const group = editing && groupOf(editing.groupId);
  if (!group) return false;
  rememberPositions();
  const members = [...editing.order], kept = { ...group.profiles };
  group.members.forEach((id, index) => { if (!members.includes(id) && !editing.removed.includes(id)) members.splice(index, 0, id); });
  group.members = members;
  group.profiles = Object.fromEntries(members.map(id => [id, editing.order.includes(id) ? profiles.cleanProfile(state.characters[id]) : kept[id]]));
  editing = null;
  publish();
  persist();
  return true;
}
// ✕: the edit is left; members that left come back, and all are again as the group has them.
function cancelGroupEdit() {
  const group = editing && groupOf(editing.groupId), active = group && state.active[group.id];
  if (!active) { editing = null; return false; }
  for (const id of editing.removed) if (findEntry(id)) active.previous[id] = structuredClone(state.characters[id] || {});
  editing = null;
  const members = groupMembers(group);
  for (const member of members) state.characters[member] = asInGroup(group, member);
  publish();
  movePets(members);
  persist();
  return true;
}

// Characters gone from the library (deleted) leave their groups, and a group with nobody left goes. Those only not
// shown (their extension or pictures gone) stay; when they are back, they join their group if it is out.
function pruneGroups() {
  const known = inLibrary;
  for (const group of state.groups) {
    group.members = group.members.filter(known);
    for (const id of Object.keys(group.profiles)) if (!known(id)) delete group.profiles[id];
    for (const id of Object.keys(state.active[group.id]?.previous || {})) if (!known(id)) delete state.active[group.id].previous[id];
  }
  if (editing) {
    editing.order = editing.order.filter(known);
    editing.removed = editing.removed.filter(known);
  }
  for (const group of state.groups.filter(item => !item.members.length)) {
    if (editingOf(group)) editing = null;
    delete state.active[group.id];
    state.layers = state.layers.filter(key => key !== groupKey(group));
  }
  state.groups = state.groups.filter(group => group.members.length);
  for (const group of state.groups) {
    const active = state.active[group.id];
    for (const id of active ? group.members : []) {
      if (!findEntry(id) || active.previous[id] || editingOf(group)?.removed.includes(id)) continue;
      active.previous[id] = structuredClone(state.characters[id] || {});
      state.characters[id] = asInGroup(group, id);
      if (editingOf(group) && !editing.order.includes(id)) editing.order.push(id);
    }
  }
}

// The groups for the settings page: their members in the list (an extension's not installed are left out).
const groupsForSettings = () => state.groups.filter(group => groupMembers(group).length).map(group => ({ id: group.id, name: group.name, members: groupMembers(group), active: !!state.active[group.id] }));

// Windows lower in the list are raised first, so the first character ends up in front.
// Raising a window that overlaps one in front of it shows it on top for a moment, so the front one flickers.
// The regular re-stack (gentle) therefore leaves those windows where they are; their place under the front ones
// does not change by itself. Changes of order, showing and dragging use the full re-stack.
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
function stackPets({ gentle = false } = {}) {
  lastStack = onDesktop().filter(id => pets.has(id));
  const covered = (id, index) => lastStack.slice(0, index).some(front => overlap(pets.get(id).bounds(), pets.get(front).bounds()));
  lastRaised = lastStack.filter((id, index) => !gentle || !covered(id, index));
  for (const id of [...lastRaised].reverse()) pets.get(id).pin();
}

// Makes the windows match the state: one per character on the desktop, each with its look's height and its opacity.
function syncPets() {
  state.layers = profiles.layerOrder(state.layers, state.characters, state.groups.map(group => group.id));
  const shown = onDesktop();
  for (const [id, pet] of pets) if (!shown.includes(id)) { pet.close(); pets.delete(id); }
  shown.forEach((id, slot) => { if (!pets.has(id)) createPet(id, slot); });
  for (const [id, pet] of pets) {
    pet.resize(heightOf(id));
    pet.setOpacity(desktopOf(id).opacity);
    // The packet may carry the character's model data, so it goes out only when something in it changed.
    const packet = packetFor(id), key = JSON.stringify({ ...packet, entry: packet.entry ? [packet.entry.id, packet.entry.name] : null });
    if (key !== pet.sentPacket) { pet.window.webContents.send('desktop:character', packet); pet.sentPacket = key; }
    if (state.visible && pet.ready && !selfTest) { if (!pet.isVisible()) pet.show(); }
    else if (pet.isVisible()) pet.hide();
  }
  stackPets();
}

// The tallest a character can stand: as tall as the tallest display's work area.
const heightLimit = () => Math.min(profiles.MAX_HEIGHT, Math.max(...screen.getAllDisplays().map(display => display.workArea.height)));

// What the settings page shows for the character being edited, plus the layer list.
function desktopOptions() {
  const id = currentId(), desktop = profiles.desktopFor(state.characters, id);
  return {
    height: heightOf(id), heightLimit: heightLimit(), opacity: desktop.opacity, autoPoke: profiles.autoPokeOf(desktop),
    visible: !!id && desktop.shown && state.visible, locked: desktop.locked,
    layers: desktopUnits().map(unit => unit.editing ? { id: unit.id, locked: desktopOf(unit.id).locked, editing: true } : unit.group
      ? { id: unit.key, group: true, name: unit.group.name, locked: shownMembers(unit.group).every(id => desktopOf(id).locked), members: shownMembers(unit.group).map(id => ({ id, locked: desktopOf(id).locked })) }
      : { id: unit.id, locked: desktopOf(unit.id).locked }),
    groups: groupsForSettings(),
    editing: editing && { id: editing.groupId, name: groupOf(editing.groupId).name, members: groupMembers(groupOf(editing.groupId)) }
  };
}

// Brings the windows in line with the state and tells the settings page.
function publish() {
  syncPets();
  updateTray();
  toSettings('desktop:options', desktopOptions());
}

// The settings page's choice for the character being edited: its look (checked by its extension) and expression.
function setSelection(value) {
  const id = String(value?.characterId || ''), entry = findEntry(id);
  if (!entry) return;
  const look = isLocal(entry) ? null : cleanLook(entry, value.look);
  const expression = isLocal(entry) ? (entry.files[value.expression] ? String(value.expression) : '0') : profiles.expressionId(String(value.expression ?? ''));
  state.selection = { characterId: id, look, expression };
  if (look) profileOf(id).look = look;
  publish();
  persist();
}

// Changes from the settings page apply to the character being edited.
function setOptions(options = {}) {
  const id = currentId();
  if (!id) return desktopOptions();
  const desktop = desktopOf(id), pet = pets.get(id);
  if (Number.isFinite(options.height)) {
    // The height belongs to the look on screen; without a window it is only limited to the primary display.
    const height = pet ? pet.resize(options.height) : Math.min(profiles.clampHeight(options.height), screen.getPrimaryDisplay().workArea.height);
    (profileOf(id).heights ??= {})[lookKeyOf(state.selection)] = height;
  }
  if (Number.isFinite(options.opacity)) desktop.opacity = profiles.clampOpacity(options.opacity);
  if (Number.isFinite(options.autoPoke)) {
    const seconds = profiles.cleanAutoPoke(options.autoPoke);
    if (seconds === profiles.AUTO_POKE_DEFAULT) delete desktop.autoPoke; else desktop.autoPoke = seconds;
  }
  if (typeof options.locked === 'boolean') desktop.locked = options.locked;
  if (typeof options.visible === 'boolean') {
    desktop.shown = options.visible;
    if (options.visible) state.visible = true;
  }
  if (options.resetPosition) {
    desktop.shown = true;
    state.visible = true;
    if (pet) pet.moveHome(onDesktop().indexOf(id)); else { delete desktop.x; delete desktop.y; }
  }
  persist();
  publish();
  return desktopOptions();
}

// Right-clicking a desktop character edits that character in the settings page.
function editFromDesktop(id) {
  if (id !== currentId()) {
    state.selection = profiles.selectionFor(state.characters, findEntry(id), cleanLook);
    publish();
  }
  showSettings();
  toSettings('desktop:edit-character', id);
}

// ---------- Library changes ----------
function saveLibrary(next) {
  library = next;
  state.characters = profiles.keepProfilesFor(state.characters, library);
  state.pinned = state.pinned.filter(id => library.some(entry => String(entry.id) === id));
  pruneGroups();
  try { store.write('library.json', library); } catch (error) { store.log(error); throw new Error('無法儲存角色庫，請將 App 放到可寫入的資料夾。'); }
  if (!findEntry(currentId())) state.selection = profiles.selectionFor(state.characters, shownLibrary()[0], cleanLook);
  publish();
  persist();
}

// An extension changing its own characters (context.update / context.remove): an entry replaced under the same id,
// or a character removed as if deleted (its profile, its place in the layers and its files go).
function updateCharacter(extensionId, entry) {
  const old = library.find(item => item.extension === extensionId && String(item.id) === String(entry?.id));
  if (!old) return false;
  saveLibrary(library.map(item => item === old ? { ...entry, id: old.id, extension: extensionId } : item));
  return true;
}
function removeCharacter(extensionId, id) {
  const old = library.find(item => item.extension === extensionId && String(item.id) === String(id));
  if (!old) return false;
  saveLibrary(library.filter(item => item !== old));
  removeCharacterFiles(old);
  return true;
}

// A new character goes into the library, becomes the one being edited and appears on the desktop.
function addToLibrary(entry) {
  library = [...library, entry];
  store.write('library.json', library);
  state.selection = profiles.selectionFor(state.characters, entry, cleanLook);
  desktopOf(entry.id).shown = true;
  state.visible = true;
  publish();
  saveSettings();
}

// ---------- Downloading (extensions) ----------
const downloaders = () => extensions.filter(extension => typeof extension.handles === 'function' && typeof extension.download === 'function');
// A character already in the library is not downloaded again; the page switches to it instead.
const alreadyDownloaded = entry => ({ ok: false, duplicate: true, id: String(entry.id), message: '「' + entry.name + '」已經在角色庫裡了，不需要重新下載。' });

async function startDownload(url) {
  if (downloadJob) return { ok: false, message: '已有下載進行中，請等待或取消後重試。' };
  const extension = downloaders().find(item => item.handles(url));
  if (!extension) return { ok: false, message: '沒有可以下載這個網址的擴充功能。' };
  // Checked before anything is fetched: the same address as a character already downloaded.
  const known = extension.downloadedEntry?.(charactersOf(extension.id), url);
  if (known) return alreadyDownloaded(known);
  const controller = new AbortController();
  downloadJob = { controller };
  const progress = value => toSettings('desktop:download-progress', value);
  try {
    const result = await extension.download({ url, signal: controller.signal, progress });
    const entry = { ...result.entry, extension: extension.id };
    // Checked again by id, in case another address led to the same character; nothing is saved then.
    const same = library.find(item => String(item.id) === String(entry.id));
    if (same) return alreadyDownloaded(same);
    addToLibrary(entry);
    return { ok: true, name: entry.name, summary: result.summary || '', warnings: result.warnings || [] };
  } catch (error) {
    store.log(error);
    const cancelled = controller.signal.aborted;
    return { ok: false, cancelled, message: cancelled ? '已取消下載，原有角色庫保持不變。' : String(error.message || error) };
  } finally {
    downloadJob = null;
  }
}

// ---------- Local characters ----------
// Pictures deleted outside the app (in Explorer): checked at start, whenever the settings window comes back to the
// front and when a picture cannot be read. A missing picture leaves its expression; with its default picture or
// folder missing the character is hidden (missing), its settings and groups kept, until they are back. Returns
// whether anything changed; the caller publishes.
function checkLocalFiles() {
  const gone = [];
  let changed = false;
  const next = library.map(entry => {
    if (!isLocal(entry)) return entry;
    const { missing, ...known } = entry, checked = local.check(known);
    if (!checked) {
      if (!missing) { gone.push(entry.name); changed = true; }
      return { ...known, missing: true };
    }
    if (missing || Object.keys(checked.files).length !== Object.keys(entry.files).length) changed = true;
    return checked;
  });
  if (!changed) return false;
  library = next;
  pruneGroups();
  store.write('library.json', library);
  const current = findEntry(currentId());
  if (!current) state.selection = profiles.selectionFor(state.characters, shownLibrary()[0], cleanLook);
  else if (isLocal(current) && !current.files[state.selection.expression]) state.selection = { ...state.selection, expression: '0' };
  if (gone.length) notices.push('「' + gone.join('」、「') + '」的圖片不見了，放回來以前不會顯示。');
  persist();
  return true;
}
// After such a change the windows follow and the settings page starts again from the library as it is now.
function afterLocalCheck() {
  if (!checkLocalFiles()) return;
  publish();
  reloadSettings();
}

// The file dialog picks a picture or a folder; it is checked at once and waits for a name (addLocal).
async function pickLocal(kind) {
  if (selfTest) return { ok: false, message: 'self-test: no file dialog' };
  const folder = kind === 'folder';
  const result = await dialog.showOpenDialog(settings, folder
    ? { title: '選擇角色資料夾', properties: ['openDirectory'] }
    : { title: '選擇角色圖片', properties: ['openFile'], filters: [{ name: '圖片', extensions: ['png', 'webp', 'svg', 'gif'] }] });
  if (result.canceled || !result.filePaths[0]) return { ok: false, cancelled: true };
  return stageLocal(kind, result.filePaths[0]);
}
function stageLocal(kind, from) {
  pendingLocal = null;
  try {
    const plan = kind === 'folder' ? planFolder(from) : planFile(from);
    pendingLocal = { kind: kind === 'folder' ? 'folder' : 'file', from };
    return { ok: true, kind: pendingLocal.kind, label: path.basename(from), skipped: plan.skipped };
  } catch (error) {
    return { ok: false, message: String(error.message || error) };
  }
}
function addLocal(name) {
  if (!pendingLocal) return { ok: false, message: '請先選擇圖片或資料夾。' };
  try {
    const { entry, skipped } = local.add(library, { ...pendingLocal, name });
    pendingLocal = null;
    addToLibrary(entry);
    return { ok: true, id: entry.id, name: entry.name, expressions: Object.keys(entry.files).length - 1, skipped };
  } catch (error) {
    store.log(error);
    return { ok: false, message: String(error.message || error) };
  }
}

// ---------- Character packs (匯出 / 匯入) ----------
// A pack holds every character in the list (not those of an extension that is not installed), each with its files
// and its settings, everything but its place on the desktop (shown, position, opacity, lock, layer).
// A character's files: a local character's pictures, or what its extension keeps for it (Characters/<id>).
function filesOf(entry) {
  const folder = isLocal(entry) ? local.folderOf(entry)
    : profiles.isId(entry.extension) && profiles.isId(entry.id) ? path.join(charactersFolder(entry.extension), String(entry.id)) : null;
  const files = [];
  const walk = (dir, prefix) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.isDirectory()) walk(path.join(dir, item.name), prefix + item.name + '/');
      else if (item.isFile()) files.push({ name: prefix + item.name, data: fs.readFileSync(path.join(dir, item.name)) });
    }
  };
  if (folder && fs.existsSync(folder)) walk(folder, '');
  return files;
}
function withoutDesktop(profile) {
  const { desktop, ...rest } = profiles.cleanProfile(profile || {});
  return rest;
}

async function exportPack() {
  if (downloadJob) return { ok: false, message: '下載進行中，請稍後再匯出。' };
  if (!shownLibrary().length) return { ok: false, message: '沒有角色可以匯出。' };
  let file = fileTest?.exportFile;
  if (!file) {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const result = await dialog.showSaveDialog(settings, { title: '匯出角色', defaultPath: path.join(app.getPath('documents'), '角色-' + day + '.cdpack'), filters: [{ name: '角色包', extensions: ['cdpack'] }] });
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
    file = result.filePath;
  }
  try {
    rememberPositions();
    const data = pack.buildPack({ appVersion: app.getVersion(), characters: shownLibrary().map(entry => ({ entry, profile: withoutDesktop(ownProfile(entry.id)), files: filesOf(entry) })) });
    fs.writeFileSync(file + '.partial', data);
    fs.renameSync(file + '.partial', file);
    return { ok: true, file, name: path.basename(file), count: shownLibrary().length };
  } catch (error) {
    store.log(error);
    fs.rmSync(file + '.partial', { force: true });
    return { ok: false, message: '無法匯出：' + (error.message || error) };
  }
}

// A character already in the library (the same id; for a local one, the same name): 跳過 or 覆蓋, optionally for
// every further one.
async function askAboutExisting(name) {
  const answer = await askInPage({
    title: '匯入角色', message: '「' + name + '」已經在角色庫裡了。', detail: '覆蓋：換成角色包裡的圖片與設定（桌面上的顯示與位置保持不變）。',
    buttons: [{ label: '跳過', value: 'skip' }, { label: '覆蓋', value: 'overwrite', kind: 'primary' }], checkbox: '之後遇到的都這樣處理'
  });
  return { choice: answer?.value === 'overwrite' ? 'overwrite' : 'skip', rest: !!answer?.checked };
}

// A local character from a pack: its pictures are checked like a folder the user adds (local.add).
function importLocal(entry, files, replacing) {
  const temp = path.join(dataRoot, 'Import-' + process.pid);
  fs.rmSync(temp, { recursive: true, force: true });
  fs.mkdirSync(temp, { recursive: true });
  try {
    for (const file of files) if (!file.name.includes('/')) fs.writeFileSync(path.join(temp, file.name), file.data);
    return local.add(library, { kind: 'folder', from: temp, name: entry.name }, replacing).entry;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
// An extension's character: its entry as it was, its files back in Characters/<id>.
function importExtension(entry, files) {
  const folder = path.join(charactersFolder(entry.extension), String(entry.id)), partial = folder + '.import';
  fs.rmSync(partial, { recursive: true, force: true });
  try {
    for (const file of files) {
      const target = path.join(partial, ...file.name.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.data);
    }
    fs.rmSync(folder, { recursive: true, force: true });
    if (fs.existsSync(partial)) fs.renameSync(partial, folder);
  } catch (error) {
    fs.rmSync(partial, { recursive: true, force: true });
    throw error;
  }
  return { ...entry, id: String(entry.id) };
}

async function importPack() {
  if (downloadJob) return { ok: false, message: '下載進行中，請稍後再匯入。' };
  let file = fileTest?.importFile;
  if (!file) {
    const result = await dialog.showOpenDialog(settings, { title: '匯入角色包', properties: ['openFile'], filters: [{ name: '角色包', extensions: ['cdpack'] }] });
    if (result.canceled || !result.filePaths[0]) return { ok: false, cancelled: true };
    file = result.filePaths[0];
  }
  let characters;
  try {
    if (fs.statSync(file).size > 4 * 1024 * 1024 * 1024) throw new Error('角色包太大。');
    ({ characters } = pack.readPack(fs.readFileSync(file)));
  } catch (error) {
    return { ok: false, message: String(error.message || error) };
  }
  const added = [], replaced = [], skipped = [], missing = new Set(), imported = [];
  let forAll = null;
  for (const { entry, profile, files } of characters) {
    const name = String(entry.name || entry.id).slice(0, 40);
    let same;
    if (isLocal(entry)) {
      same = library.find(item => isLocal(item) && item.name === String(entry.name || '').replace(/\s+/g, ' ').trim());
    } else {
      if (!profiles.isId(entry.id) || !profiles.isId(entry.extension)) { skipped.push(name + '（資料不正確）'); continue; }
      // Characters of an extension that is not installed are left out without asking.
      if (!extensions.some(extension => extension.id === entry.extension)) { missing.add(entry.extension); continue; }
      same = library.find(item => String(item.id) === String(entry.id));
    }
    if (same) {
      const answer = forAll ?? await askAboutExisting(name);
      if (answer.rest) forAll = answer;
      if (answer.choice !== 'overwrite') { skipped.push(name + '（已經有了）'); continue; }
    }
    try {
      const saved = isLocal(entry) ? importLocal(entry, files, same && isLocal(same) ? same : null) : importExtension(entry, files);
      library = same ? library.map(item => item === same ? saved : item) : [...library, saved];
      // Its settings from the pack; its place on the desktop stays as it is here (a new one starts off the desktop).
      state.characters[String(saved.id)] = { ...withoutDesktop(profile), desktop: profiles.cleanDesktop(same ? state.characters[String(same.id)]?.desktop : null) };
      (same ? replaced : added).push(saved.name);
      imported.push(String(saved.id));
    } catch (error) {
      store.log(error);
      skipped.push(name + '（' + (error.message || error) + '）');
    }
  }
  if (imported.length) {
    store.write('library.json', library);
    const first = findEntry(imported[0]);
    if (first) state.selection = profiles.selectionFor(state.characters, first, cleanLook);
    publish();
    saveSettings();
  }
  return { ok: true, added, replaced, skipped, missing: [...missing] };
}

// The pages only ever see the characters in the list, with their settings.
function shownProfiles() {
  return Object.fromEntries(shownLibrary().filter(entry => state.characters[String(entry.id)]).map(entry => [String(entry.id), state.characters[String(entry.id)]]));
}
function stateForSettings() {
  return {
    version: app.getVersion(), library: shownLibrary(), selection: state.selection, characters: shownProfiles(),
    pinned: state.pinned.filter(id => findEntry(id)),
    options: desktopOptions(), startup: startup.get(),
    download: { available: downloaders().length > 0, running: !!downloadJob },
    sources: extensions.map(extension => ({ id: extension.id, name: extension.name, site: extension.site, author: extension.author, credits: extension.credits, downloads: downloaders().includes(extension) })),
    extensionProblems,
    tuning: { defaults: profiles.TUNING_DEFAULTS, limits: profiles.TUNING_LIMITS },
    ui: uiNow(), uiDefaults: profiles.UI_DEFAULTS, glass
  };
}

// ---------- IPC: settings page ----------
const fromKnownCharacter = (event, id) => fromSettings(event) && !!findEntry(id);
const fromKnownLocal = (event, id) => fromSettings(event) && isLocal(findEntry(id));

// The settings page also takes the news waiting for it (each shown once).
ipcMain.handle('desktop:state', event => {
  if (petFrom(event)) return stateForSettings();
  if (!fromSettings(event)) return null;
  const asked = askUninstall;
  askUninstall = false;
  return { ...stateForSettings(), notices: notices.splice(0), install: { ...installState(), askUninstall: asked } };
});
// Extensions: the scripts, styles and markup their parts of a page need, and the functions those parts may call.
ipcMain.handle('desktop:extension-pages', (event, page) => {
  if ((!fromSettings(event) && !petFrom(event)) || !['settings', 'pet'].includes(page)) return [];
  return extensions.map(extension => extension.pages[page]);
});
ipcMain.handle('desktop:extension-call', async (event, id, name, args) => {
  if (!fromSettings(event) && !petFrom(event)) return null;
  const call = extensions.find(extension => extension.id === id)?.pageCalls?.[name];
  return typeof call === 'function' ? call(...(Array.isArray(args) ? args : [])) : null;
});
ipcMain.handle('desktop:startup', (event, enabled) => {
  if (!fromSettings(event)) return { ok: false, message: '請從設定畫面操作。' };
  try { return { ok: true, ...startup.set(enabled) }; } catch (error) { store.log(error); return { ok: false, message: error.message }; }
});
ipcMain.handle('desktop:download', (event, url) => fromSettings(event) ? startDownload(url) : { ok: false, message: '請從主畫面下載。' });
ipcMain.handle('desktop:cancel-download', event => { if (fromSettings(event)) downloadJob?.controller.abort(); return true; });
ipcMain.handle('desktop:selection', (event, value) => { if (fromSettings(event)) setSelection(value); return true; });
ipcMain.handle('desktop:options', (event, value) => fromSettings(event) ? setOptions(value) : null);
ipcMain.handle('desktop:layers', (event, order) => {
  if (!fromSettings(event) || !Array.isArray(order)) return null;
  // Only a reordering of the rows on the desktop (characters and groups) is accepted; the others keep their places.
  const keys = order.map(String), units = desktopUnits(), shown = units.map(unit => unit.key);
  if (keys.length !== shown.length || !shown.every(key => keys.includes(key))) return null;
  // The rows of the group being edited set its members' order; the group's place is where its first one now is.
  const edited = units.find(unit => unit.editing)?.editing, asUnit = key => edited && editing.order.includes(key) ? groupKey(edited) : key;
  if (edited) {
    const members = keys.filter(key => editing.order.includes(key));
    editing.order = [...members, ...editing.order.filter(id => !members.includes(id))];
  }
  const before = [...new Set(shown.map(asUnit))], after = [...new Set(keys.map(asUnit))];
  let next = 0;
  state.layers = state.layers.map(key => before.includes(key) ? after[next++] : key);
  publish();
  persist();
  return desktopOptions();
});
// Groups: make, bring out, delete, and edit (✎, 從組合中移除, 保存, ✕).
ipcMain.handle('desktop:group-create', (event, name, ids) => fromSettings(event) ? createGroup(name, ids) : null);
ipcMain.handle('desktop:group-open', (event, id) => fromSettings(event) ? openGroup(id) : null);
ipcMain.handle('desktop:group-delete', (event, id) => fromSettings(event) ? deleteGroup(id) : false);
ipcMain.handle('desktop:group-edit', (event, id) => fromSettings(event) ? editGroup(id) : null);
ipcMain.handle('desktop:group-leave', (event, id) => fromSettings(event) && leaveGroup(id));
ipcMain.handle('desktop:group-save', event => fromSettings(event) && saveGroupEdit());
ipcMain.handle('desktop:group-cancel', event => fromSettings(event) && cancelGroupEdit());
// A pin on a character in the character menu: pinned characters come first.
ipcMain.handle('desktop:pin', (event, id, pinned) => {
  if (!fromKnownCharacter(event, id) || typeof pinned !== 'boolean') return null;
  state.pinned = state.pinned.filter(item => item !== String(id));
  if (pinned) state.pinned.push(String(id));
  persist();
  return state.pinned.filter(item => findEntry(item));
});
ipcMain.handle('desktop:layer-lock', (event, id, locked) => {
  const group = String(id).startsWith('G:') && groupOf(String(id).slice(2));
  if (!(group ? fromSettings(event) && state.active[group.id] : fromKnownCharacter(event, id)) || typeof locked !== 'boolean') return null;
  // A group's lock locks (or frees) every member.
  for (const member of group ? shownMembers(group) : [id]) desktopOf(member).locked = locked;
  publish();
  persist();
  return desktopOptions();
});
// The close button on a layer row: takes that character off the desktop, like its show/hide switch; a group closes.
ipcMain.handle('desktop:layer-close', (event, id) => {
  const group = String(id).startsWith('G:') && groupOf(String(id).slice(2));
  if (group) {
    if (!fromSettings(event)) return null;
    closeGroup(group.id);
    return desktopOptions();
  }
  if (!fromKnownCharacter(event, id)) return null;
  desktopOf(id).shown = false;
  publish();
  persist();
  return desktopOptions();
});
// The memory the app uses now, summed over all its processes, in MB.
ipcMain.handle('desktop:usage', event => {
  if (!isFrom(event, settings)) return null;
  const metrics = app.getAppMetrics();
  const kilobytes = metrics.reduce((sum, item) => sum + (item.memory.privateBytes ?? item.memory.workingSetSize ?? 0), 0);
  return { memoryMB: Math.round(kilobytes / 1024) };
});
ipcMain.handle('desktop:remember-expression', (event, id, expression) => {
  if (!fromKnownCharacter(event, id) || !profiles.expressionId(String(expression))) return false;
  profileOf(id).expression = String(expression);
  persist();
  return true;
});
ipcMain.handle('desktop:mirror', (event, id, mirror) => {
  if (!fromKnownCharacter(event, id) || typeof mirror !== 'boolean') return false;
  if (mirror) profileOf(id).mirror = true; else delete profileOf(id).mirror;
  persist();
  publish();
  return mirror;
});
// An extension character's own settings, checked by its extension.
ipcMain.handle('desktop:character-options', (event, id, value) => {
  const entry = findEntry(id), extension = extensionOf(entry);
  if (!fromSettings(event) || !extension?.cleanOptions || !value || typeof value !== 'object') return null;
  profileOf(id).options = extension.cleanOptions(entry, value);
  persist();
  publish();
  return profileOf(id).options;
});
// Local characters: choosing, adding, renaming, opening the folder, fine-tuning, and their pictures for the pages.
ipcMain.handle('desktop:local-pick', (event, kind) => fromSettings(event) ? pickLocal(kind) : null);
// A picture made on the page (PNG bytes, such as a tool's result) becomes a local character, like a single picture,
// or with `characterId` the next expression of that local character, which is then shown with it.
ipcMain.handle('desktop:add-picture', (event, name, data, characterId) => {
  if (!fromSettings(event) || !(data instanceof Uint8Array) || downloadJob) return { ok: false, message: '無法加入。' };
  const into = characterId ? findEntry(characterId) : null;
  if (characterId && !isLocal(into)) return { ok: false, message: '找不到這個角色。' };
  const temp = path.join(dataRoot, 'Import-' + process.pid), file = path.join(temp, 'd.png');
  try {
    fs.mkdirSync(temp, { recursive: true });
    fs.writeFileSync(file, data);
    if (into) {
      const { entry, expression } = local.addExpression(into, file);
      library = library.map(item => item === into ? entry : item);
      store.write('library.json', library);
      state.selection = { characterId: String(entry.id), look: null, expression };
      profileOf(entry.id).expression = expression;
      publish();
      persist();
      return { ok: true, id: entry.id, name: entry.name, expression };
    }
    const { entry } = local.add(library, { kind: 'file', from: file, name });
    addToLibrary(entry);
    return { ok: true, id: entry.id, name: entry.name };
  } catch (error) {
    store.log(error);
    return { ok: false, message: String(error.message || error) };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
// A file made on the page (such as a tool's PNG), saved where the user chooses.
ipcMain.handle('desktop:save-file', async (event, name, data) => {
  if (!fromSettings(event) || !(data instanceof Uint8Array)) return { ok: false };
  const extension = path.extname(String(name)).slice(1).toLowerCase() || 'png';
  let file = fileTest?.saveFile;
  if (!file) {
    const result = await dialog.showSaveDialog(settings, { defaultPath: path.join(app.getPath('downloads'), String(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120)), filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
    file = result.filePath;
  }
  try {
    fs.writeFileSync(file, data);
    return { ok: true, file, name: path.basename(file) };
  } catch (error) {
    store.log(error);
    return { ok: false, message: '無法儲存：' + (error.message || error) };
  }
});
ipcMain.handle('desktop:pack-export', event => fromSettings(event) ? exportPack() : null);
ipcMain.handle('desktop:answer', (event, id, answer) => {
  if (!fromSettings(event)) return false;
  questions.get(id)?.(answer && typeof answer === 'object' ? { value: String(answer.value), checked: answer.checked === true } : null);
  questions.delete(id);
  return true;
});
ipcMain.handle('desktop:pack-import', event => fromSettings(event) ? importPack() : null);
ipcMain.handle('desktop:local-add', (event, name) => fromSettings(event) ? addLocal(name) : null);
ipcMain.handle('desktop:local-rename', (event, id, name) => {
  if (!fromKnownLocal(event, id)) return { ok: false };
  try {
    const renamed = local.rename(findEntry(id), name);
    library = library.map(entry => entry.id === renamed.id ? renamed : entry);
    store.write('library.json', library);
    publish();
    return { ok: true, name: renamed.name };
  } catch (error) {
    return { ok: false, message: String(error.message || error) };
  }
});
ipcMain.handle('desktop:local-open', (event, id) => {
  if (!fromKnownLocal(event, id)) return { ok: false };
  const folder = local.folderOf(findEntry(id));
  // The self-tests never open Explorer.
  if (!selfTest) shell.openPath(folder);
  return { ok: true, folder };
});
ipcMain.handle('desktop:local-image', (event, id, expression) => {
  const entry = findEntry(id);
  if ((!fromSettings(event) && petFrom(event)?.id !== String(id)) || !isLocal(entry)) return null;
  try { return local.read(entry, expression); } catch (error) { store.log(error); setImmediate(afterLocalCheck); return null; }
});
ipcMain.handle('desktop:tuning', (event, id, value) => {
  if (!fromKnownCharacter(event, id) || !tunable(findEntry(id)) || !value || typeof value !== 'object') return null;
  profileOf(id).tuning = profiles.cleanTuning(value);
  persist();
  publish();
  return profileOf(id).tuning;
});
ipcMain.handle('desktop:delete-character', (event, id) => {
  if (!fromSettings(event) || downloadJob) return false;
  const entry = findEntry(id);
  if (!entry) return false;
  saveLibrary(library.filter(item => item !== entry));
  // A local character's folder goes with it, and so do the files an extension keeps for its character.
  if (isLocal(entry)) local.remove(entry); else removeCharacterFiles(entry);
  reloadSettings();
  return true;
});
// 重置並清空全部: back to a fresh install. No characters, default settings, and not started with Windows.
// Every extension's character files go too, also those of extensions no longer installed. Installed extensions and
// the rest of their data (such as a downloaded player) stay: they are part of the app.
ipcMain.handle('desktop:reset-all', event => {
  if (!fromSettings(event) || downloadJob) return false;
  for (const pet of pets.values()) pet.close();
  pets.clear();
  library = [];
  pendingLocal = null;
  local.removeAll();
  const extensionsData = path.join(dataRoot, 'Extensions');
  if (fs.existsSync(extensionsData)) {
    for (const item of fs.readdirSync(extensionsData, { withFileTypes: true })) {
      if (item.isDirectory()) fs.rmSync(charactersFolder(item.name), { recursive: true, force: true });
    }
  }
  editing = null;
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, freshState());
  clearTimeout(saveTimer);
  try {
    store.write('library.json', library);
    saveSettings();
  } catch (error) { store.log(error); }
  // The self-tests never touch the real Windows login item.
  if (!selfTest) { try { if (startup.get().enabled) startup.set(false); } catch (error) { store.log(error); } }
  publish();
  reloadSettings();
  return true;
});
// 桌面捷徑: asked once at the first start (yes or no, it is not asked again), or made from 設定.
ipcMain.handle('desktop:shortcut', (event, create) => {
  if (!fromSettings(event)) return null;
  state.shortcutAsked = true;
  if (create === true && !install.hasShortcut()) { try { install.createShortcut(); } catch (error) { store.log(error); } }
  persist();
  return installState();
});
// 解除安裝: 開機自動啟動 off, the shortcut and the Apps entry gone, then the App closes and its folder is deleted
// (all but Data with keepData). The self-tests never quit this way.
ipcMain.handle('desktop:uninstall', async (event, options) => {
  if (!fromSettings(event)) return null;
  if (!selfTest) { try { if (startup.get().enabled) startup.set(false); } catch (error) { store.log(error); } }
  const result = await install.uninstall({ keepData: options?.keepData === true });
  if (!selfTest) { quitting = true; app.quit(); }
  return result;
});
// The power button: the app closes (saving as always). The self-tests never quit this way.
ipcMain.handle('desktop:quit', event => {
  if (!fromSettings(event) || selfTest) return false;
  quitting = true;
  app.quit();
  return true;
});
// 重新啟動程序: the app closes (saving as always) and starts again, loading the extensions anew; started from the
// tray at login (--autostart), it comes back with its settings window. The self-tests never restart it.
ipcMain.handle('desktop:relaunch', event => {
  if (!fromSettings(event) || selfTest) return false;
  app.relaunch({ args: process.argv.slice(1).filter(arg => arg !== '--autostart') });
  quitting = true;
  app.quit();
  return true;
});
// A character's very first state: default look, expression, settings and heights, full opacity, unlocked, not
// mirrored. Whether it is on the desktop, and where, stays.
function resetProfile(id) {
  const { shown, x, y } = desktopOf(id);
  state.characters[String(id)] = { desktop: profiles.cleanDesktop({ shown, x, y }) };
  if (String(id) === currentId()) state.selection = profiles.selectionFor(state.characters, findEntry(id), cleanLook);
}
ipcMain.handle('desktop:reset-character', (event, id) => {
  if (!fromKnownCharacter(event, id)) return false;
  resetProfile(id);
  publish();
  persist();
  reloadSettings();
  return true;
});
// 設定 › UI 設定 and 還原 › 還原 UI 設定: how the settings window looks. The page draws its background; the blur
// is the window's.
function setUi(ui) {
  const blurred = uiNow().blur;
  state.ui = profiles.cleanUi(ui);
  // With the blur turned off the window needs its transparent colour again, or it turns opaque.
  if (glass && settings && uiNow().blur !== blurred) {
    settings.setBackgroundMaterial(uiNow().blur ? 'acrylic' : 'none');
    if (!uiNow().blur) settings.setBackgroundColor('#00000000');
  }
  persist();
  return uiNow();
}
ipcMain.handle('desktop:ui', (event, change) => fromSettings(event) ? setUi({
  ...uiNow(), ...(Number.isFinite(change?.transparency) ? { transparency: change.transparency } : {}), ...(typeof change?.blur === 'boolean' ? { blur: change.blur } : {})
}) : null);
ipcMain.handle('desktop:reset-ui', event => fromSettings(event) ? setUi({}) : null);
// The page's title bar: 最小化, 最大化 (again: back) and 關閉 (which only hides the window).
ipcMain.handle('desktop:window', (event, action) => {
  if (!fromSettings(event)) return;
  if (action === 'minimize') settings.minimize();
  else if (action === 'maximize') { if (settings.isMaximized()) settings.unmaximize(); else settings.maximize(); }
  else if (action === 'close') settings.close();
});
// 還原 › 所有角色設定: every character in the list back to its first state, as if each were reset. Characters,
// their files and their places stay; characters of an extension that is not installed are left as they are.
ipcMain.handle('desktop:reset-characters', event => {
  if (!fromSettings(event) || downloadJob) return false;
  // Groups out close first, so what is reset is each character's own profile.
  for (const id of Object.keys(state.active)) closeGroup(id);
  for (const entry of shownLibrary()) resetProfile(entry.id);
  publish();
  persist();
  reloadSettings();
  return true;
});

// ---------- IPC: desktop character pages ----------
ipcMain.on('desktop:open-settings', event => { const from = petFrom(event); if (from) editFromDesktop(from.id); });
ipcMain.on('desktop:hit', (event, over) => petFrom(event)?.pet.setPointerOverCharacter(!!over));
// A dragged character moves with the pointer; a member of a group out moves with every member on the desktop (not
// while the group is edited: then each member is placed by itself).
let dragging = [];
ipcMain.on('desktop:drag-start', (event, x, y) => {
  const from = petFrom(event);
  // A locked character cannot be dragged.
  if (!from || desktopOf(from.id).locked) return;
  const group = activeGroupOf(from.id), point = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  dragging = (group && !editingOf(group) ? shownMembers(group) : [from.id]).filter(id => pets.has(id));
  for (const id of dragging) pets.get(id).startDrag(point);
});
ipcMain.on('desktop:drag-to', (event, x, y) => {
  const from = petFrom(event);
  if (from && dragging.includes(from.id) && Number.isFinite(x) && Number.isFinite(y)) for (const id of dragging) pets.get(id)?.dragTo(x, y);
});
ipcMain.on('desktop:drag-end', event => {
  const from = petFrom(event);
  if (!from) return;
  const moved = [...new Set([from.id, ...dragging])], group = activeGroupOf(from.id);
  for (const id of moved) pets.get(id)?.stopDrag();
  dragging = [];
  // A group dropped somewhere keeps that place (while it is edited, 保存 keeps it).
  if (group && !editingOf(group)) {
    for (const id of moved) {
      const pet = pets.get(id), profile = group.profiles[id];
      if (pet && profile) { const { x, y } = pet.bounds(); profile.desktop = { ...profile.desktop, x, y }; }
    }
  }
  persist();
  // A character dropped onto another goes back to its layer.
  stackPets();
});
ipcMain.on('desktop:pet-ready', event => {
  const from = petFrom(event);
  if (!from) return;
  from.pet.ready = true;
  from.pet.sentPacket = '';   // the page has just started and needs the packet
  publish();
});
ipcMain.on('desktop:pet-error', (event, message) => {
  if (!petFrom(event)) return;
  store.log(message);
  if (!selfTest) showSettings();
});

// ---------- Lifecycle ----------
app.on('before-quit', () => {
  quitting = true;
  downloadJob?.controller.abort();
  for (const pet of pets.values()) pet.stopDrag();
  try { saveSettings(); } catch { /* quitting anyway */ }
});
app.on('window-all-closed', () => { /* the app lives in the tray */ });

async function runSelfTest() {
  const report = argValue('--report') ? path.resolve(argValue('--report')) : path.join(dataRoot, 'self-test.json');
  const getPet = (id = currentId()) => pets.get(String(id))?.window || null;
  try {
    await require('./self-test.cjs').run({
      app, getPet, getPets: () => [...pets.keys()], getStack: () => [...lastStack], getRaised: () => [...lastRaised],
      restack: options => stackPets(options), isDragging: id => !!pets.get(String(id))?.isDragging(),
      getTray: trayTip, clickTray: button => (button === 'right' ? showSettings() : toggleVisible()),
      getSettings: showSettings, getState: stateForSettings, stageLocal, setFileTest: value => { fileTest = value; }, report, dataRoot, extensionsRoot,
      installCalls, shortcutFile: () => path.join(path.dirname(dataRoot), 'Desktop', 'CharacterDesktop.lnk'),
      helpers: require('./test-helpers.cjs')
    });
  } catch (error) {
    store.log(error);
    if (argValue('--report')) fs.writeFileSync(report, JSON.stringify({ ok: false, error: error.stack }));
    app.exit(1);
  }
}

if (!app.requestSingleInstanceLock() && !selfTest) {
  app.quit();
} else {
  app.on('second-instance', (_, argv) => {
    if (argv.includes('--autostart')) return;
    // 解除安裝 from Settings › Apps while the App runs: the settings page starts again and asks.
    if (argv.includes('--uninstall')) { askUninstall = true; showSettings(); reloadSettings(); return; }
    showSettings();
    state.visible = true;
    publish();
  });
  app.whenReady().then(async () => {
    checkLocalFiles();
    // Members back since the app last ran (their extension installed again) join their group if it is out.
    pruneGroups();
    // The character being edited when the app last closed may belong to an extension no longer installed.
    if (!findEntry(currentId())) state.selection = profiles.selectionFor(state.characters, shownLibrary()[0], cleanLook);
    store.write('settings.json', state);
    // Pages work offline: no permissions, and no web requests from any page.
    session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false));
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, callback) => callback({ cancel: true }));
    createTray();
    publish();
    if (!selfTest && (!process.argv.includes('--autostart') || !shownLibrary().length || askUninstall)) showSettings();
    // The entry in Settings › Apps follows the App's folder and version.
    if (!selfTest) install.register().catch(error => store.log(error));
    // Other always-on-top windows can push the characters down, so they are stacked again every two seconds.
    setInterval(() => {
      if (!state.visible) return;
      stackPets({ gentle: true });
      for (const pet of pets.values()) if (pet.window.isMinimized()) pet.window.restore();
    }, 2000).unref();
    screen.on('display-removed', () => { for (const pet of pets.values()) pet.keepOnDisplay(); });
    if (selfTest) await runSelfTest();
  }).catch(error => {
    store.log(error);
    if (!selfTest) dialog.showErrorBox('角色桌面無法啟動', String(error.message || error));
    app.exit(1);
  });
}
