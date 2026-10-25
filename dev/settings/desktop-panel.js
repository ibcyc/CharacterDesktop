// Desktop panel (top right), layer list (right), and the show/hide switch with its lock (bottom centre).
// Height, opacity, 自動戳 (only while the character is on the desktop), show/hide and lock apply to the character
// being edited; the app keeps them in its profile (height per skin) and sends them back as options whenever they
// change.

const LOCK_CLOSED = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1zm2 0h6V7a3 3 0 0 0-6 0v3z"/></svg>';
const LOCK_OPEN = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M7 10V7a5 5 0 0 1 9.6-2l-1.8.9A3 3 0 0 0 9 7v3h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1z"/></svg>';
const CLOSE = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>';
let lastOptions = null;
let slidingId = '';   // the slider being dragged; the app's replies do not move it meanwhile
let sliderSends = 0;  // slider changes on their way to the app

function showLock(button, locked) {
  button.setAttribute('aria-pressed', String(locked));
  button.innerHTML = locked ? LOCK_CLOSED : LOCK_OPEN;
  button.title = locked ? '已鎖定：無法拖曳（點一下解鎖）' : '鎖定位置（防止拖曳）';
}

const autoPokeLabel = seconds => seconds ? seconds + ' 秒' : '關閉';

function showDesktopOptions(options) {
  lastOptions = options;
  // The height slider reaches as far as the tallest display.
  $('desktop-height').max = options.heightLimit;
  if (slidingId !== 'desktop-height') {
    $('desktop-height').value = options.height;
    $('desktop-height-label').textContent = options.height + ' px';
  }
  if (slidingId !== 'desktop-opacity') {
    $('desktop-opacity').value = options.opacity;
    $('desktop-opacity-label').textContent = options.opacity + '%';
  }
  $('autopoke-field').hidden = !options.visible;
  if (slidingId !== 'desktop-autopoke') {
    $('desktop-autopoke').value = options.autoPoke;
    $('desktop-autopoke-label').textContent = autoPokeLabel(options.autoPoke);
  }
  $('desktop-visible').checked = options.visible;
  $('desktop-visible').hidden = !activeId;
  $('desktop-lock').hidden = !activeId;
  showLock($('desktop-lock'), !!options.locked);
  renderLayers(options.layers || []);
  renderGroups(options.groups || []);
  showInteraction(options.interaction);
  // A group being edited: 保存 / ✕ bottom right, and 從組合中移除 for the member being edited (one stays at least).
  const editing = options.editing;
  $('group-edit').hidden = !editing;
  $('group-edit-name').textContent = editing ? '編輯中：' + editing.name : '';
  $('group-leave').hidden = !editing?.members.includes(activeId);
  $('group-leave').disabled = (editing?.members.length || 0) < 2;
}

// ---------- Layers ----------
// A row per character on the desktop by itself, and per group out (its members listed under it when opened). Shift+
// click chooses characters; with two or more chosen, a right click on one of them offers 組合 (a name, then the app
// makes the group).
const GROUP_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="M12 3 2 8l10 5 10-5-10-5zM2 12l10 5 10-5M2 16l10 5 10-5"/></svg>';
let chosenLayers = new Set();
const openGroups = new Set();

function layerButtons(layer) {
  const lock = document.createElement('button');
  lock.type = 'button';
  lock.className = 'icon-button lock';
  showLock(lock, layer.locked);
  lock.onclick = async event => {
    event.stopPropagation();
    showDesktopOptions(await window.desktopAPI.setLayerLock(layer.id, !layer.locked) || lastOptions);
  };
  // The close button takes the character off the desktop, like its show/hide switch; a group closes.
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-button close';
  close.innerHTML = CLOSE;
  close.title = layer.group ? '關閉組合' : '從桌面關閉';
  close.setAttribute('aria-label', close.title);
  close.onclick = async event => {
    event.stopPropagation();
    showDesktopOptions(await window.desktopAPI.closeLayer(layer.id) || lastOptions);
  };
  return [lock, close];
}

function renderLayers(layers) {
  const list = $('layers'), present = new Set(layers.filter(layer => !layer.group).map(layer => layer.id));
  chosenLayers = new Set([...chosenLayers].filter(id => present.has(id)));
  list.replaceChildren();
  for (const layer of layers) {
    const row = document.createElement('li');
    row.className = 'layer' + (layer.group ? ' group' + (openGroups.has(layer.id) ? ' open' : '') : '') + (layer.editing ? ' editing' : '') + (layer.id === activeId ? ' current' : '') + (chosenLayers.has(layer.id) ? ' selected' : '');
    row.draggable = true;
    row.dataset.id = layer.id;
    const grip = document.createElement('span');
    grip.className = 'grip';
    grip.textContent = '⋮⋮';
    const name = document.createElement('span');
    name.className = 'name';
    if (layer.group) {
      // The group's line opens or closes the list of its members; a member is edited like any character.
      const line = document.createElement('div'), icon = document.createElement('span'), opener = document.createElement('span'), members = document.createElement('ul');
      line.className = 'layer-line';
      icon.className = 'group-icon';
      icon.innerHTML = GROUP_ICON;
      opener.className = 'group-open';
      opener.textContent = '▶';
      name.textContent = layer.name;
      line.onclick = () => { if (openGroups.has(layer.id)) openGroups.delete(layer.id); else openGroups.add(layer.id); renderLayers(lastOptions.layers || []); };
      line.append(grip, opener, icon, name, ...layerButtons(layer));
      members.className = 'layer-members';
      members.hidden = !openGroups.has(layer.id);
      for (const member of layer.members) {
        const item = document.createElement('li');
        item.className = member.id === activeId ? 'current' : '';
        item.dataset.id = member.id;
        item.textContent = library.has(member.id) ? characterLabel(library.get(member.id)) : '角色 #' + member.id;
        item.translate = !library.has(member.id);
        item.onclick = event => { event.stopPropagation(); if (member.id !== activeId && !busy) selectCharacter(member.id); };
        members.appendChild(item);
      }
      row.append(line, members);
    } else {
      name.textContent = library.has(layer.id) ? characterLabel(library.get(layer.id)) : '角色 #' + layer.id;
      name.translate = !library.has(layer.id);
      // Shift+click chooses (or lets go of) a character for a group (not one of a group being edited); a plain click
      // edits it.
      row.onclick = event => {
        if (event.shiftKey && !layer.editing) {
          if (chosenLayers.has(layer.id)) chosenLayers.delete(layer.id); else chosenLayers.add(layer.id);
          row.classList.toggle('selected', chosenLayers.has(layer.id));
          return;
        }
        chooseNoLayers();
        if (layer.id !== activeId && !busy) selectCharacter(layer.id);
      };
      row.oncontextmenu = event => {
        event.preventDefault();
        if (chosenLayers.size >= 2 && chosenLayers.has(layer.id)) openLayerMenu(event.clientX, event.clientY);
      };
      row.append(grip, name, ...layerButtons(layer));
    }
    list.appendChild(row);
  }
  // Shown only while some character is on the desktop.
  $('layers-field').hidden = !layers.length;
}

function chooseNoLayers() {
  chosenLayers.clear();
  for (const row of $('layers').querySelectorAll('.layer.selected')) row.classList.remove('selected');
}
function openLayerMenu(x, y) {
  const menu = $('layer-menu');
  menu.hidden = false;
  menu.style.left = Math.min(x, innerWidth - menu.offsetWidth - 8) + 'px';
  menu.style.top = Math.min(y, innerHeight - menu.offsetHeight - 8) + 'px';
}
// 組合: a name for the characters chosen, then the app makes them a group (out at once).
async function groupChosenLayers() {
  $('layer-menu').hidden = true;
  const ids = [...chosenLayers];
  const answer = await askDialog({ title: '組合', message: '替這 ' + ids.length + ' 個角色的組合取個名字', input: { placeholder: '組合名稱' }, buttons: [{ label: '取消', value: 'cancel' }, { label: '組合', value: 'ok', kind: 'primary' }] });
  if (answer.value !== 'ok') return null;
  const result = await window.desktopAPI.createGroup(answer.text, ids);
  if (result?.ok) chooseNoLayers(); else $('errors').textContent = result?.message || '無法組合。';
  return result;
}

// Sends the order shown in the list (front first: characters and groups) to the app.
async function commitLayerOrder() {
  const order = [...$('layers').children].map(row => row.dataset.id);
  showDesktopOptions(await window.desktopAPI.setLayers(order) || lastOptions);
}

// Moves a row to a new position in the list and commits the order; also used by the self-tests.
async function moveLayer(id, index) {
  const list = $('layers'), row = [...list.children].find(item => item.dataset.id === String(id));
  if (!row) return;
  row.remove();
  list.insertBefore(row, list.children[index] || null);
  await commitLayerOrder();
}

function setUpLayerDragging() {
  const list = $('layers');
  let dragged = null;
  list.addEventListener('dragstart', event => {
    dragged = event.target.closest('.layer');
    if (!dragged) return;
    dragged.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragged.dataset.id);
  });
  // While dragging, the row moves to wherever the pointer is.
  list.addEventListener('dragover', event => {
    if (!dragged) return;
    event.preventDefault();
    const target = event.target.closest('.layer');
    if (!target || target === dragged) return;
    const box = target.getBoundingClientRect();
    list.insertBefore(dragged, event.clientY < box.top + box.height / 2 ? target : target.nextSibling);
  });
  list.addEventListener('drop', event => event.preventDefault());
  list.addEventListener('dragend', () => {
    if (!dragged) return;
    dragged.classList.remove('dragging');
    dragged = null;
    commitLayerOrder();
  });
}

// ---------- Startup switch ----------
// The switch shows what Windows actually has registered, and is re-read whenever the window gets focus.
function setUpStartupSwitch(state) {
  const toggle = $('desktop-startup'), status = $('startup-status');
  const show = value => { toggle.checked = value.enabled; $('startup-field').hidden = !value.supported; };
  show(state.startup);
  toggle.onchange = async () => {
    const enabled = toggle.checked;
    toggle.disabled = true;
    status.textContent = '';
    try {
      const result = await window.desktopAPI.setStartup(enabled);
      if (!result.ok) throw new Error(result.message);
      show(result);
    } catch (error) {
      toggle.checked = !enabled;
      status.textContent = error.message || String(error);
    } finally {
      toggle.disabled = false;
    }
  };
  window.addEventListener('focus', async () => {
    if (toggle.disabled || $('startup-field').hidden) return;
    try { show((await window.desktopAPI.getState()).startup); } catch { /* keep the last known state */ }
  });
}

// Sends a slider's changes one at a time: while one is on its way to the app, only the newest value waits.
function latestOnly(send) {
  let sending = false, waiting = null;
  const run = async value => {
    sending = true;
    sliderSends++;
    try { await send(value); } finally { sending = false; sliderSends--; }
    if (waiting !== null) { const next = waiting; waiting = null; run(next); } else settleSlider();
  };
  return value => { if (sending) waiting = value; else run(value); };
}

// Once the slider is let go and every change has arrived, it shows the app's value (a height may be limited).
function settleSlider() {
  if (!slidingId && !sliderSends && lastOptions) showDesktopOptions(lastOptions);
}

function setUpDesktopPanel() {
  const sendHeight = latestOnly(height => window.desktopAPI.setOptions({ height }));
  const sendOpacity = latestOnly(opacity => window.desktopAPI.setOptions({ opacity }));
  const sendAutoPoke = latestOnly(autoPoke => window.desktopAPI.setOptions({ autoPoke }));
  $('desktop-height').oninput = event => {
    const height = Number(event.target.value);
    $('desktop-height-label').textContent = height + ' px';
    sendHeight(height);
  };
  $('desktop-opacity').oninput = event => {
    const opacity = Number(event.target.value);
    $('desktop-opacity-label').textContent = opacity + '%';
    sendOpacity(opacity);
  };
  $('desktop-autopoke').oninput = event => {
    const seconds = Number(event.target.value);
    $('desktop-autopoke-label').textContent = autoPokeLabel(seconds);
    sendAutoPoke(seconds);
  };
  for (const id of ['desktop-height', 'desktop-opacity', 'desktop-autopoke']) $(id).addEventListener('pointerdown', () => { slidingId = id; });
  const release = () => {
    if (!slidingId) return;
    slidingId = '';
    settleSlider();
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('blur', release);
  // 找回角色 brings the character being edited back on screen, and the preview back to its default zoom and position.
  $('desktop-reset').onclick = () => {
    previewControls?.reset();
    window.desktopAPI.setOptions({ resetPosition: true });
  };
  $('desktop-visible').onchange = () => window.desktopAPI.setOptions({ visible: $('desktop-visible').checked });
  $('desktop-lock').onclick = () => window.desktopAPI.setOptions({ locked: $('desktop-lock').getAttribute('aria-pressed') !== 'true' });
  setUpLayerDragging();
  $('layer-group').onclick = groupChosenLayers;
  $('group-save').onclick = () => window.desktopAPI.saveGroup();
  $('group-cancel').onclick = () => window.desktopAPI.cancelGroupEdit();
  $('group-leave').onclick = () => window.desktopAPI.leaveGroup(activeId);
  document.addEventListener('pointerdown', event => { if (!event.target.closest?.('#layer-menu')) $('layer-menu').hidden = true; });
  window.addEventListener('keydown', event => { if (event.key === 'Escape') { $('layer-menu').hidden = true; chooseNoLayers(); } });
}
