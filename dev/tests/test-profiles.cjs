// Unit tests for character profiles and saved settings (app/profiles.cjs). Runs in plain Node.
const assert = require('node:assert/strict');
const profiles = require('../app/profiles.cjs');

const localEntry = (id, files) => ({ id, kind: 'local', name: id, folder: id.slice(1), files });
const extensionEntry = id => ({ id, extension: 'demo', name: id });
const off = (opacity = 100) => ({ shown: false, locked: false, opacity });

// settings.json is cleaned to the current shape; keys no longer used are dropped. look and options stay plain data.
{
  const settings = profiles.cleanSettings({
    visible: false, height: 529, opacity: 70, downloadRoot: 'Characters', lastUrl: 'x',
    selection: { characterId: 'X1', look: { costume: 1 }, expression: '4', extra: true },
    layers: ['X1', 'X1', '99'],
    characters: {
      X1: {
        look: { costume: 1, version: 'alt' }, expression: '4', heights: { 1: 300, tall: 5000, 'bad key!': 9 },
        options: { reactions: { mode: 'advanced' } }, mirror: true, costume: 1, reactions: {},
        desktop: { shown: true, locked: 1, opacity: 0, x: 10.4, y: 'top' }
      },
      L2: { tuning: { breath: 500, rate: 1, pokeFace: '2', fifthFace: 'x', mirror: true }, mirror: 'yes', desktop: { shown: true, locked: true, opacity: 40, x: 5, y: 6 } },
      'bad id!': { expression: '1' }
    }
  });
  assert.deepEqual(Object.keys(settings).sort(), ['active', 'characters', 'groups', 'layers', 'pinned', 'selection', 'ui', 'visible']);
  assert.deepEqual(settings.ui, {}, 'UI settings at their defaults');
  assert.deepEqual([profiles.cleanSettings({ shortcutAsked: true }).shortcutAsked, 'shortcutAsked' in profiles.cleanSettings({ shortcutAsked: 'yes' })], [true, false], 'shortcut offered once');
  assert.deepEqual([profiles.cleanUi({ transparency: 60.4, blur: false }), profiles.cleanUi({ transparency: 150, blur: 'no' }), profiles.cleanUi({ transparency: profiles.UI_DEFAULTS.transparency, blur: true }), profiles.cleanUi({ transparency: null }), profiles.cleanUi('x')],
    [{ transparency: 60, blur: false }, { transparency: 100 }, {}, {}, {}], 'UI settings cleaned');
  assert.deepEqual(settings.pinned, [], 'nothing pinned');
  assert.equal(settings.visible, false);
  assert.deepEqual(settings.selection, { characterId: 'X1', look: { costume: 1 }, expression: '4' });
  assert.deepEqual(settings.characters, {
    X1: {
      look: { costume: 1, version: 'alt' }, expression: '4', heights: { 1: 300, tall: profiles.MAX_HEIGHT },
      desktop: { shown: true, locked: false, opacity: 1 }, mirror: true, options: { reactions: { mode: 'advanced' } }
    },
    L2: { desktop: { shown: true, locked: true, opacity: 40, x: 5, y: 6 }, tuning: { breath: 100, rate: 6, bounce: 50, pokeFace: '2', fifthFace: '' } }
  });
  assert.deepEqual(settings.layers, ['L2', 'X1'], 'unknown and duplicate ids dropped, newly shown on top');
  assert.deepEqual(profiles.cleanSettings({ selection: { characterId: 'bad id!', look: [1], expression: 'big' } }).selection,
    { characterId: '', look: null, expression: '' });
  assert.equal(profiles.plainData({ text: 'x'.repeat(5000) }), null, 'too large');
}

// Fresh install and broken files.
assert.deepEqual(profiles.cleanSettings({}), { characters: {}, ui: {}, groups: [], active: {}, layers: [], pinned: [] });
for (const broken of [null, [], 'text', 3]) assert.deepEqual(profiles.cleanSettings(broken), {});

// Where a character starts: a local one by its pictures, an extension's one through the extension's cleanLook.
{
  const pet = localEntry('L1', { 0: 'd.png', 2: 'e2.png' }), other = extensionEntry('X1');
  const saved = { L1: { expression: '2', heights: { 0: 350 }, mirror: true }, X1: { look: { costume: 9 }, expression: '6' }, L3: { expression: '7' } };
  assert.deepEqual(profiles.selectionFor(saved, pet), { characterId: 'L1', look: null, expression: '2' });
  assert.deepEqual(profiles.selectionFor(saved, localEntry('L3', { 0: 'd.png' })), { characterId: 'L3', look: null, expression: '0' }, 'missing picture: the default');
  assert.deepEqual(profiles.selectionFor(saved, other, (entry, look) => ({ costume: look?.costume === 9 ? 9 : 0 })), { characterId: 'X1', look: { costume: 9 }, expression: '6' });
  assert.deepEqual(profiles.selectionFor(saved, other), { characterId: 'X1', look: null, expression: '6' });
  assert.deepEqual(profiles.selectionFor(saved, undefined), { characterId: '', look: null, expression: '' });
  assert.equal(profiles.heightFor(saved, 'L1', '0'), 350);
  assert.equal(profiles.heightFor(saved, 'L1', 'tall'), profiles.DEFAULT_HEIGHT);
  assert.deepEqual([profiles.mirrorFor(saved, 'L1'), profiles.mirrorFor(saved, 'X1')], [true, false]);
  assert.deepEqual(profiles.tuningFor(saved, 'L1'), profiles.TUNING_DEFAULTS);
  assert.deepEqual(profiles.desktopFor({ L1: { desktop: { shown: true, locked: true, opacity: 30 } } }, 'L1'), { shown: true, locked: true, opacity: 30 });
  assert.deepEqual(profiles.desktopFor(saved, 'X1'), off());
  assert.deepEqual(profiles.keepProfilesFor({ L1: {}, L9: {} }, [pet]), { L1: {} });
}

// Layer order: front first, saved order kept, newly shown characters on top; characters taken off keep their place.
{
  const shown = () => ({ desktop: { shown: true } });
  assert.deepEqual(profiles.layerOrder(['2', '1'], { 1: shown(), 2: shown(), 3: shown() }), ['3', '2', '1']);
  const order = profiles.layerOrder(['2', '1'], { 1: shown(), 2: { desktop: { shown: false } } });
  assert.deepEqual(order, ['2', '1'], 'a character taken off keeps its place');
  assert.deepEqual(profiles.shownLayers(order, { 1: shown(), 2: { desktop: { shown: false } } }), ['1']);
  assert.deepEqual(profiles.shownLayers(profiles.layerOrder(order, { 1: shown(), 2: shown() }), { 1: shown(), 2: shown() }), ['2', '1'], 'and returns to it');
  assert.deepEqual(profiles.layerOrder(['2', '1'], { 1: shown() }), ['1'], 'characters no longer in the library are dropped');
  assert.deepEqual(profiles.layerOrder('nonsense', {}), []);
}

// Input checks used by the app's IPC handlers.
assert.equal(profiles.expressionId('12'), '12');
for (const bad of ['', '1234', 'a', 5, null]) assert.equal(profiles.expressionId(bad), '');
assert.equal(profiles.clampHeight(10), profiles.MIN_HEIGHT);
assert.deepEqual([profiles.clampOpacity(0), profiles.clampOpacity(1), profiles.clampOpacity(150)], [1, 1, 100]);

// Pins: ids only, each once, in order. 自動戳: kept only when not the 180 s default, 0–600 s in steps of 10.
assert.deepEqual(profiles.cleanSettings({ pinned: ['L2', 'L1', 'L2', 'bad id!', 7] }).pinned, ['L2', 'L1', '7']);
assert.deepEqual([profiles.cleanDesktop({ autoPoke: 180 }), profiles.cleanDesktop({ autoPoke: 0 }).autoPoke, profiles.cleanDesktop({ autoPoke: 9999 }).autoPoke, profiles.cleanDesktop({ autoPoke: 34 }).autoPoke],
  [{ shown: false, locked: false, opacity: 100 }, 0, 600, 30]);
assert.deepEqual([profiles.autoPokeOf({}), profiles.autoPokeOf({ autoPoke: 0 }), profiles.AUTO_POKE_DEFAULT], [180, 0, 180]);

// Groups: valid ones only (an id G<n>, a name, members), their members' profiles cleaned; a group out keeps each
// member's own profile; its place in the layers is 'G:<id>', dropped when the group is gone.
const grouped = profiles.cleanSettings({
  characters: { L1: {}, L2: {} }, layers: ['G:G1', 'L1', 'G:G9', 'L2'],
  groups: [{ id: 'G1', name: '  Swimming   Team ', members: ['L1', 'L2', 'L1', 'bad id!'], profiles: { L1: { expression: '2', junk: 1 }, L2: {} } }, { id: 'X', name: 'no', members: ['L1'], profiles: {} }, { id: 'G2', name: '', members: ['L1'], profiles: {} }],
  active: { G1: { previous: { L1: { expression: '1' }, L2: {} } }, G9: { previous: {} } }
});
assert.deepEqual(grouped.groups, [{ id: 'G1', name: 'Swimming Team', members: ['L1', 'L2'], profiles: { L1: { expression: '2' }, L2: {} } }]);
assert.deepEqual([grouped.active, grouped.layers], [{ G1: { previous: { L1: { expression: '1' }, L2: {} } } }, ['G:G1', 'L1', 'L2']]);

console.log(JSON.stringify({ ok: true, settings: true, selection: true, heights: true, mirror: true, desktop: true, layers: true, validation: true, pins: true, autoPoke: true, groups: true }));
