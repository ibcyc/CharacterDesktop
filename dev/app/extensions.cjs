// Extensions: optional folders in <app>/Extensions/<id>/ that add a kind of character, usually one a website provides.
// Without any, the app is a desktop pet for the user's own pictures. Each folder holds extension.json:
//   { "id": "abc", "name": "…", "site": "…", "author": "…", "api": 1,
//     "credits": [{ "name": "…", "detail": "…" }],             optional: what it is built on, for 來源
//     "main": "main.cjs",                                     main-process part, see below
//     "pages": { "settings": { "scripts": [...], "styles": [...], "html": { "<slot>": "file.html" } },
//                "pet": { "scripts": [...] } } }
// main.cjs exports activate(context) -> part, where
//   context = { id, appVersion, dataFolder, charactersFolder, offline, library(), update(entry), remove(id), log(error) }
// (offline: the self-tests run; the extension must not use the network; library(): its own characters only, as is
// downloadedEntry's list; update(entry) replaces one of them, remove(id) takes one out as if deleted). A character's own files belong in
// charactersFolder/<character id>: the app deletes that folder with the character, and every such folder on
// 重置並清空全部, even when the extension is no longer installed. part may provide:
//   handles(url), download({ url, signal, progress }), downloadedEntry(characters, url)   downloading from addresses
//   cleanLook(entry, look) -> look      what a character shows (costume, …), checked; a default when invalid
//   lookKey(entry, look) -> string      which look a desktop height belongs to
//   cleanOptions(entry, options) -> options   the character's own settings (kept in its profile)
//   tuning: true                        its characters are pictures that use the app's 細部調整 (packet.tuning)
//   pageCalls: { name: (...args) => value }   functions its pages may call (CharacterDesktop.call)
// The pages run the scripts of every extension (shared/character-kinds.js describes what they register).
const fs = require('node:fs');
const path = require('node:path');

const API_VERSION = 1;
const PAGES = ['settings', 'pet'];

// A file named by a manifest, which must stay inside the extension folder.
function fileIn(folder, name) {
  const file = path.resolve(folder, String(name));
  if (path.relative(folder, file).startsWith('..') || path.isAbsolute(path.relative(folder, file))) throw new Error('檔案不在擴充功能資料夾內：' + name);
  if (!fs.statSync(file).isFile()) throw new Error('找不到檔案：' + name);
  return file;
}

function loadExtension(folder, context) {
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'extension.json'), 'utf8'));
  if (!/^[a-z0-9-]{1,32}$/.test(String(manifest.id))) throw new Error('extension.json 的 id 格式不正確');
  if (manifest.id !== path.basename(folder)) throw new Error('資料夾名稱必須和 id 相同：' + manifest.id);
  if (manifest.api !== API_VERSION) throw new Error('需要介面版本 ' + manifest.api + '，這個 App 是 ' + API_VERSION);
  const read = name => fs.readFileSync(fileIn(folder, name), 'utf8');
  // Page files are read once; a broken manifest stops the extension here rather than in a page.
  const pages = {};
  for (const page of PAGES) {
    const spec = manifest.pages?.[page] || {};
    pages[page] = {
      id: manifest.id,
      scripts: (spec.scripts || []).map(read),
      styles: (spec.styles || []).map(read),
      html: Object.fromEntries(Object.entries(spec.html || {}).map(([slot, name]) => [slot, read(name)]))
    };
  }
  const part = require(fileIn(folder, manifest.main || 'main.cjs')).activate({ ...context(manifest.id) }) || {};
  return {
    id: manifest.id, name: String(manifest.name || manifest.id), site: String(manifest.site || ''), author: String(manifest.author || ''),
    credits: (Array.isArray(manifest.credits) ? manifest.credits : []).map(credit => ({ name: String(credit?.name || ''), detail: String(credit?.detail || '') })).filter(credit => credit.name),
    folder, pages, ...part
  };
}

// Loads every extension folder; one that cannot be loaded is skipped and reported.
function loadExtensions(root, context) {
  const loaded = [], problems = [];
  if (!fs.existsSync(root)) return { loaded, problems };
  for (const item of fs.readdirSync(root, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    try {
      loaded.push(loadExtension(path.join(root, item.name), context));
    } catch (error) {
      problems.push('擴充功能「' + item.name + '」無法載入：' + (error.message || error));
    }
  }
  return { loaded, problems };
}

module.exports = { loadExtensions, API_VERSION };
