// UI languages (shared/i18n.js): every Chinese text the app or an extension shows has its English, and the tables
// themselves are sound. Text is found in the code's strings and the pages' markup; comments are left out.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTranslator, LANGUAGES } = require('../shared/i18n.js');
const { STRINGS_EN, PUNCTUATION_EN } = require('../shared/strings-en.js');

const DEV = path.join(__dirname, '..');
const IDEOGRAPH = /[\u4e00-\u9fff]/;
const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;
// Shown as they are in every language: the language question and the languages' own names.
const EVERY_LANGUAGE = new Set(['Language · 語言', '請選擇語言', ...LANGUAGES.map(language => language.name)]);

const unescape = text => text.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, code) => code[0] === 'u' && code.length === 5 ? String.fromCharCode(parseInt(code.slice(1), 16)) : code === 'n' ? '\n' : code);
// The texts of a file: string literals of code (without comments), text and shown attributes of markup.
function textsOf(file, markupOnly = false) {
  let source = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.json')) {
    const texts = [];
    const visit = value => { if (typeof value === 'string') texts.push(value); else if (value && typeof value === 'object') Object.values(value).forEach(visit); };
    visit(JSON.parse(source));
    return texts;
  }
  if (file.endsWith('.html')) {
    source = source.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>|<!--[\s\S]*?-->/g, '');
    return [...source.matchAll(/>([^<]+)<|(?:title|aria-label|placeholder|alt)="([^"]*)"/g)].map(match => match[1] ?? match[2]);
  }
  source = source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(line => !/^\s*(\/\/|#)/.test(line)).map(line => line.replace(/(^|[^:'"\\])\/\/.*$/, '$1')).join('\n');
  const texts = [...source.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map(match => unescape(match[1] ?? match[2] ?? match[3]));
  // Markup inside code (build.py's, a page's own): its text too. build.py's other strings are for the developer.
  return texts.flatMap(text => text.includes('<') ? [...text.matchAll(/>([^<]+)<|(?:title|aria-label|placeholder|alt)="([^"]*)"/g)].map(match => match[1] ?? match[2]) : markupOnly ? [] : [text]);
}
// Pieces of Chinese that some key must hold: each line, trimmed; punctuation alone needs nothing.
const piecesOf = files => files.flatMap(file => textsOf(file, file.endsWith('build.py'))).flatMap(text => text.split('\n')).map(text => text.trim()).filter(text => IDEOGRAPH.test(text) && !EVERY_LANGUAGE.has(text));
const keyText = key => /^[\w-]+\|/.test(key) ? key.slice(key.indexOf('|') + 1) : key;
function missing(pieces, tables) {
  const keys = tables.flatMap(table => Object.keys(table).map(keyText));
  return [...new Set(pieces)].filter(piece => !keys.some(key => key.includes(piece) || key.includes(piece.replace(/\d+/g, '{#}'))));
}
function checkTable(table, name) {
  for (const [key, value] of Object.entries(table)) {
    assert.ok(CJK.test(keyText(key)), name + ': a key holds Chinese: ' + key);
    assert.ok(!IDEOGRAPH.test(value), name + ': its translation has no Chinese: ' + key);
    const placeholders = text => (text.match(/\{\d*#?\}/g) || []).length;
    assert.equal(placeholders(value), placeholders(keyText(key)), name + ': the same parts in the translation: ' + key);
  }
}

const filesIn = (folder, pattern) => fs.existsSync(folder) ? fs.readdirSync(folder).filter(name => pattern.test(name)).map(name => path.join(folder, name)) : [];
const appFiles = [
  ...['main.cjs', 'local.cjs', 'pack.cjs', 'extensions.cjs', 'startup.cjs', 'pet.js', 'pet-window.cjs'].map(name => path.join(DEV, 'app', name)),
  ...filesIn(path.join(DEV, 'shared'), /\.js$/).filter(file => !/(i18n|strings-\w+)\.js$/.test(file)),
  ...filesIn(path.join(DEV, 'settings'), /\.(js|html)$/),
  path.join(DEV, 'build.py')
];
const results = {};

// The app: every text in English.
checkTable(STRINGS_EN, 'app');
const pieces = piecesOf(appFiles);
assert.deepEqual(missing(pieces, [STRINGS_EN]), [], 'app text without English');
results.app = pieces.length;

// Every extension that brings English: its own text, with the app's table behind it.
for (const folder of filesIn(path.join(DEV, 'extensions'), /^[a-z0-9-]+$/)) {
  const tableFile = path.join(folder, 'strings', 'en.json');
  if (!fs.existsSync(tableFile)) continue;
  const table = JSON.parse(fs.readFileSync(tableFile, 'utf8'));
  checkTable(table, path.basename(folder));
  const files = [...filesIn(folder, /\.(cjs|js)$/), ...filesIn(path.join(folder, 'pages'), /\.(js|html)$/), path.join(folder, 'extension.json')];
  assert.deepEqual(missing(piecesOf(files), [table, STRINGS_EN]), [], path.basename(folder) + ' text without English');
  results[path.basename(folder)] = Object.keys(table).length;
}

// The translator: patterns, parts translated, lists, contexts and lines.
const en = createTranslator();
en.add(STRINGS_EN, PUNCTUATION_EN);
en.add({ 'cutout|還原': 'Restore' });
assert.deepEqual([
  en.translate('已匯出 3 個角色：角色-1.cdpack'), en.translate('略過：A（已經有了）、B（資料不正確）'), en.translate('擴充功能「x」無法載入：需要介面版本 2，這個 App 是 1'),
  en.translate('還原'), en.translate('還原', 'cutout'), en.translate('關閉', 'off'), en.translate('  高度 '), en.translate('已匯入：A\n略過：B（已經有了）'), en.translate('沒有這句'), en.translate('Plain')
], [
  'Exported 3 characters: Characters-1.cdpack', 'Skipped: A (already here), B (invalid data)', 'The extension "x" could not be loaded: Needs interface version 2; this App has 1',
  'Reset', 'Restore', 'Off', '  Height ', 'Imported: A\nSkipped: B (already here)', '沒有這句', 'Plain'
]);

console.log(JSON.stringify({ ok: true, ...results }));
