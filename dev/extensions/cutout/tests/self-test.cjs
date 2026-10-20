// The cutout extension's hidden regression test, run by the app's build (`python dev/build.py --with-characters`).
// Nothing is shown on screen and nothing goes online: the self-tests use the engine's stand-in mask (an opaque disc
// in the middle) instead of the model. The photos are made here.
const fs = require('node:fs');
const path = require('node:path');

async function run(ctx) {
  const { app, getState, dataRoot, report } = ctx;
  const { sleep, waitFor, createChecks, pageHelpers } = ctx.helpers;
  const { results, check } = createChecks();
  const { page, hidden } = pageHelpers(ctx);
  const tool = code => page(`(async () => { const tool = desktopSettingsTest.tool('cutout'); return ${code}; })()`);
  const shown = id => `(getComputedStyle($('${id}')).display !== 'none' && !$('${id}').hidden)`;
  // Files dropped on the editor, as the system would hand them over: [name, type, a promise of its blob] each.
  const dropAll = files => page(`(async () => {
    const data = new DataTransfer();
    for (const [name, type, blob] of [${files.map(([name, type, make]) => '[' + JSON.stringify(name) + ', ' + JSON.stringify(type) + ', await (' + make + ')]').join(', ')}]) data.items.add(new File([blob], name, { type }));
    $('cut-stage').dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
    return true;
  })()`);
  const drop = (name, type, make) => dropAll([[name, type, make]]);
  const pngSize = file => { const png = fs.readFileSync(file); return [png.subarray(1, 4).toString(), png.readUInt32BE(16), png.readUInt32BE(20)]; };
  const state = () => tool('tool.state()');
  const photo = `new Promise(resolve => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d');
    x.fillStyle = '#c03020'; x.fillRect(0, 0, 400, 300); x.fillStyle = '#2050c0'; x.fillRect(150, 100, 100, 100); c.toBlob(resolve, 'image/png'); })`;
  // A stroke of the brush over the photo, from one point of it to another.
  const strokeOver = (from, to) => page(`(() => {
    const tool = desktopSettingsTest.tool('cutout'), canvas = $('cut-canvas'), a = tool.screenOf(${from[0]}, ${from[1]}), b = tool.screenOf(${to[0]}, ${to[1]});
    const at = (type, p, buttons) => canvas.dispatchEvent(new PointerEvent(type, { button: 0, buttons, clientX: p.x, clientY: p.y, pointerId: 7, bubbles: true }));
    at('pointerdown', a, 1); at('pointermove', b, 1); window.dispatchEvent(new PointerEvent('pointerup', { button: 0, pointerId: 7 }));
    return true;
  })()`);
  const key = (shift = false) => page(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: ${shift}, bubbles: true })); true`);
  const alphaAt = (x, y) => tool(`tool.pixelAt(${x}, ${y})[3]`);

  check('extensions load', getState().extensionProblems, []);
  await waitFor(() => page('!!window.desktopSettingsTest'), 'settings page');

  // 1. 工具 in the app menu, with 圖片去背; a tool downloads nothing, so the download help never lists it. 來源 names
  // what it is built on.
  await page(`$('app-menu-toggle').click(); $('tools-toggle').click(); true`);
  check('工具', await page(`[${shown('tools-item')}, [...$('app-menu').querySelectorAll(':scope > button, :scope > .menu-item > button')].map(b => b.textContent).slice(0, 2), [...$('tools-menu').children].map(b => b.textContent), $('download-help').textContent.includes('圖片去背')]`),
    [true, ['來源', '工具'], ['圖片去背'], false]);
  check('credits', await page(`['圖片去背：由作者自己的留白去背工具改寫', 'BiRefNet General 模型：Peng Zheng 等，MIT', 'rembg：Daniel Gatis，MIT', 'ONNX Runtime：Microsoft，MIT', 'Marco Forte'].map(text => $('sources-panel').textContent.includes(text))`),
    [true, true, true, true, true]);

  // 2. The editor takes the window: the character page hides; at first only "drop a photo" and ✕.
  await page(`$('tools-menu').children[0].click(); true`);
  await waitFor(() => page(`document.body.classList.contains('tool-mode')`), 'editor open');
  check('editor', await page(`[${shown('tool-host')}, ...['stage', 'character-field', 'app-menu-toggle', 'local-toggle', 'status'].map(id => getComputedStyle($(id)).display === 'none' || !$(id).offsetParent),
    ${shown('cut-drop')}, ${shown('cut-tools')}, ${shown('cut-options')}, $('cut-add').disabled, $('cut-save').disabled, $('cut-close').disabled]`),
    [true, true, true, true, true, true, true, false, false, true, true, false]);
  check('a checkerboard behind', await page(`getComputedStyle($('cut-stage')).backgroundImage.startsWith('conic-gradient')`), true);

  // 3. Not a photo: the stage shakes once and nothing else happens.
  await drop('notes.txt', 'text/plain', `Promise.resolve(new Blob(['hello']))`);
  check('not a photo shakes', [await page(`$('cut-stage').classList.contains('shake')`), (await tool('tool.state()')).photo], [true, false]);
  await sleep(600);
  check('the shake ends', await page(`$('cut-stage').classList.contains('shake')`), false);

  // 4. A photo: cut out at once (the stand-in mask: an opaque disc in the middle). With one photo there is no queue.
  await drop('photo.png', 'image/png', photo);
  await waitFor(async () => (await state()).photo, 'cut out');
  check('cut out', [await state(), await alphaAt(200, 150), await alphaAt(4, 4), await tool('tool.pixelAt(200, 150).slice(0, 3)'), await page(`$('cut-queue').hidden`)],
    [{ photo: true, width: 400, height: 300, undo: 0, redo: 0, brush: 'erase', edges: 'clean', trim: true, comparing: false, queue: ['ready'], index: 0 }, 255, 0, [32, 80, 192], true]);
  check('controls for a photo', await page(`[${shown('cut-drop')}, ${shown('cut-tools')}, ${shown('cut-options')}, $('cut-add').disabled, $('cut-save').disabled]`), [false, true, true, false, false]);
  check('places', await page(`(() => {
    const at = r => $(r).getBoundingClientRect(), stage = at('cut-stage'), tools = at('cut-tools'), options = at('cut-options'), actions = at('cut-add');
    return [tools.left - stage.left < stage.width / 4 && Math.abs(tools.top + tools.height / 2 - (stage.top + stage.height / 2)) < 2, options.right - stage.left > stage.width * 3 / 4,
      actions.bottom - stage.top > stage.height * 0.85 && Math.abs((at('cut-add').left + at('cut-close').right) / 2 - (stage.left + stage.width / 2)) < 40];
  })()`), [true, true, true]);

  // 5. Brushes: erase, undo (Ctrl+Z) and redo (Ctrl+Shift+Z); restore brings the photo back where it was erased.
  await strokeOver([195, 150], [205, 150]);
  check('erased', [await alphaAt(200, 150), (await state()).undo], [0, 1]);
  await key();
  check('Ctrl+Z', [await alphaAt(200, 150), (await state()).redo], [255, 1]);
  await key(true);
  check('Ctrl+Shift+Z', await alphaAt(200, 150), 0);
  await page(`$('cut-restore').click(); true`);
  await strokeOver([10, 10], [14, 10]);
  check('restored', [await alphaAt(12, 10), await tool('tool.pixelAt(12, 10).slice(0, 3)'), (await state()).brush], [255, [192, 48, 32], 'restore']);

  // 6. Details: the edges (the cutout again, without the repairs), 裁邊 and the photo itself for comparison.
  await page(`$('cut-natural').click(); true`);
  await waitFor(async () => (await state()).photo && (await state()).edges === 'natural', 'cut out again with 自然 edges');
  check('自然 edges', [await state(), await alphaAt(200, 150), await alphaAt(12, 10)],
    [{ photo: true, width: 400, height: 300, undo: 0, redo: 0, brush: 'restore', edges: 'natural', trim: true, comparing: false, queue: ['ready'], index: 0 }, 255, 0]);
  await page(`$('cut-compare').click(); true`);
  check('compare', (await state()).comparing, true);
  await page(`$('cut-compare').click(); $('cut-clean').click(); true`);
  await waitFor(async () => (await state()).photo && (await state()).edges === 'clean', 'cut out again with 乾淨 edges');

  // 7. Wheel zoom as in the preview.
  const before = await tool('tool.screenOf(400, 300)');
  await page(`(() => { const p = desktopSettingsTest.tool('cutout').screenOf(200, 150); $('cut-canvas').dispatchEvent(new WheelEvent('wheel', { deltaY: -400, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true })); return true; })()`);
  check('zoom', (await tool('tool.screenOf(400, 300)')).x > before.x, true);

  // 8. 下載: the PNG where the user chooses (the self-test chooses for them), its transparent margin trimmed (裁邊,
  // on at first) or kept. Erasing comes first: what is trimmed is the cutout as repaired.
  const saved = path.join(path.dirname(dataRoot), 'cut.png');
  ctx.setFileTest({ saveFile: saved });
  await tool('tool.save()');
  const trimmed = pngSize(saved);
  check('下載, trimmed', [trimmed[0], trimmed[1] > 270 && trimmed[1] < 300, trimmed[2] > 200 && trimmed[2] < 225], ['PNG', true, true]);
  await page(`$('cut-erase').click(); $('cut-size').value = 200; true`);
  await strokeOver([60, 20], [60, 280]);
  await tool('tool.save()');
  check('erasing first trims more', pngSize(saved)[1] < trimmed[1], true);
  await page(`$('cut-trim').click(); true`);
  await tool('tool.save()');
  check('下載, not trimmed', [(await state()).trim, ...pngSize(saved)], [false, 'PNG', 400, 300]);
  await page(`$('cut-trim').click(); true`);

  // 9. 加入: with no local character yet, a new one named after the photo (trimmed); the queue is empty then, so the
  // editor closes and the character page shows it.
  await page(`$('cut-add').click(); true`);
  await waitFor(() => page(`!document.body.classList.contains('tool-mode') && $('character').value === 'L1'`), 'added');
  const d = pngSize(path.join(dataRoot, 'Local', '1', 'd.png'));
  check('加入', [getState().library.map(entry => [entry.id, entry.name, entry.kind]), fs.readdirSync(path.join(dataRoot, 'Local', '1')), d[1] < 300 && d[2] < 225, await page(`${shown('stage')} && ${shown('app-menu-toggle')}`)],
    [[['L1', 'photo', 'local']], ['d.png'], true, true]);

  // 10. Several photos at once: a queue, cut out one after another (a file that is not a photo is left out, with a
  // shake). 加入 now offers a new character or the next expression of one; an added photo leaves the queue.
  await page(`$('app-menu-toggle').click(); $('tools-toggle').click(); $('tools-menu').children[0].click(); true`);
  await waitFor(() => page(`document.body.classList.contains('tool-mode')`), 'editor open again');
  check('starts empty', [(await state()).photo, await page(shown('cut-drop'))], [false, true]);
  await dropAll([['first.png', 'image/png', photo], ['notes.txt', 'text/plain', `Promise.resolve(new Blob(['x']))`], ['second.png', 'image/png', photo]]);
  check('one left out', await page(`$('cut-stage').classList.contains('shake')`), true);
  await waitFor(async () => (await state()).queue.join() === 'ready,ready', 'both cut out');
  check('queue', [(await state()).index, await page(`[${shown('cut-queue')}, [...$('cut-queue').children].map(cell => cell.className)]`)], [0, [true, ['cut-thumb ready current', 'cut-thumb ready']]]);
  await page(`$('cut-queue').children[1].querySelector('button').click(); true`);
  check('switched', (await state()).index, 1);
  await page(`$('cut-add').click(); true`);
  check('加入 menu', await page(`[${shown('cut-add-menu')}, [...$('cut-add-menu').children].map(button => button.textContent)]`), [true, ['新角色', '[L] photo']]);
  await page(`$('cut-add-menu').children[1].click(); true`);
  await waitFor(async () => (await state()).queue.length === 1, 'added as an expression');
  check('as an expression', [(await state()).index, getState().library[0].files, fs.readdirSync(path.join(dataRoot, 'Local', '1')).sort(), await page(`$('cut-add-menu').hidden`)],
    [0, { 0: 'd.png', 1: 'e1.png' }, ['d.png', 'e1.png'], true]);
  await page(`$('cut-close').click(); true`);
  await waitFor(() => page(`!document.body.classList.contains('tool-mode')`), 'closed');
  check('✕ leaves the rest', [getState().library.length, getState().selection], [1, { characterId: 'L1', look: null, expression: '1' }]);
  check('nothing left from adding', fs.readdirSync(dataRoot).filter(name => name.startsWith('Import-')), []);
  check('no page errors', await page('!!window.playerFailed'), false);
  hidden();
  fs.writeFileSync(report, JSON.stringify({ ok: true, results }, null, 1));
  app.exit(0);
}
module.exports = { run };
