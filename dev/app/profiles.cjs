// Character profiles and saved settings. Pure functions: no Electron, no files.
//
// Every character (pet) keeps its own profile:
//   { expression, heights: { [look key]: px }, desktop: { shown, locked, opacity: 1-100, x, y }, mirror,
//     tuning: { breath, rate, bounce, pokeFace, fifthFace },          (characters that are pictures)
//     look: {…}, options: {…} }                                       (characters of an extension, checked by it)
// `look` is what an extension's character shows (a costume, …) and `options` are its own settings; the app keeps
// both as plain data. Local character ids are L<number>; extensions choose their own.
// Missing fields mean "use the default". Settings also keep `layers`: the stacking order, front first, of every
// character that has been on the desktop, so one taken off and put back returns to its place.

const DEFAULT_HEIGHT = 500;
const MIN_HEIGHT = 180;
const MAX_HEIGHT = 4320;     // a window never grows past its display either
const MAX_PLAIN_DATA = 4000;   // characters of JSON for look and options

function isId(value) { return /^[A-Za-z0-9_-]{1,40}$/.test(String(value)); }
function expressionId(value) { return typeof value === 'string' && /^\d{1,3}$/.test(value) ? value : ''; }
function clampHeight(value) { return Math.round(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Number(value)))); }
function clampOpacity(value) { return Math.round(Math.max(1, Math.min(100, Number(value)))); }
// An object that survives JSON unchanged and stays small, or null.
function plainData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const text = JSON.stringify(value);
    return text.length <= MAX_PLAIN_DATA ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

// Every so many seconds a character on the desktop is poked by itself (0: never; steps of 10). Kept only when it
// is not the default.
const AUTO_POKE_DEFAULT = 180;
const AUTO_POKE_MAX = 600;
function cleanAutoPoke(value) { return Math.round(Math.max(0, Math.min(AUTO_POKE_MAX, Number(value) || 0)) / 10) * 10; }
function autoPokeOf(desktop) { return desktop?.autoPoke ?? AUTO_POKE_DEFAULT; }

// Whether the character is on the desktop, locked against dragging, its opacity, its window position, and how
// often it is poked by itself.
function cleanDesktop(value) {
  const desktop = { shown: value?.shown === true, locked: value?.locked === true, opacity: Number.isFinite(value?.opacity) ? clampOpacity(value.opacity) : 100 };
  if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) { desktop.x = Math.round(value.x); desktop.y = Math.round(value.y); }
  if (Number.isFinite(value?.autoPoke) && cleanAutoPoke(value.autoPoke) !== AUTO_POKE_DEFAULT) desktop.autoPoke = cleanAutoPoke(value.autoPoke);
  return desktop;
}
function desktopFor(profiles, id) { return cleanDesktop(profiles[String(id)]?.desktop); }

// The stacking order, front first: saved order kept (also for characters now off the desktop, and groups as
// 'G:<group id>'), characters shown for the first time on top, characters and groups no longer there dropped.
function layerOrder(layers, profiles, groupIds = []) {
  const known = (Array.isArray(layers) ? layers.map(String) : []).filter((id, index, all) => (profiles[id] || groupIds.includes(id.slice(2)) && id.startsWith('G:')) && all.indexOf(id) === index);
  const added = Object.keys(profiles).filter(id => profiles[id].desktop?.shown && !known.includes(id));
  return [...added, ...known];
}
// The characters on the desktop now, front first.
function shownLayers(layers, profiles) { return layers.filter(id => profiles[id]?.desktop?.shown); }

// Characters that are pictures (local ones, and an extension's): how strongly and how often the picture breathes (percent, breaths a minute), how strongly it
// bounces when poked (percent), and the expressions shown by a poke and by every fifth poke ('' = none).
const TUNING_DEFAULTS = { breath: 40, rate: 15, bounce: 50, pokeFace: '', fifthFace: '' };
const TUNING_LIMITS = { breath: [0, 100], rate: [6, 40], bounce: [0, 100] };
function cleanTuning(value) {
  const tuning = { ...TUNING_DEFAULTS };
  for (const [key, [min, max]] of Object.entries(TUNING_LIMITS)) {
    if (Number.isFinite(value?.[key])) tuning[key] = Math.round(Math.max(min, Math.min(max, value[key])));
  }
  tuning.pokeFace = expressionId(value?.pokeFace);
  tuning.fifthFace = expressionId(value?.fifthFace);
  return tuning;
}
function tuningFor(profiles, id) { return cleanTuning(profiles[String(id)]?.tuning); }
function mirrorFor(profiles, id) { return profiles[String(id)]?.mirror === true; }

function cleanProfile(profile) {
  const clean = {};
  const look = plainData(profile?.look), options = plainData(profile?.options);
  if (look) clean.look = look;
  if (expressionId(profile?.expression)) clean.expression = profile.expression;
  if (profile?.heights && typeof profile.heights === 'object') {
    const heights = {};
    for (const [key, height] of Object.entries(profile.heights)) {
      if (/^[\w-]{1,40}$/.test(key) && Number.isFinite(height)) heights[key] = clampHeight(height);
    }
    if (Object.keys(heights).length) clean.heights = heights;
  }
  if (profile?.desktop && typeof profile.desktop === 'object') clean.desktop = cleanDesktop(profile.desktop);
  if (profile?.mirror === true) clean.mirror = true;
  if (profile?.tuning && typeof profile.tuning === 'object') clean.tuning = cleanTuning(profile.tuning);
  if (options) clean.options = options;
  return clean;
}

// settings.json as saved: anything not in the current shape is dropped.
function cleanSettings(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
  const settings = { characters: {} };
  if (typeof saved.visible === 'boolean') settings.visible = saved.visible;
  const selection = saved.selection;
  if (selection && typeof selection === 'object') {
    settings.selection = {
      characterId: isId(selection.characterId) ? String(selection.characterId) : '',
      look: plainData(selection.look),
      expression: expressionId(selection.expression)
    };
  }
  if (saved.characters && typeof saved.characters === 'object') {
    for (const [id, profile] of Object.entries(saved.characters)) if (isId(id)) settings.characters[id] = cleanProfile(profile);
  }
  settings.ui = cleanUi(saved.ui);
  // The desktop shortcut is offered once (install.cjs).
  if (saved.shortcutAsked === true) settings.shortcutAsked = true;
  settings.groups = cleanGroups(saved.groups);
  settings.active = cleanActive(saved.active, settings.groups);
  settings.layers = layerOrder(saved.layers, settings.characters, settings.groups.map(group => group.id));
  // Pinned characters come first in the character menu, in the order they were pinned.
  settings.pinned = Array.isArray(saved.pinned) ? [...new Set(saved.pinned.map(String).filter(isId))] : [];
  return settings;
}

// UI 設定 of the settings window: { transparency (背景透明度, 0–100 %), blur (模糊) }. Values at their defaults are
// not kept.
const UI_DEFAULTS = { transparency: 0, blur: true };
function cleanUi(value) {
  const ui = {};
  if (typeof value?.transparency === 'number' && Number.isFinite(value.transparency)) {
    const transparency = Math.min(100, Math.max(0, Math.round(value.transparency)));
    if (transparency !== UI_DEFAULTS.transparency) ui.transparency = transparency;
  }
  if (value?.blur === false) ui.blur = false;
  return ui;
}

// Groups (組合): characters out on the desktop together, each as it was when the group was made:
//   { id: 'G<n>', name, members: [character ids, front first], profiles: { [id]: its profile then } }
// A group out on the desktop is active: { previous: { [id]: the member's own profile before } }, given back when the
// group closes, so a group never changes a character's own settings.
function cleanGroups(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap(group => {
    const id = String(group?.id || ''), name = String(group?.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const members = Array.isArray(group?.members) ? [...new Set(group.members.map(String).filter(isId))] : [];
    if (!/^G\d{1,6}$/.test(id) || seen.has(id) || !name || !members.length || !group.profiles || typeof group.profiles !== 'object') return [];
    seen.add(id);
    return [{ id, name, members, profiles: Object.fromEntries(members.map(member => [member, cleanProfile(group.profiles[member])])) }];
  });
}
function cleanActive(value, groups) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(groups.filter(group => value[group.id]?.previous && typeof value[group.id].previous === 'object').map(group => [group.id, {
    previous: Object.fromEntries(group.members.filter(id => value[group.id].previous[id]).map(id => [id, cleanProfile(value[group.id].previous[id])]))
  }]));
}

// Where a character starts when it becomes the current one: { characterId, look, expression }.
// A local character shows a picture per expression ('0' is its default picture) and has no look; an extension's
// character gets its look checked by the extension (cleanLook). '' means the character's own default expression.
function selectionFor(profiles, entry, cleanLook = () => null) {
  if (!entry) return { characterId: '', look: null, expression: '' };
  const profile = profiles[String(entry.id)] || {};
  if (entry.kind === 'local') return { characterId: String(entry.id), look: null, expression: entry.files?.[profile.expression] ? profile.expression : '0' };
  return { characterId: String(entry.id), look: cleanLook(entry, profile.look), expression: profile.expression || '' };
}

// Each look keeps its own desktop height, since some are drawn larger than others.
function heightFor(profiles, id, key) { return profiles[String(id)]?.heights?.[key] ?? DEFAULT_HEIGHT; }

// Profiles of characters that are no longer in the library are dropped.
function keepProfilesFor(profiles, library) {
  const ids = new Set(library.map(entry => String(entry.id)));
  return Object.fromEntries(Object.entries(profiles).filter(([id]) => ids.has(id)));
}

module.exports = {
  DEFAULT_HEIGHT, MIN_HEIGHT, MAX_HEIGHT, TUNING_DEFAULTS, TUNING_LIMITS, AUTO_POKE_DEFAULT, AUTO_POKE_MAX, cleanAutoPoke, autoPokeOf,
  isId, expressionId, clampHeight, clampOpacity, plainData, cleanProfile, cleanDesktop, cleanTuning, tuningFor, mirrorFor,
  UI_DEFAULTS, cleanUi, cleanSettings, cleanGroups, cleanActive, selectionFor, heightFor, desktopFor, layerOrder, shownLayers, keepProfilesFor
};
