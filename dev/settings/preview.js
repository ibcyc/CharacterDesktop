// Settings preview: the full-window character player behind the panels. It owns the character menu and the expression
// menu; the kind of the character being edited (shared/character-kinds.js) shows it and handles its pokes.
// The app tells it where each character starts through previewHooks, and listens to its events:
//   preview:loaded      a character finished loading, or its kind changed what it shows (a costume, …)
//   preview:expression  the user picked an expression

const $ = id => document.getElementById(id);
const library = new Map();             // character id -> library entry, as the app sends it
let pinned = new Set();                // ids of pinned characters: first in the character menu
let activeId = '', currentKey = '', activeKind = null;
let busy = false, lastPokePlan = null;
let baseScale = 0.1, baseX = 0, baseY = 0, previewControls = null;

// Set by the app: where a character starts ({ look, expression, mirror, options }).
const previewHooks = { startFor: id => ({}) };

function makeOption(select, value, text) {
  const option = document.createElement('option');
  option.value = String(value);
  option.textContent = text;
  select.appendChild(option);
}

function setBusy(value) {
  busy = value;
  ready = !value && !!currentKey;
  for (const id of ['character', 'expression']) $(id).disabled = value || !activeId;
}

// ---------- Library ----------
function loadLibrary(entries, pins = [...pinned]) {
  pinned = new Set(pins.map(String));
  library.clear();
  for (const entry of entries) library.set(String(entry.id), entry);
  $('character').replaceChildren();
  // The menu lists pinned characters first, then by the tag their kind's label starts with ([L] for local ones, …, in natural
  // order); within a tag, and without one (last), in the order they were added.
  const tagOf = label => /^\[([^\]]*)\]/.exec(label)?.[1] ?? '￿';
  const items = [...library.values()].map(entry => ({ entry, label: characterLabel(entry) }));
  items.sort((a, b) => pinned.has(String(b.entry.id)) - pinned.has(String(a.entry.id)) || tagOf(a.label).localeCompare(tagOf(b.label), undefined, { numeric: true, sensitivity: 'base' }));
  for (const { entry, label } of items) makeOption($('character'), entry.id, label + (entry.english ? ' · ' + entry.english : ''));
  if (library.has(activeId)) $('character').value = activeId;
}

function currentEntry() { return library.get(activeId); }

// ---------- What kinds may use ----------
// Runs a change of what the preview shows: busy meanwhile, errors shown, preview:loaded afterwards.
async function changeCharacter(task) {
  if (busy) return false;
  setBusy(true);
  try {
    await task();
    currentKey = activeId;
    $('empty').classList.add('hidden');
  } catch (error) {
    currentKey = '';
    showError(error);
    return false;
  } finally {
    setBusy(false);
  }
  document.dispatchEvent(new CustomEvent('preview:loaded'));
  return true;
}

// The expression menu: the kind's expressions ({ id, label }), with `value` chosen when it is one of them.
function setExpressions(list, value) {
  const select = $('expression');
  select.replaceChildren();
  for (const item of list) makeOption(select, item.id, item.label);
  select.value = list.some(item => item.id === String(value)) ? String(value) : list[0]?.id ?? '';
}

// The picture player, shared by every kind whose characters are pictures (ImagePlayer, shared/image-player.js).
let imagePlayer = null;
function picturePlayer() { return imagePlayer ??= new ImagePlayer($('viewer-image'), $('viewer-canvas')); }
// A picture stands on the lower part of the preview at 80% of its height (narrower when wide).
function pictureBase() {
  const canvas = $('viewer-canvas'), widthUnits = 600 * canvas.clientWidth / Math.max(1, canvas.clientHeight);
  return { scale: Math.min(480 / imagePlayer.height, widthUnits * 0.6 / imagePlayer.width), x: 0, y: 240 };
}

// Where the preview rests comes from the kind; zoom and pan start again from there.
function placePreview() {
  ({ scale: baseScale, x: baseX, y: baseY } = activeKind.base());
  previewControls.reset();
}

const CharacterDesktop = {
  canvas: () => $('viewer-canvas'),
  entry: currentEntry,
  activeId: () => activeId,
  busy: () => busy,
  startOf: id => previewHooks.startFor(id),
  expression: () => $('expression').value,
  setExpressions,
  change: changeCharacter,
  placePreview,
  // A line in the panel for news such as "downloading a player"; '' clears it.
  notice: text => { $('errors').textContent = text; },
  showError,
  setMirror: on => setMirror(on),
  imagePlayer: picturePlayer,
  expressionMenu: select => createExpressionMenu(select),
  pictureBase,
  tuning: () => tuningOf(activeId),
  characters: () => [...library.values()],
  label: entry => characterLabel(entry),
  isLocal: entry => isLocal(entry),
  select: id => selectCharacter(id),
  // Tools (tool-host.js): leave the tool; zoom and pan like the preview's; a file saved where the user chooses; a
  // picture (PNG bytes) added as a local character, like a single picture, or as the next expression of one.
  closeTool: () => closeTool(),
  panZoom: (canvas, options) => createPreviewControls(canvas, options),
  saveFile: (name, data) => window.desktopAPI.saveFile(name, data),
  addPicture: (name, data, characterId) => window.desktopAPI.addPicture(name, data, characterId),
  // A panel of the bottom-left dock (the extension's own, from its "dock" markup) opened or closed, one at a time.
  dockPanel: (panel, open) => setDockPanel(panel, open),
  confirm: (message, options) => confirmDialog(message, options),
  // A question with buttons of the caller's own ([{ label, value, kind }]); resolves the value chosen.
  ask: question => askDialog(question).then(answer => answer.value),
  // After an extension changed characters in the app: the page starts again from the library.
  refresh: async () => restoreFromApp(await window.desktopAPI.getState()),
  saveOptions: options => saveCharacterOptions(options),
  call: (id, name, ...args) => window.desktopAPI.extensionCall(id, name, args)
};

// ---------- Choosing a character ----------
// Shows a character, starting from `start` (by default where the app says it starts).
async function selectCharacter(id, start = previewHooks.startFor(String(id))) {
  if (busy || !library.has(String(id))) return;
  const entry = library.get(String(id)), kind = kindOf(entry);
  activeId = String(id);
  $('character').value = activeId;
  if (activeKind && activeKind !== kind) activeKind.unload();
  activeKind = kind;
  await changeCharacter(async () => {
    await kind.load(entry, start);
    placePreview();
  });
}

// ---------- Pokes ----------
function poke(event) {
  if (!ready || busy || toolOpen) return;
  lastPokePlan = activeKind.poke(event);
  reactToPreviewPoke();
}

// ---------- Start ----------
async function startPreview() {
  previewControls = createPreviewControls($('viewer-canvas'), {
    isReady: () => ready && !busy,
    getBase: () => ({ scale: baseScale, x: baseX, y: baseY }),
    apply: transform => activeKind?.setTransform(transform.scale, transform.x, transform.y),
    onPoke: event => poke(event)
  });
  $('character').onchange = event => selectCharacter(event.target.value);
  $('expression').onchange = () => { activeKind?.showExpression($('expression').value); document.dispatchEvent(new CustomEvent('preview:expression')); };
  $('viewer-canvas').onkeydown = event => { if (event.code === 'Enter') { event.preventDefault(); poke(); } };
  document.addEventListener('keydown', event => {
    if (event.code === 'Space' && !['INPUT', 'SELECT', 'BUTTON'].includes(event.target.tagName)) { event.preventDefault(); poke(); }
  });
  setBusy(false);
}
