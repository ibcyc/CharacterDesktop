// Helpers for the hidden self-tests of the app and of extensions (handed to them as ctx.helpers).
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label) {
  for (let i = 0; i < 200; i++) {
    try { if (await check()) return; } catch { /* page may be reloading */ }
    await sleep(100);
  }
  throw new Error('timeout: ' + label);
}

// The checks of one test run: check(name, actual, expected) fails the run on a difference; results lists them all.
function createChecks() {
  const results = {};
  return { results, check(name, actual, expected) { assert.deepEqual(actual, expected, name); results[name] = 'ok'; } };
}

// Files in the data folder that still contain any of `needles` (such as a character's id as a JSON string).
// Waits for the delayed settings save first. Locked files (Chromium's own) are skipped.
async function tracesOf(dataRoot, needles) {
  await sleep(600);
  const found = [];
  const walk = folder => {
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, item.name);
      if (item.isDirectory()) { walk(file); continue; }
      let text;
      try { text = fs.readFileSync(file).toString('latin1'); } catch { continue; }
      if (needles.some(needle => text.includes(needle))) found.push(path.relative(dataRoot, file));
    }
  };
  walk(dataRoot);
  return found;
}

// Driving the settings page and the desktop pages through their DOM and test hooks. Every step checks that no
// window has become visible: the self-tests never show anything on screen.
function pageHelpers({ getSettings, getPet, getPets, getState }) {
  const settings = getSettings();
  const page = code => settings.webContents.executeJavaScript(code);
  const petPage = (code, id) => getPet(id).webContents.executeJavaScript(code);
  const hidden = () => assert(!settings.isVisible() && getPets().every(id => !getPet(id).isVisible()), 'a window became visible');
  const idle = () => waitFor(() => page(`!!window.desktopSettingsTest && desktopSettingsTest.idle()`), 'settings idle');
  const settle = async () => { await idle(); await sleep(350); hidden(); };
  const choose = async (id, value) => {
    await page(`$(${JSON.stringify(id)}).value = ${JSON.stringify(value)}; $(${JSON.stringify(id)}).dispatchEvent(new Event('change')); true`);
    await settle();
  };
  const click = async id => { await page(`$(${JSON.stringify(id)}).click(); true`); await settle(); };
  const slide = async (id, value) => {
    await page(`$(${JSON.stringify(id)}).value = ${value}; $(${JSON.stringify(id)}).dispatchEvent(new Event('input')); true`);
    await sleep(400);
  };
  const switchTo = async id => {
    await choose('character', id);
    await waitFor(() => page(`$('character').value === ${JSON.stringify(id)}`), 'switch to ' + id);
    await settle();
  };
  // Answers the page's question (dialog.js) with one of its buttons, optionally ticking its checkbox; returns its message.
  const answerDialog = async (value, { checked = false } = {}) => {
    await waitFor(() => page(`!$('dialog').hidden`), 'a question');
    return page(`(() => { const message = $('dialog-message').textContent; $('dialog-checkbox').checked = ${checked}; $('dialog-buttons').querySelector('[data-value="${value}"]').click(); return message; })()`);
  };
  const lastPreviewPoke = () => page(`({ plan: desktopSettingsTest.lastPoke(), temporary: desktopSettingsTest.temporaryExpression() })`);
  const petMetrics = id => petPage('desktopTest.getMetrics()', id);
  const petReady = id => waitFor(() => petPage(`!!window.desktopTest && !!desktopTest.getMetrics().key && !desktopTest.getMetrics().busy`, id), 'pet ready ' + id);
  // The height and window height of the character being edited, with its selection.
  const desktop = () => ({ ...getState().selection, height: getState().options.height, windowHeight: getPet()?.getBounds().height });
  return { settings, page, petPage, hidden, idle, settle, choose, click, slide, switchTo, answerDialog, lastPreviewPoke, petMetrics, petReady, desktop };
}

module.exports = { sleep, waitFor, createChecks, tracesOf, pageHelpers };
