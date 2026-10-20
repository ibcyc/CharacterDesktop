// Regression test of the app itself, with local characters made from pictures the test writes; no extension is
// installed. Nothing is shown on screen: in self-test mode no window is displayed, and the test fails if one ever is.
// The data folder (from the build) also holds X1, a character of an extension that is not installed: it must never
// show anywhere, and its entry and settings must outlive everything but 重置並清空全部.
const fs = require('node:fs');
const path = require('node:path');

async function run(ctx) {
  const { app, getPet, getPets, getStack, getRaised, restack, getTray, clickTray, isDragging, getState, stageLocal, dataRoot, report } = ctx;
  const { sleep, waitFor, createChecks, tracesOf, pageHelpers } = ctx.helpers;
  const { results, check } = createChecks();
  const { page, petPage, hidden, settle, choose, click, slide, switchTo, answerDialog, lastPreviewPoke, petMetrics, petReady, desktop } = pageHelpers(ctx);
  const layerButton = (id, button) => `[...$('layers').children].find(row => row.dataset.id === ${JSON.stringify(id)}).querySelector('.${button}').click(); true`;
  const dragFrom = selector => `(() => { const e = new DragEvent('dragstart', { bubbles: true, cancelable: true }); document.querySelector(${JSON.stringify(selector)}).dispatchEvent(e); return e.defaultPrevented; })()`;

  // ---------- Pictures and the first character ----------
  const pictures = path.join(path.dirname(dataRoot), 'local-sources');
  const svg = color => `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="200"><rect width="100" height="200" fill="${color}"/></svg>`;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const write = (folder, files) => {
    fs.mkdirSync(path.join(pictures, folder), { recursive: true });
    for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(pictures, folder, name), data);
    return path.join(pictures, folder);
  };
  const add = async (staged, name, id) => {
    await page(`desktopWorkflowTest.showPicked(${JSON.stringify(staged)}); $('local-name').value = ${JSON.stringify(name)}; true`);
    const added = await page('desktopWorkflowTest.addLocal()');
    await waitFor(() => page(`$('character').value === ${JSON.stringify(id)}`), id + ' added');
    await settle();
    return added;
  };

  await waitFor(() => page('!!window.desktopSettingsTest'), 'settings page');
  // X1, of an extension that is not installed: nowhere on the page or the desktop, yet kept as it was.
  const savedFile = file => JSON.parse(fs.readFileSync(path.join(dataRoot, file), 'utf8'));
  const hiddenEntry = savedFile('library.json').find(entry => entry.id === 'X1'), hiddenProfile = structuredClone(savedFile('settings.json').characters.X1);
  // Not in the list, the desktop or the layers, not on the page, and the page is never even given its data.
  const notShown = async () => [
    getState().library.some(entry => entry.id === 'X1'), getPets().includes('X1'), getState().options.layers.some(layer => layer.id === 'X1'),
    await page(`document.body.innerText.includes('Hidden') || [...document.querySelectorAll('option')].some(option => option.textContent.includes('Hidden'))`),
    'X1' in getState().characters || JSON.stringify(getState()).includes('X1'), await page(`JSON.stringify(profiles).includes('X1') || JSON.stringify([...library.keys()]).includes('X1')`)
  ];
  const nowhere = [false, false, false, false, false, false];
  const hiddenFiles = path.join(dataRoot, 'Extensions', 'elsewhere');
  const kept = () => [savedFile('library.json').find(entry => entry.id === 'X1'), savedFile('settings.json').characters.X1, savedFile('settings.json').layers.includes('X1') && savedFile('settings.json').pinned.includes('X1'),
    fs.existsSync(path.join(hiddenFiles, 'Characters', 'X1', 'picture.png'))];
  check('character of a missing extension kept', [hiddenEntry?.name, hiddenProfile], ['Hidden One', { look: { pose: 1 }, expression: '3', heights: { pose1: 640 }, desktop: { shown: true, locked: false, opacity: 70, x: 100, y: 100, autoPoke: 30 }, mirror: true, options: { a: 1 } }]);
  check('character of a missing extension not shown at start', await notShown(), nowhere);
  check('empty app', [getState().library, await page(`[$('status').hidden, $('desktop-panel').hidden, $('download-toggle').hidden, $('local-panel').hidden]`)], [[], [true, true, true, false]]);

  // 1. A folder takes d and e1, e2…; anything else is reported and left out; unusable folders are refused.
  const folder = write('My Pet', { 'd.svg': svg('#c05030'), 'E1.svg': svg('#3050c0'), 'e2.png': png, 'notes.txt': 'x', 'other.png': png });
  check('folder without usable files refused', stageLocal('folder', write('wrong', { 'a.png': png, 'b.txt': 'x' })).message.includes('沒有可用的檔案'), true);
  check('two files for one picture refused', stageLocal('folder', write('twice', { 'd.svg': svg('red'), 'e1.svg': svg('red'), 'e1.png': png })).message.includes('同一張圖有兩個檔案'), true);
  const staged = stageLocal('folder', folder);
  check('folder checked before adding', [staged.ok, staged.label, staged.skipped.sort()], [true, 'My Pet', ['notes.txt', 'other.png']]);
  // The name field starts empty, so its placeholder shows; the file panel opens to the right of its button, as wide
  // as its row of buttons.
  check('name field empty', await page(`desktopWorkflowTest.showPicked(${JSON.stringify(staged)}); [$('local-name').value, $('local-name').placeholder, $('local-panel').getBoundingClientRect().left >= $('local-toggle').getBoundingClientRect().right]`), ['', '角色名稱', true]);
  check('file panel as wide as its buttons', await page(`(() => { const panel = $('local-panel').getBoundingClientRect(), help = $('local-help-toggle').getBoundingClientRect(); return panel.right - help.right < 20; })()`), true);
  const added = await add(staged, 'Test Pet', 'L1');
  check('not imported files listed', await page(`$('local-chosen').textContent.includes('notes.txt') && $('local-status').textContent.includes('other.png')`), true);
  check('local character added', [added.ok, added.expressions, fs.readdirSync(path.join(dataRoot, 'Local', '1')).sort()], [true, 2, ['d.svg', 'e1.svg', 'e2.png']]);
  check('missing-extension character still not shown', await notShown(), nowhere);
  check('original folder untouched', fs.readdirSync(folder).sort(), ['E1.svg', 'd.svg', 'e2.png', 'notes.txt', 'other.png']);

  // 2. The page with a character: hint and desktop panel shown, nothing selectable, only layer rows draggable.
  check('page with a character', await page(`[$('status').hidden, $('desktop-panel').hidden, getComputedStyle(document.body).userSelect, getComputedStyle($('local-name')).userSelect, ${dragFrom('#viewer-image')}, ${dragFrom('#desktop-height')}]`),
    [false, false, 'none', 'text', true, true]);
  check('local character controls', await page(`({
    label: $('character').selectedOptions[0].textContent,
    shown: ['character-rename', 'local-folder-field', 'tuning-field', 'expression-field'].filter(id => !$(id).hidden),
    expressions: [...$('expression').options].map(option => option.value + ' ' + option.textContent)
  })`), { label: '[L] Test Pet', shown: ['character-rename', 'local-folder-field', 'tuning-field', 'expression-field'], expressions: ['0 Default', '1 Expression 1', '2 Expression 2'] });
  // 水平鏡像 is a general choice: right under the character, above the expressions; not inside 細部調整.
  check('mirror switch under the character', await page(`[$('mirror-field').hidden, !!($('mirror-field').compareDocumentPosition($('expression-field')) & Node.DOCUMENT_POSITION_FOLLOWING), $('tuning-options').contains($('mirror-toggle'))]`), [false, true, false]);
  await waitFor(() => getPets().includes('L1'), 'L1 on the desktop');
  await petReady('L1');
  check('picture outline takes the mouse', await petPage(`[desktopTest.opaqueAt(innerWidth / 2, innerHeight * 0.6), desktopTest.opaqueAt(2, 2)]`, 'L1'), [true, false]);

  // 3. 細部調整 and mirroring: kept per character and shown on the desktop; pokes show the chosen expressions.
  await page(`desktopWorkflowTest.changeTuning({ bounce: 80, pokeFace: '1', fifthFace: '2' }); $('mirror-toggle').checked = true; $('mirror-toggle').dispatchEvent(new Event('change')); true`);
  await waitFor(() => getState().characters.L1?.tuning?.fifthFace === '2' && getState().characters.L1?.mirror, 'tuning and mirror saved');
  await waitFor(() => petPage(`desktopTest.getMetrics().picture.mirror && desktopTest.getMetrics().picture.tuning.bounce === 80`, 'L1'), 'tuning on the desktop');
  check('tuning saved', [getState().characters.L1.tuning, getState().characters.L1.mirror], [{ breath: 40, rate: 15, bounce: 80, pokeFace: '1', fifthFace: '2' }, true]);
  const pokes = [];
  for (let i = 0; i < 5; i++) { await petPage('desktopTest.poke()', 'L1'); pokes.push((await petMetrics('L1')).lastPlan); }
  check('pokes: chosen expression, fifth the other', pokes.map(plan => [plan.local, plan.special, plan.expression]), [[true, false, '1'], [true, false, '1'], [true, false, '1'], [true, false, '1'], [true, true, '2']]);
  check('mirrored and bouncing on the desktop', /^scale\(-/.test((await petMetrics('L1')).picture.transform), true);
  check('mirror keeps the outline', await petPage(`desktopTest.opaqueAt(innerWidth / 2, innerHeight * 0.6)`, 'L1'), true);
  await page(`$('viewer-canvas').dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true })); true`);
  check('preview poke', (await lastPreviewPoke()).plan.local, true);
  await choose('expression', '2');
  check('expression chosen', [getState().selection.expression, getState().characters.L1.expression], ['2', '2']);
  // Pictures changed faster than they decode: no error, and the newest one shows. A broken picture still fails.
  check('pictures changed while decoding', await page(`(async () => {
    const entry = currentEntry(), player = picturePlayer();
    const [a, b] = await Promise.all([localImageURL(entry, '0'), localImageURL(entry, '1')]);
    const shows = await Promise.allSettled([player.show(a), player.show(b), player.show(a), player.show(b)]);
    const broken = await player.show('data:image/png;base64,AAAA').then(() => 'shown', () => 'error');
    await showLocalPicture();
    const wanted = await localImageURL(entry, localPokes.temporaryExpression || $('expression').value);
    return [shows.map(result => result.status), broken, player.img.getAttribute('src') === player.url, player.url === wanted];
  })()`), [['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled'], 'error', true, true]);

  // The expression menu: a hovered expression shows in the preview only, until the mouse leaves the list; ↑↓ preview
  // and Enter chooses; Esc closes and shows the chosen one again.
  const showing = expression => page(`(async () => picturePlayer().url === await localImageURL(currentEntry(), ${JSON.stringify(expression)}))()`);
  const menuKey = key => page(`$('expression-list').dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true })); true`);
  const packetsBeforeMenu = (await petMetrics('L1')).packets;
  await page(`localPokes.reset(); $('expression-button').click(); true`);
  check('expression menu opens', await page(`[$('expression-list').hidden, [...$('expression-list').children].map(item => item.textContent + (item.getAttribute('aria-selected') === 'true' ? ' *' : ''))]`),
    [false, ['Default', 'Expression 1', 'Expression 2 *']]);
  await page(`$('expression-list').children[0].dispatchEvent(new PointerEvent('pointerenter')); true`);
  await waitFor(() => showing('0'), 'hovered expression in the preview');
  check('hover only previews', [await page(`$('expression').value`), getState().selection.expression, (await petMetrics('L1')).packets], ['2', '2', packetsBeforeMenu]);
  await page(`$('expression-list').dispatchEvent(new PointerEvent('pointerleave')); true`);
  await waitFor(() => showing('2'), 'chosen expression back after leaving the list');
  await menuKey('ArrowDown');
  await waitFor(() => showing('1'), 'arrow key previews');
  await menuKey('Enter');
  await waitFor(() => getState().selection.expression === '1', 'Enter chooses');
  check('chosen from the menu', [await page(`[$('expression-list').hidden, $('expression').value, $('expression-current').textContent]`), getState().characters.L1.expression, await showing('1')], [[true, '1', 'Expression 1'], '1', true]);
  await page(`$('expression-button').click(); true`);
  await menuKey('ArrowUp');
  await waitFor(() => showing('0'), 'arrow key previews again');
  await menuKey('Escape');
  await waitFor(() => showing('1'), 'Esc shows the chosen expression again');
  check('Esc closes without choosing', [await page(`$('expression-list').hidden`), getState().selection.expression], [true, '1']);
  await choose('expression', '2');
  check('menu follows the hidden menu', await page(`$('expression-current').textContent`), 'Expression 2');
  // The poke menus of 細部調整 preview the same way; 不變 shows the chosen expression. One list is open at a time.
  await page(`$('expression-button').click(); $('tuning-poke-button').click(); $('tuning-poke-list').children[1].dispatchEvent(new PointerEvent('pointerenter')); true`);
  check('one list open at a time', await page(`[$('expression-list').hidden, $('tuning-poke-list').hidden, [...$('tuning-poke-list').children].map(item => item.textContent)]`), [true, false, ['不變', 'Default', 'Expression 1', 'Expression 2']]);
  await waitFor(() => showing('0'), 'poke menu previews');
  await page(`$('tuning-poke-list').children[0].dispatchEvent(new PointerEvent('pointerenter')); true`);
  await waitFor(() => showing('2'), '不變 shows the chosen expression');
  await page(`$('tuning-poke-list').children[3].click(); true`);
  await waitFor(() => getState().characters.L1.tuning.pokeFace === '2', 'poke expression chosen from its menu');
  check('poke menu chosen', [await page(`[$('tuning-poke-list').hidden, $('tuning-poke').value, $('tuning-poke-current').textContent]`), getState().selection.expression], [[true, '2', 'Expression 2'], '2']);

  // 自動戳 (under height and opacity, only while the character is on the desktop): 180 s at first, kept per
  // character only when changed; 0 turns it off. The desktop page pokes as if clicked.
  check('auto-poke at first', [await page(`[$('autopoke-field').hidden, $('desktop-autopoke').value, $('desktop-autopoke-label').textContent]`), await petPage('desktopTest.autoPoke()', 'L1'), 'autoPoke' in getState().characters.L1.desktop],
    [[false, '180', '180 秒'], { seconds: 180, armed: true }, false]);
  check('auto-poke under opacity', await page(`!!($('desktop-opacity').compareDocumentPosition($('desktop-autopoke')) & Node.DOCUMENT_POSITION_FOLLOWING)`), true);
  await slide('desktop-autopoke', 0);
  await waitFor(async () => !(await petPage('desktopTest.autoPoke()', 'L1')).armed, 'auto-poke off');
  check('auto-poke off', [await page(`$('desktop-autopoke-label').textContent`), getState().characters.L1.desktop.autoPoke], ['關閉', 0]);
  await slide('desktop-autopoke', 20);
  await waitFor(async () => (await petPage('desktopTest.autoPoke()', 'L1')).seconds === 20, 'auto-poke every 20 s');
  await petPage('desktopTest.autoPokeNow(); true', 'L1');
  check('auto-poke', [getState().characters.L1.desktop.autoPoke, (await petMetrics('L1')).lastPlan?.local, savedFile('settings.json').characters.L1.desktop.autoPoke], [20, true, 20]);

  // 4. Rename (pencil) and the folder button; the self-tests never open Explorer.
  await page(`$('character-rename').click(); $('rename-input').value = 'Renamed'; true`);
  await page('desktopWorkflowTest.saveRename()');
  check('renamed', [getState().library.find(entry => entry.id === 'L1').name, await page(`$('character').selectedOptions[0].textContent`), await page(`$('rename-row').hidden`)], ['Renamed', '[L] Renamed', true]);
  check('folder button', (await page(`window.desktopAPI.openLocalFolder('L1')`)).folder, path.join(dataRoot, 'Local', '1'));

  // 5. A single picture becomes d; with only d there is no expression to choose for pokes.
  await add(stageLocal('file', path.join(folder, 'E1.svg')), 'Photo', 'L2');
  check('single picture', [fs.readdirSync(path.join(dataRoot, 'Local', '2')), await page(`[...$('expression').options].map(option => option.value)`), await page(`$('tuning-poke-field').hidden`)], [['d.svg'], ['0'], true]);

  // 6. Height per character; changing it sends no character data again; a slider being dragged is not moved by replies.
  await switchTo('L1');
  const packetsBefore = (await petMetrics('L1')).packets;
  await slide('desktop-height', 310); await slide('desktop-height', 305); await slide('desktop-height', 300);
  check('height of L1', [desktop().height, getPet('L1').getBounds().height], [300, 300]);
  check('height changes send no character data', (await petMetrics('L1')).packets, packetsBefore);
  check('dragged slider keeps its place', await page(`(() => {
    const slider = $('desktop-height');
    slider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    slider.value = 640;
    showDesktopOptions({ ...lastOptions, height: 300 });
    const during = Number(slider.value);
    window.dispatchEvent(new PointerEvent('pointerup'));
    return [during, Number(slider.value)];
  })()`), [640, 300]);
  await switchTo('L2');
  check('L2 uses the default height', desktop().height, 500);
  await switchTo('L1');
  check('L1 height restored', [desktop().height, Number(await page(`$('desktop-height').value`))], [300, 300]);

  // 7. Several characters on the desktop: own window, opacity and place each; layer order; lock; right-click edit.
  check('two windows', [...getPets()].sort(), ['L1', 'L2']);
  check('newest character in front', [getState().options.layers.map(layer => layer.id), getStack()], [['L2', 'L1'], ['L2', 'L1']]);
  await slide('desktop-opacity', 80);
  await switchTo('L2');
  await slide('desktop-opacity', 40);
  check('opacity per character', [Math.round(getPet('L1').getOpacity() * 100), Math.round(getPet('L2').getOpacity() * 100), Number(await page(`$('desktop-opacity').value`))], [80, 40, 40]);
  check('separate places', getPet('L1').getBounds().x !== getPet('L2').getBounds().x, true);
  await page(`desktopSettingsTest.moveLayer('L1', 0)`);
  await sleep(300);
  check('layer order changed', [getState().options.layers.map(layer => layer.id), getStack()], [['L1', 'L2'], ['L1', 'L2']]);
  // The regular re-stack never raises a window over one in front of it (that made the front one flicker).
  const placeL2 = getPet('L2').getBounds(), placeL1 = getPet('L1').getBounds();
  getPet('L2').setBounds({ ...placeL2, x: placeL1.x + 20, y: placeL1.y });
  restack({ gentle: true });
  check('regular re-stack leaves a covered window', [getRaised(), getStack()], [['L1'], ['L1', 'L2']]);
  getPet('L2').setBounds({ ...placeL2, x: placeL1.x - placeL2.width - 40, y: placeL1.y });
  restack({ gentle: true });
  check('regular re-stack raises separate windows', getRaised(), ['L1', 'L2']);
  getPet('L2').setBounds(placeL2);
  restack();
  check('full re-stack raises every window', getRaised(), ['L1', 'L2']);
  await switchTo('L1');
  await click('desktop-lock');
  check('L1 locked', [getState().characters.L1.desktop.locked, await page(`$('desktop-lock').getAttribute('aria-pressed')`)], [true, 'true']);
  await petPage('window.desktopAPI.dragStart(); true', 'L1'); await sleep(200);
  check('locked character does not drag', isDragging('L1'), false);
  await click('desktop-lock');
  const dragFromHere = getPet('L1').getBounds();
  await petPage('window.desktopAPI.dragStart(100, 100); window.desktopAPI.dragTo(130, 112); window.desktopAPI.dragTo(140, 110); true', 'L1'); await sleep(200);
  const dragged = getPet('L1').getBounds();
  check('unlocked character drags with the pointer', [isDragging('L1'), dragged.x - dragFromHere.x, dragged.y - dragFromHere.y], [true, 40, 10]);
  await petPage('window.desktopAPI.dragEnd(); true', 'L1'); await sleep(200);
  check('drag ends', isDragging('L1'), false);
  await page(layerButton('L2', 'lock'));
  await sleep(400);
  check('L2 locked from its layer row', getState().characters.L2.desktop.locked, true);
  await petPage('window.desktopAPI.openSettings(); true', 'L2');
  await waitFor(() => page(`$('character').value === 'L2'`), 'edit L2 from the desktop');
  await settle();
  check('right-click edits that character', await page(`$('character').value`), 'L2');
  await click('desktop-visible');
  await waitFor(() => !getPets().includes('L2'), 'L2 off the desktop');
  check('one window left', [getPets(), getState().options.layers.map(layer => layer.id)], [['L1'], ['L1']]);
  await click('desktop-visible');
  await waitFor(() => getPets().includes('L2'), 'L2 back on the desktop');
  check('L2 returns to its old layer', getState().options.layers.map(layer => layer.id), ['L1', 'L2']);
  check('layer rows can still be dragged', await page(dragFrom('#layers .layer')), false);
  // The close button on a layer row takes that character off the desktop, like the show/hide switch.
  await page(layerButton('L2', 'close'));
  await waitFor(() => !getPets().includes('L2'), 'L2 off again');
  await settle();
  check('layer close button', [getState().characters.L2.desktop.shown, await page(`$('desktop-visible').checked`), getState().options.layers.map(layer => layer.id)], [false, false, ['L1']]);
  // With nothing on the desktop the layer list is hidden; it comes back with the first character there.
  await page(layerButton('L1', 'close'));
  await waitFor(() => !getPets().includes('L1'), 'L1 off');
  await settle();
  check('no layer list with nothing on the desktop', await page(`$('layers-field').hidden`), true);
  await switchTo('L1');
  await click('desktop-visible');
  await waitFor(() => getPets().includes('L1'), 'L1 back');
  check('layer list back', await page(`$('layers-field').hidden`), false);
  await switchTo('L2');
  check('no auto-poke off the desktop', [await page(`$('autopoke-field').hidden`), getPets()], [true, ['L1']]);
  await switchTo('L1');

  // 7b. Pins in the character menu: a pinned character comes first (a line after the pinned); kept by the app.
  await page(`$('character-button').click(); true`);
  const menu = () => page(`[...$('character-list').children].map(item => item.dataset.value + (item.classList.contains('pinned') ? ' pinned' : ''))`);
  check('character menu', [await menu(), await page(`[...$('character-list').children].every(item => item.querySelector('.pin'))`)], [['L1', 'L2'], true]);
  check('names fit in the list', await page(`[$('character-list').getBoundingClientRect().width >= $('character-button').getBoundingClientRect().width, [...$('character-list').querySelectorAll('li>span')].every(label => label.scrollWidth <= label.clientWidth)]`), [true, true]);
  await page(`$('character-list').children[1].querySelector('.pin').click(); true`);
  await waitFor(async () => (await menu())[0] === 'L2 pinned', 'L2 pinned');
  check('pinned first', [await menu(), await page(`[...$('character').options].map(option => option.value)`), getState().pinned, await page(`$('character-list').hidden`), await page(`$('character').value`)],
    [['L2 pinned', 'L1'], ['L2', 'L1'], ['L2'], false, 'L1']);
  await page(`$('character-list').children[0].querySelector('.pin').click(); true`);
  await waitFor(async () => (await menu())[0] === 'L1', 'L2 unpinned');
  await page(`$('character-list').children[1].querySelector('.pin').click(); true`);
  await waitFor(async () => (await menu())[0] === 'L2 pinned', 'L2 pinned again');
  await page(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); $('character-list').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
  await sleep(500);
  check('pins kept', [savedFile('settings.json').pinned.filter(id => id !== 'X1'), await page(`$('character-list').hidden`)], [['L2'], true]);

  // 7c. 組合: Shift+click chooses characters in the layer list; a right click on one of them offers 組合, which asks a
  // name and makes them a group, out at once: one row (its members listed when opened), moving together. Where it is
  // dropped is its place from now on; other changes while it is out are only for then. Closing it gives every member
  // back its own state, and a member's own later changes are never overwritten by the group. A character is out with
  // one group at most.
  await switchTo('L2');
  await click('desktop-visible');
  await waitFor(() => getPets().includes('L2'), 'L2 out for a group');
  await switchTo('L1');
  await choose('expression', '1');
  const rowEvent = (id, type, extra = '') => page(`[...$('layers').children].find(row => row.dataset.id === '${id}').dispatchEvent(new MouseEvent('${type}', { bubbles: true, cancelable: true, clientX: 300, clientY: 300${extra} })); true`);
  const layersNow = () => getState().options.layers.map(layer => layer.group ? [layer.name, layer.members.map(member => member.id)] : layer.id);
  const placeOf = id => { const { x, y } = getPet(id).getBounds(); return [x, y]; };
  const makeGroup = async name => {
    await rowEvent('L1', 'click', ', shiftKey: true');
    await rowEvent('L2', 'click', ', shiftKey: true');
    await rowEvent('L1', 'contextmenu');
    await page(`$('layer-group').click(); true`);
    await waitFor(() => page(`!$('dialog').hidden && !$('dialog-input').hidden`), 'name asked');
    await page(`$('dialog-input').value = ${JSON.stringify(name)}; true`);
    await answerDialog('ok');
    await waitFor(() => getState().options.groups.some(group => group.name === name && group.active), name + ' made');
    await settle();
  };
  const order = layersNow(), groupPlaces = [placeOf('L1'), placeOf('L2')];
  await rowEvent('L1', 'click', ', shiftKey: true');
  await rowEvent('L2', 'click', ', shiftKey: true');
  check('chosen with Shift', await page(`[...$('layers').querySelectorAll('.layer.selected')].map(row => row.dataset.id).sort()`), ['L1', 'L2']);
  await rowEvent('L1', 'contextmenu');
  check('layer menu', await page(`[$('layer-menu').hidden, $('layer-group').textContent]`), [false, '組合']);
  await page(`$('layer-group').click(); true`);
  await waitFor(() => page(`!$('dialog').hidden && !$('dialog-input').hidden`), 'name asked');
  check('name asked in the page', await page(`[$('dialog-title').textContent, document.activeElement === $('dialog-input'), [...$('dialog-buttons').children].map(button => button.textContent)]`), ['組合', true, ['取消', '組合']]);
  await page(`$('dialog-input').value = 'Swimming Team'; true`);
  await answerDialog('ok');
  await waitFor(() => getState().options.groups.length === 1, 'group made');
  await settle();
  check('group made', [getState().options.groups, layersNow(), getPets().sort(), await page(`$('layers').querySelectorAll('.layer.selected').length`)],
    [[{ id: 'G1', name: 'Swimming Team', members: order, active: true }], [['Swimming Team', order]], ['L1', 'L2'], 0]);
  await page(`$('layers').querySelector('.layer.group .layer-line').click(); true`);
  check('members under the group', await page(`[...$('layers').querySelectorAll('.layer.group .layer-members li')].filter(item => item.offsetParent).map(item => item.dataset.id)`), order);
  // Dragging one member moves them all.
  await petPage('window.desktopAPI.dragStart(100, 100); window.desktopAPI.dragTo(150, 120); true', 'L1');
  await sleep(200);
  const moved = groupPlaces.map(([x, y]) => [x + 50, y + 20]), savedPlaces = () => ['L1', 'L2'].map(id => { const { x, y } = savedFile('settings.json').groups[0].profiles[id].desktop; return [x, y]; });
  check('moving together', [placeOf('L1'), placeOf('L2')], moved);
  await petPage('window.desktopAPI.dragEnd(); true', 'L1');
  await waitFor(() => JSON.stringify(savedPlaces()) === JSON.stringify(moved), 'group place saved');
  await choose('expression', '2');
  check('a change while out', getState().characters.L1.expression, '2');
  await page(layerButton('G:G1', 'close'));
  await waitFor(() => !getState().options.groups[0].active, 'group closed');
  await settle();
  check('closed: each as before', [layersNow(), getState().characters.L1.expression, placeOf('L1'), placeOf('L2')], [order, '1', ...groupPlaces]);
  // L1's own change, then the group again: out as it was made; closed, L1 keeps its own change.
  await switchTo('L1');
  await choose('expression', '2');
  await page(`$('groups-toggle').click(); true`);
  check('groups button and list', await page(`[$('groups-panel').hidden, [...$('groups-panel').querySelectorAll('.group-name')].map(button => button.textContent), (() => {
    const power = $('quit').getBoundingClientRect(), groups = $('groups-toggle').getBoundingClientRect(), menu = $('app-menu-toggle').getBoundingClientRect();
    return power.right <= groups.left && groups.right <= menu.left && Math.abs(groups.top - menu.top) < 1;
  })()]`), [false, ['Swimming Team'], true]);
  await page(`$('groups-panel').querySelector('.group-name').click(); true`);
  await waitFor(() => getState().options.groups[0].active, 'group out again');
  await settle();
  check('out as made, where it was dropped', [getState().characters.L1.expression, placeOf('L1'), placeOf('L2'), await page(`$('groups-panel').hidden`)], ['1', ...moved, true]);
  await page(layerButton('G:G1', 'close'));
  await waitFor(() => !getState().options.groups[0].active, 'group closed again');
  await settle();
  check('own change kept', getState().characters.L1.expression, '2');
  // A second group of the same characters cannot come out while the first is out.
  await makeGroup('Pair');
  await page(layerButton('G:G2', 'close'));
  await waitFor(() => !getState().options.groups[1].active, 'Pair closed');
  await page(`$('groups-toggle').click(); [...$('groups-panel').querySelectorAll('.group-name')].find(button => button.textContent === 'Swimming Team').click(); true`);
  await waitFor(() => getState().options.groups[0].active, 'Swimming Team out');
  await page(`$('groups-toggle').click(); [...$('groups-panel').querySelectorAll('.group-name')].find(button => button.textContent === 'Pair').click(); true`);
  await sleep(300);
  check('one group at a time', [getState().options.groups.map(group => group.active), await page(`$('groups-panel').querySelector('.groups-status').textContent.includes('請先關掉那個組合')`)], [[true, false], true]);
  await page(layerButton('G:G1', 'close'));
  await waitFor(() => !getState().options.groups[0].active, 'Swimming Team closed');
  await settle();
  // Deleting a group (after asking) leaves its characters as they are.
  await page(`$('groups-toggle').click(); [...$('groups-panel').querySelectorAll('.group-item')].find(item => item.textContent === 'Pair').querySelector('.icon-button:last-child').click(); true`);
  await answerDialog('ok');
  await waitFor(() => getState().options.groups.length === 1, 'Pair deleted');
  await waitFor(() => savedFile('settings.json').groups.length === 1, 'deletion saved');
  check('group deleted', [getState().options.groups.map(group => group.name), getState().characters.L1.expression, savedFile('settings.json').groups.map(group => group.name)], [['Swimming Team'], '2', ['Swimming Team']]);
  await page(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`);

  // 7d. ✎ edits a group: it comes out with its members as rows of their own (to put in order, each dragged by
  // itself); 保存 (above the power button's row) keeps how they are and their order as the group, ✕ goes back to it,
  // and 從組合中移除 (next to the show/hide switch) lets a member go, one staying at least.
  await choose('expression', '1');
  const pencil = name => page(`$('groups-toggle').click(); [...$('groups-panel').querySelectorAll('.group-item')].find(item => item.textContent === ${JSON.stringify(name)}).querySelector('.icon-button').click(); true`);
  const groupNow = () => savedFile('settings.json').groups[0];
  await pencil('Swimming Team');
  await waitFor(() => getState().options.editing?.id === 'G1', 'editing');
  await settle();
  check('editing', [getState().options.editing, layersNow(), await page(`[$('groups-panel').hidden, $('group-edit').hidden, $('group-edit-name').textContent, $('layers').querySelectorAll('.layer.editing').length, (() => {
    const bar = $('group-edit').getBoundingClientRect(), power = $('quit').getBoundingClientRect();
    return bar.bottom <= power.top && bar.right >= power.right;
  })()]`), getState().characters.L1.expression], [{ id: 'G1', name: 'Swimming Team', members: order }, order, [true, false, '編輯中：Swimming Team', 2, true], '1']);
  const reversed = [...order].reverse();
  await page(`desktopSettingsTest.moveLayer(${JSON.stringify(order[1])}, 0)`);
  await choose('expression', '2');
  await petPage('window.desktopAPI.dragStart(100, 100); window.desktopAPI.dragTo(130, 110); true', 'L1');
  await sleep(200);
  check('editing: in order, each by itself', [layersNow(), placeOf('L1'), placeOf('L2')], [reversed, [moved[0][0] + 30, moved[0][1] + 10], moved[1]]);
  await petPage('window.desktopAPI.dragEnd(); true', 'L1');
  await sleep(200);
  await page(`$('group-save').click(); true`);
  await waitFor(() => JSON.stringify(groupNow().members) === JSON.stringify(reversed), 'edit saved');
  await settle();
  const editedPlace = [moved[0][0] + 30, moved[0][1] + 10];
  check('saved', [getState().options.editing, layersNow(), await page(`$('group-edit').hidden`), groupNow().profiles.L1.expression, [groupNow().profiles.L1.desktop.x, groupNow().profiles.L1.desktop.y].map(Math.round)],
    [null, [['Swimming Team', reversed]], true, '2', editedPlace]);
  // Closed: each as before; out again: as saved.
  await page(layerButton('G:G1', 'close'));
  await waitFor(() => !getState().options.groups[0].active, 'edited group closed');
  await settle();
  check('closed after the edit', [getState().characters.L1.expression, placeOf('L1')], ['1', groupPlaces[0]]);
  await page(`$('groups-toggle').click(); $('groups-panel').querySelector('.group-name').click(); true`);
  await waitFor(() => getState().options.groups[0].active, 'edited group out');
  await settle();
  check('out as saved', [getState().characters.L1.expression, placeOf('L1'), placeOf('L2'), layersNow()], ['2', editedPlace, moved[1], [['Swimming Team', reversed]]]);
  // 從組合中移除, then ✕: the member is back in the group as the group has it.
  await pencil('Swimming Team');
  await waitFor(() => getState().options.editing?.id === 'G1', 'editing again');
  await switchTo('L2');
  await waitFor(() => page(`!$('group-leave').hidden`), 'leave shown');
  check('leave button by the switch', await page(`[$('group-leave').textContent, $('group-leave').disabled, $('group-leave').parentElement === $('desktop-visible').parentElement]`), ['從組合中移除', false, true]);
  await page(`$('group-leave').click(); true`);
  await waitFor(() => getState().options.editing?.members.length === 1, 'L2 left');
  await settle();
  check('left the group', [getState().options.editing.members, getPets().sort(), await page(`$('group-leave').hidden`)], [['L1'], ['L1', 'L2'], true]);
  await switchTo('L1');
  await waitFor(() => page(`!$('group-leave').hidden`), 'leave shown for L1');
  check('the last member stays', await page(`$('group-leave').disabled`), true);
  await page(`$('group-cancel').click(); true`);
  await waitFor(() => !getState().options.editing, 'edit cancelled');
  await settle();
  check('cancelled', [layersNow(), groupNow().members, await page(`[$('group-edit').hidden, $('group-leave').hidden]`)], [[['Swimming Team', reversed]], reversed, [true, true]]);
  // 從組合中移除 and 保存: the group is the one left.
  await pencil('Swimming Team');
  await waitFor(() => getState().options.editing?.id === 'G1', 'editing a third time');
  await switchTo('L2');
  await waitFor(() => page(`!$('group-leave').hidden`), 'leave shown again');
  await page(`$('group-leave').click(); true`);
  await waitFor(() => getState().options.editing?.members.length === 1, 'L2 left again');
  await page(`$('group-save').click(); true`);
  await waitFor(() => groupNow().members.length === 1, 'smaller group saved');
  check('member removed', [getState().options.groups.map(group => [group.name, group.members]), Object.keys(groupNow().profiles)], [[['Swimming Team', ['L1']]], ['L1']]);
  await page(layerButton('G:G1', 'close'));
  await waitFor(() => !getState().options.groups[0].active, 'smaller group closed');
  await settle();
  await switchTo('L1');
  await choose('expression', '2');
  await switchTo('L2');
  await click('desktop-visible');
  await waitFor(() => !getPets().includes('L2'), 'L2 off again');
  await switchTo('L1');

  // 8. Tray icon (left click: hide all <-> show again; right click: settings), the power button and the memory meter.
  check('tray tip', getTray(), '角色桌面：左鍵全隱藏 · 右鍵開啟設定');
  clickTray('left'); await sleep(300);
  check('tray left click hides all', [getTray(), getState().options.visible, getState().characters.L1.desktop.shown], ['角色桌面：左鍵恢復顯示 · 右鍵開啟設定', false, true]);
  clickTray('left'); await sleep(300);
  check('tray left click shows again', [getTray(), getState().options.visible, getPets()], ['角色桌面：左鍵全隱藏 · 右鍵開啟設定', true, ['L1']]);
  clickTray('right'); await sleep(300);
  check('tray right click opens settings, nothing else', [getState().options.visible, ctx.getSettings().isDestroyed()], [true, false]);
  check('power button left of the menu button (never used by the self-tests)', [await page(`(() => {
    const power = $('quit').getBoundingClientRect(), menu = $('app-menu-toggle').getBoundingClientRect();
    return [$('quit').getAttribute('aria-label'), power.right <= menu.left && power.right > menu.left - 70, Math.abs(power.top - menu.top) < 1];
  })()`), await page('window.desktopAPI.quit()')], [['結束程序', true, true], false]);
  // The window's own title bar (the window is transparent, without the system's frame): 最小化, 最大化, 關閉 at the top
  // right; the side panels start under it.
  check('title bar', await page(`(() => {
    const bar = document.querySelector('.title-bar').getBoundingClientRect(), close = $('window-close').getBoundingClientRect();
    return [[...document.querySelectorAll('.title-bar button')].map(button => button.title), bar.top === 0 && bar.height === 32 && innerWidth - close.right < 1,
      [...document.querySelectorAll('.panel')].every(panel => panel.getBoundingClientRect().top >= bar.bottom), getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)' || getComputedStyle(document.documentElement).backgroundColor === 'rgba(0, 0, 0, 0)'];
  })()`), [['最小化', '最大化', '關閉'], true, true, true]);
  // The app menu (bottom right): opens upward to 來源, 匯出, 設定, 重啟 and 還原; the sources open to its left; Esc
  // closes both.
  const glassy = getState().glass;
  check('app menu closed', await page(`[$('app-menu').hidden, $('app-menu-toggle').getAttribute('aria-label')]`), [true, '選單']);
  check('no 工具 without a tool', await page(`$('tools-item').hidden`), true);
  await page(`$('app-menu-toggle').click(); true`);
  check('app menu opens upward', await page(`(() => {
    const menu = $('app-menu').getBoundingClientRect(), button = $('app-menu-toggle').getBoundingClientRect();
    return [$('app-menu').hidden, [...$('app-menu').querySelectorAll(':scope > button, :scope > .menu-item > button')].filter(item => item.offsetParent).map(item => item.textContent), menu.bottom <= button.top, Math.abs(menu.right - button.right) < 1, button.bottom <= innerHeight && innerWidth - button.right < 40];
  })()`), [false, ['來源', '匯出', '設定', '重啟', '還原'], true, true, true]);
  await page(`$('sources-toggle').click(); true`);
  check('sources to the left of the menu', await page(`[$('sources-panel').hidden, $('sources-panel').getBoundingClientRect().right <= $('app-menu').getBoundingClientRect().left]`), [false, true]);
  await page(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`);
  check('Esc closes the menu and the sources', await page(`[$('app-menu').hidden, $('sources-panel').hidden, $('app-menu-toggle').getAttribute('aria-expanded')]`), [true, true, 'false']);
  // 設定 › UI 設定: 背景透明度 (0 %, an opaque background, by default) and 模糊 (only with Windows' Acrylic glass);
  // only the background changes, the window follows the slider, the app keeps the values; 還原 › 還原 UI 設定 puts
  // them back.
  const ui = () => page(`[$('ui-panel').hidden, $('ui-transparency').value, $('ui-transparency-label').textContent, getComputedStyle(document.documentElement).getPropertyValue('--tint-edge'), $('ui-blur').checked, $('ui-blur-field').hidden]`);
  const buttonLook = () => page(`getComputedStyle($('sources-toggle')).backgroundColor`), lookBefore = await buttonLook();
  await page(`$('app-menu-toggle').click(); $('settings-toggle').click(); true`);
  check('設定 choices', await page(`[[...$('settings-menu').children].map(button => button.textContent), $('settings-menu').getBoundingClientRect().right <= $('settings-toggle').getBoundingClientRect().left]`), [['UI 設定'], true]);
  await page(`$('reset-toggle').click(); true`);
  check('one submenu at a time', await page(`[$('settings-menu').hidden, $('reset-menu').hidden]`), [true, false]);
  await page(`$('settings-toggle').click(); $('ui-toggle').click(); true`);
  check('UI 設定 replaces its submenu', await page(`[$('settings-menu').hidden, $('reset-menu').hidden, $('ui-panel').hidden]`), [true, true, false]);
  check('UI 設定 at its defaults', [await ui(), await page(`$('ui-panel').getBoundingClientRect().right <= $('app-menu').getBoundingClientRect().left`)], [[false, '0', '0%', '1.000', true, !glassy], true]);
  await page(`$('ui-transparency').value = 64; $('ui-transparency').dispatchEvent(new Event('input')); $('ui-transparency').dispatchEvent(new Event('change')); true`);
  await waitFor(() => savedFile('settings.json').ui?.transparency === 64, 'UI setting saved');
  check('背景透明度: only the background', [await ui(), await buttonLook()], [[false, '64', '64%', '0.360', true, !glassy], lookBefore]);
  if (glassy) {
    await page(`$('ui-blur').click(); true`);
    await waitFor(() => savedFile('settings.json').ui?.blur === false, '模糊 off saved');
    check('模糊 off', [(await ui())[4], getState().ui], [false, { transparency: 64, blur: false }]);
  }
  await page(`$('sources-toggle').click(); true`);
  check('one popup at a time', await page(`[$('ui-panel').hidden, $('sources-panel').hidden]`), [true, false]);
  await page(`$('reset-toggle').click(); $('reset-ui').click(); true`);
  await waitFor(() => Object.keys(savedFile('settings.json').ui).length === 0, 'UI settings reset');
  check('還原 UI 設定', [await ui(), getState().ui], [[true, '0', '0%', '1.000', true, !glassy], { transparency: 0, blur: true }]);
  await page(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`);
  // Questions are the page's own (no system message box): 取消 first, the action last.
  await page(`$('character-delete').click(); true`);
  check('styled question', await page(`[$('dialog-message').textContent, [...$('dialog-buttons').children].map(button => button.textContent + (button.classList.contains('danger') ? ' (danger)' : '')), document.activeElement.textContent, getComputedStyle($('dialog')).position]`),
    ['要刪除「Renamed」嗎？', ['取消', '刪除 (danger)'], '取消', 'fixed']);
  await page(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
  await sleep(300);
  check('Esc answers 取消', [await page(`$('dialog').hidden`), getState().library.some(entry => entry.id === 'L1')], [true, true]);
  check('restart button (never used by the self-tests)', [await page(`$('relaunch').textContent`), await page('window.desktopAPI.relaunch()')], ['重啟', false]);
  // The height slider reaches as far as the tallest display (no longer 1000 px).
  const tallest = Math.min(4320, Math.max(...require('electron').screen.getAllDisplays().map(display => display.workArea.height)));
  check('height limit', [getState().options.heightLimit, Number(await page(`$('desktop-height').max`))], [tallest, tallest]);
  const usage = await page('window.desktopAPI.getUsage()');
  check('usage meter', [usage.memoryMB > 50, Object.keys(usage)], [true, ['memoryMB']]);
  check('usage above the hint', await page(`$('usage').getBoundingClientRect().bottom <= $('status').getBoundingClientRect().top && $('usage').parentElement === $('status').parentElement`), true);

  // 9. Reset L1: defaults again (expression, 細部調整, mirror, height), still on the desktop where it was; L2 untouched.
  await switchTo('L1');
  const profileL2 = structuredClone(getState().characters.L2);
  await page(`$('character-reset').click(); true`);
  await answerDialog('ok');
  await waitFor(() => !getState().characters.L1?.tuning, 'L1 reset');
  await sleep(600); await settle();
  check('L1 after reset', [getState().selection.expression, getState().characters.L1.mirror, await page(`$('mirror-toggle').checked`), desktop().height], ['0', undefined, false, 500]);
  check('L1 keeps its desktop place', [getState().characters.L1.desktop.shown, getState().characters.L1.desktop.opacity, getState().characters.L1.desktop.autoPoke, getPets()], [true, 100, undefined, ['L1']]);
  check('L2 untouched by reset', getState().characters.L2, profileL2);

  // 9b. 還原 › 所有角色設定 (asks first): every character's settings back to defaults; the characters, their
  // pictures and their places stay; X1, whose extension is not installed, is left as it is.
  await choose('expression', '1');
  await page(`$('app-menu-toggle').click(); $('reset-toggle').click(); true`);
  check('還原 choices', await page(`(() => {
    const menu = $('reset-menu').getBoundingClientRect(), toggle = $('reset-toggle').getBoundingClientRect();
    return [$('reset-menu').hidden, [...$('reset-menu').children].filter(button => !button.hidden).map(button => button.textContent), menu.right <= toggle.left, Math.abs(menu.top - toggle.top) < 1];
  })()`), [false, ['所有角色設定', '完全還原', '還原 UI 設定'], true, true]);
  await page(`$('reset-settings').click(); true`);
  await answerDialog('cancel');
  await sleep(400);
  check('還原所有角色設定 asks first', getState().characters.L1.expression, '1');
  const placesBefore = Object.fromEntries(['L1', 'L2'].map(id => [id, getState().characters[id].desktop]));
  await page(`$('reset-settings').click(); true`);
  await answerDialog('ok');
  await waitFor(() => !getState().characters.L1.expression && !getState().characters.L2.desktop.locked, 'every character reset');
  await sleep(600); await settle();
  const firstState = ({ shown, x, y }) => ({ desktop: { shown, locked: false, opacity: 100, x, y } });
  check('還原所有角色設定', [getState().characters.L1, getState().characters.L2, savedFile('settings.json').characters.X1, getState().library.map(entry => entry.id), getPets(), getState().selection.expression],
    [firstState(placesBefore.L1), firstState(placesBefore.L2), hiddenProfile, ['L1', 'L2'], ['L1'], '0']);

  // 10. Delete L2: its folder and every trace go.
  const entryL2 = getState().library.find(entry => entry.id === 'L2');
  await switchTo('L2');
  await page(`$('character-delete').click(); true`);
  await answerDialog('ok');
  await waitFor(() => getState().library.length === 1, 'L2 deleted');
  await sleep(600); await settle();
  check('only L1 remains', [getState().library.map(entry => entry.id), Object.keys(savedFile('settings.json').characters).sort(), await page(`$('character').value`), savedFile('settings.json').pinned], [['L1'], ['L1', 'X1'], 'L1', ['X1']]);
  check('groups lose a deleted character', savedFile('settings.json').groups.map(group => [group.name, group.members]), [['Swimming Team', ['L1']]]);
  check('L2 folder deleted', fs.existsSync(path.join(dataRoot, 'Local', entryL2.folder)), false);
  check('nothing of L2 left in the data folder', await tracesOf(dataRoot, [JSON.stringify('L2')]), []);
  // 11. Pictures deleted in Explorer: noticed when the settings window comes back to the front. A deleted expression
  // picture leaves the menu; with its folder deleted the character is hidden, its settings and groups kept, until the
  // pictures are back. Folder numbers fill gaps.
  await add(stageLocal('file', path.join(folder, 'd.svg')), 'Gone soon', 'L2');
  check('a free number is given again', [getState().library.find(entry => entry.id === 'L2').folder, fs.existsSync(path.join(dataRoot, 'Local', '2', 'd.svg'))], ['2', true]);
  // A character just added is on the desktop already.
  await waitFor(() => getPets().includes('L2'), 'L2 out for Duo');
  await makeGroup('Duo');
  const duoPlaceL2 = placeOf('L2'), duo = () => savedFile('settings.json').groups.find(group => group.name === 'Duo');
  await page(layerButton('G:G2', 'close'));
  await waitFor(() => !getState().options.groups.find(group => group.name === 'Duo').active, 'Duo closed');
  await waitFor(() => duo() && !savedFile('settings.json').active.G2, 'Duo saved');
  const duoBefore = duo();
  fs.rmSync(path.join(dataRoot, 'Local', '1', 'e2.png'));
  fs.rmSync(path.join(dataRoot, 'Local', '2'), { recursive: true });
  ctx.getSettings().emit('focus');
  await waitFor(() => getState().library.length === 1, 'deleted folder noticed');
  await waitFor(() => page(`!!window.desktopSettingsTest && desktopSettingsTest.idle()`), 'settings page reloaded');
  await settle();
  check('deleted pictures noticed', [getState().library.map(entry => entry.id), getState().library[0].files, getPets(), await page(`$('errors').textContent.includes('Gone soon')`), await page(`[...$('character').options].map(option => option.value)`)],
    [['L1'], { 0: 'd.svg', 1: 'e1.svg' }, ['L1'], true, ['L1']]);
  const { X1: savedX1, L2: savedL2, ...savedShown } = savedFile('settings.json').characters;
  check('saved settings match', savedShown, getState().characters);
  check('hidden, kept', [savedFile('library.json').find(entry => entry.id === 'L2')?.missing, !!savedL2, duo(), getState().options.groups.find(group => group.name === 'Duo').members],
    [true, true, duoBefore, ['L1']]);
  // Its group comes out without it; ✎ 保存 keeps it as the group had it.
  await page(`$('groups-toggle').click(); [...$('groups-panel').querySelectorAll('.group-name')].find(button => button.textContent === 'Duo').click(); true`);
  await waitFor(() => getState().options.groups.find(group => group.name === 'Duo').active, 'Duo out without L2');
  await settle();
  check('out without it', [getPets(), layersNow()], [['L1'], [['Duo', ['L1']]]]);
  await pencil('Duo');
  await waitFor(() => getState().options.editing?.name === 'Duo', 'editing Duo');
  await switchTo('L1');
  await waitFor(() => page(`!$('group-leave').hidden`), 'leave shown for Duo');
  check('editing without it', [getState().options.editing.members, await page(`$('group-leave').disabled`)], [['L1'], true]);
  await page(`$('group-save').click(); true`);
  await waitFor(() => !getState().options.editing, 'Duo edit saved');
  await sleep(600); await settle();
  check('saved with it', [duo().members, duo().profiles.L2], [duoBefore.members, duoBefore.profiles.L2]);
  // Its pictures back: shown again, joining its group that is out, as the group has it.
  fs.mkdirSync(path.join(dataRoot, 'Local', '2'));
  fs.writeFileSync(path.join(dataRoot, 'Local', '2', 'd.svg'), svg('#c05030'));
  ctx.getSettings().emit('focus');
  await waitFor(() => getState().library.length === 2, 'pictures back');
  await waitFor(() => page(`!!window.desktopSettingsTest && desktopSettingsTest.idle()`), 'settings page reloaded again');
  await waitFor(() => getPets().includes('L2'), 'L2 back on the desktop');
  await settle();
  check('back in its group', [getState().library.map(entry => entry.id), 'missing' in savedFile('library.json').find(entry => entry.id === 'L2'), getPets().sort(), layersNow(), placeOf('L2')],
    [['L1', 'L2'], false, ['L1', 'L2'], [['Duo', duoBefore.members]], duoPlaceL2]);
  await page(layerButton('G:G2', 'close'));
  await waitFor(() => !getState().options.groups.find(group => group.name === 'Duo').active, 'Duo closed again');
  await settle();
  check('its own state after', [getState().characters.L2.desktop.shown, getPets().sort()], [true, ['L1', 'L2']]);
  // Deleted in the app, it leaves its groups.
  await switchTo('L2');
  await page(`$('character-delete').click(); true`);
  await answerDialog('ok');
  await waitFor(() => getState().library.length === 1, 'L2 deleted again');
  await sleep(600); await settle();
  check('a deleted member leaves', [duo().members, Object.keys(duo().profiles), getPets()], [['L1'], ['L1'], ['L1']]);

  check('missing-extension character kept through everything', [...kept(), await notShown()], [hiddenEntry, hiddenProfile, true, true, nowhere]);

  // 12. 匯出 (in the app menu): every character in the list, with its files and its settings but not its place on the
  // desktop; X1, whose extension is not installed, stays out (nothing shows it was there).
  await choose('expression', '1');
  await page(`desktopWorkflowTest.changeTuning({ bounce: 90 }); $('mirror-toggle').checked = true; $('mirror-toggle').dispatchEvent(new Event('change')); true`);
  await waitFor(() => getState().characters.L1?.tuning?.bounce === 90 && getState().characters.L1.mirror, 'L1 settings for the pack');
  const packFile = path.join(path.dirname(dataRoot), 'test.cdpack');
  ctx.setFileTest({ exportFile: packFile });
  await page(`$('app-menu-toggle').click(); true`);
  const exported = await page('desktopWorkflowTest.exportPack()');
  const packed = require('./pack.cjs').readPack(fs.readFileSync(packFile));
  check('exported', [exported.ok, exported.count, await page(`$('app-menu-status').textContent`), packed.characters.map(item => [item.entry.id, item.files.map(file => file.name).sort(), 'desktop' in item.profile])],
    [true, 1, '已匯出 1 個角色：test.cdpack', [['L1', ['d.svg', 'e1.svg'], false]]]);
  check('exported settings', [packed.characters[0].profile.expression, packed.characters[0].profile.tuning.bounce, packed.characters[0].profile.mirror], ['1', 90, true]);
  check('nothing of X1 in the pack', fs.readFileSync(packFile).includes('Hidden'), false);
  // A pack that also holds a character of an extension not installed here (made like one from another computer).
  const mixedFile = path.join(path.dirname(dataRoot), 'mixed.cdpack');
  fs.writeFileSync(mixedFile, require('./pack.cjs').buildPack({ appVersion: '1', characters: [...packed.characters, { entry: hiddenEntry, profile: {}, files: [{ name: 'picture.png', data: Buffer.from('x') }] }] }));
  await page(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`);

  // 13. 重置並清空全部: asks first, then everything is gone, as on a fresh install.
  await page(`$('reset-all').click(); true`);
  await answerDialog('cancel');
  await sleep(400);
  check('reset all asks first', getState().library.length, 1);
  await page(`$('reset-all').click(); true`);
  await answerDialog('ok');
  await waitFor(() => getState().library.length === 0, 'everything reset');
  await waitFor(() => page(`!!window.desktopSettingsTest && library.size === 0 && !$('local-panel').hidden`), 'settings page reloaded empty');
  await sleep(600);
  const saved = file => JSON.parse(fs.readFileSync(path.join(dataRoot, file), 'utf8'));
  check('reset all', [getState().characters, getState().options.layers, getPets(), saved('library.json'), saved('settings.json').characters, fs.existsSync(path.join(dataRoot, 'Local')), await page(`[$('character-field').hidden, $('reset-all').textContent]`)],
    [{}, [], [], [], {}, false, [true, '完全還原']]);
  // Character files of every extension go, also of one not installed; the rest of an extension's data stays.
  check('reset all removes extension character files', [fs.existsSync(path.join(hiddenFiles, 'Characters')), fs.existsSync(path.join(hiddenFiles, 'Engine', 'player.js'))], [false, true]);

  // 14. 角色包 (in the file panel) into the empty app: L1 comes back as it was, off the desktop; X1, whose extension
  // is not installed, is left out without asking.
  ctx.setFileTest({ importFile: mixedFile });
  const imported = await page('desktopWorkflowTest.importPack()');
  ctx.setFileTest({ importFile: packFile });
  await settle();
  const l1 = () => getState().characters.L1;
  check('pack imported', [imported.added, imported.missing, await page(`$('dialog').hidden`), getState().library.map(entry => entry.id), l1().expression, l1().tuning.bounce, l1().mirror, l1().desktop.shown, fs.readdirSync(path.join(dataRoot, 'Local', '1')).sort(), await page(`$('character').value`)],
    [['Renamed'], ['elsewhere'], true, ['L1'], '1', 90, true, false, ['d.svg', 'e1.svg'], 'L1']);
  check('import says what happened', await page(`$('local-status').textContent`), '已匯入：Renamed\n沒有安裝的擴充功能，其角色已略過：elsewhere');
  check('import button in the file panel', await page(`[...$('local-pick-pack').parentElement.children].map(item => item.textContent)`), ['單張圖片', '資料夾', '角色包', '?']);
  // Again, with L1 already here: the app asks (跳過 / 覆蓋). 跳過 keeps it; 覆蓋 brings back the pack's pictures and
  // settings under the same id, and keeps its place on the desktop.
  await choose('expression', '0');
  await click('desktop-visible');
  await waitFor(() => getPets().includes('L1'), 'L1 on the desktop again');
  const skipping = page('desktopWorkflowTest.importPack()');
  const asked = await page(`(async () => { while ($('dialog').hidden) await new Promise(resolve => setTimeout(resolve, 50)); return [$('dialog-title').textContent, [...$('dialog-buttons').children].map(button => button.textContent), $('dialog-check').hidden]; })()`);
  check('the question, in the page', asked, ['匯入角色', ['跳過', '覆蓋'], false]);
  check('跳過 asked about', await answerDialog('skip'), '「Renamed」已經在角色庫裡了。');
  const skipped = await skipping;
  check('跳過', [skipped.added, skipped.replaced, skipped.skipped, l1().expression, await page(`$('dialog').hidden`)], [[], [], ['Renamed（已經有了）'], '0', true]);
  fs.rmSync(path.join(dataRoot, 'Local', '1', 'e1.svg'));
  const replacing = page('desktopWorkflowTest.importPack()');
  await answerDialog('overwrite', { checked: true });
  const replaced = await replacing;
  await settle();
  check('覆蓋', [replaced.replaced, getState().library.map(entry => entry.id), l1().expression, l1().desktop.shown, getPets(), fs.readdirSync(path.join(dataRoot, 'Local', '1')).sort()],
    [['Renamed'], ['L1'], '1', true, ['L1'], ['d.svg', 'e1.svg']]);
  const broken = path.join(path.dirname(dataRoot), 'broken.cdpack');
  fs.writeFileSync(broken, 'not a pack');
  ctx.setFileTest({ importFile: broken });
  check('not a pack', await page('desktopWorkflowTest.importPack()'), { ok: false, message: '不是有效的角色包（.cdpack）。' });
  check('nothing left from importing', fs.readdirSync(dataRoot).filter(name => name.startsWith('Import-')), []);
  check('no page errors', await page('!!window.playerFailed'), false);
  check('hint unchanged at the end', await page(`$('status').textContent`), '滾輪縮放 · 右鍵拖曳 · 左鍵互動');
  hidden();
  fs.writeFileSync(report, JSON.stringify({ ok: true, results }, null, 1));
  app.exit(0);
}
module.exports = { run };
