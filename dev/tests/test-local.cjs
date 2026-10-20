// Unit tests for local characters (app/local.cjs): which files are taken, the folder rules, copying, renaming, removal.
// Works in a temporary folder; the source pictures are checked to stay untouched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLocal, planFile, planFolder, cleanName } = require('../app/local.cjs');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20"><rect width="10" height="20"/></svg>');
const GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');

function folderWith(root, name, files) {
  const folder = path.join(root, name);
  fs.mkdirSync(folder, { recursive: true });
  for (const [file, data] of Object.entries(files)) fs.writeFileSync(path.join(folder, file), data);
  return folder;
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'local-test-'));
try {
  const root = path.join(temp, 'Data', 'Local'), local = createLocal(root), sources = path.join(temp, 'sources');

  // A single picture becomes d, whatever its name; other formats are refused.
  assert.deepEqual(planFile('C:/x/My Photo.PNG').files[0].name, 'd.png');
  assert.throws(() => planFile('C:/x/a.jpg'), /png、webp、svg、gif/);

  // A folder: d and e1, e2… are taken (any case), everything else is listed as not imported.
  const mixed = folderWith(sources, 'My Pet', { 'D.SVG': SVG, 'e1.png': PNG, 'e12.gif': GIF, 'readme.txt': 'x', 'face.png': PNG, 'e0.png': PNG });
  fs.mkdirSync(path.join(mixed, 'sub'));
  const plan = planFolder(mixed);
  assert.deepEqual(Object.fromEntries(Object.entries(plan.files).map(([id, item]) => [id, item.name])), { 0: 'd.svg', 1: 'e1.png', 12: 'e12.gif' });
  assert.deepEqual(plan.skipped.sort(), ['e0.png', 'face.png', 'readme.txt', 'sub']);

  // Refused: no usable file at all, no d, or two files for one picture.
  assert.throws(() => planFolder(folderWith(sources, 'wrong', { 'a.png': PNG, 'b.txt': 'x' })), /沒有可用的檔案/);
  assert.throws(() => planFolder(folderWith(sources, 'no-d', { 'e1.png': PNG })), /缺少 d/);
  assert.throws(() => planFolder(folderWith(sources, 'twice', { 'd.png': PNG, 'e1.png': PNG, 'e1.gif': GIF })), /e1\.png、e1\.gif|e1\.gif、e1\.png/);

  // Adding copies the pictures into Data/Local/<number> under the rule names; the originals stay as they were.
  const before = fs.readdirSync(mixed).sort();
  const first = local.add([], { kind: 'folder', from: mixed, name: '  Pet  ' });
  assert.deepEqual(first.entry, { id: 'L1', kind: 'local', name: 'Pet', folder: '1', files: { 0: 'd.svg', 1: 'e1.png', 12: 'e12.gif' } });
  assert.deepEqual(fs.readdirSync(path.join(root, '1')).sort(), ['d.svg', 'e1.png', 'e12.gif']);
  assert.deepEqual(fs.readdirSync(mixed).sort(), before, 'source folder untouched');
  assert.deepEqual(local.read(first.entry, '12'), { mime: 'image/gif', data: GIF });
  assert.equal(local.read(first.entry, '7').mime, 'image/svg+xml', 'unknown expression shows d');

  // A file that is not what its name says is left out; a broken d cancels and leaves no folder behind.
  const fake = folderWith(sources, 'fake', { 'd.png': PNG, 'e1.png': 'not a picture' });
  const second = local.add([first.entry], { kind: 'folder', from: fake, name: 'Fake' });
  assert.deepEqual([second.entry.folder, second.entry.files, second.skipped], ['2', { 0: 'd.png' }, ['e1.png（不是有效的圖片）']]);
  assert.throws(() => local.add([first.entry, second.entry], { kind: 'file', from: path.join(folderWith(sources, 'bad', { 'x.gif': 'nope' }), 'x.gif'), name: 'Bad' }), /不是可用的圖片/);
  assert.equal(fs.existsSync(path.join(root, '3')), false);
  assert.throws(() => local.add([], { kind: 'file', from: path.join(mixed, 'e1.png'), name: '   ' }), /名稱/);

  // A number is the smallest one free (folders already there count as taken); a single picture becomes d.
  fs.mkdirSync(path.join(root, '7'));
  const third = local.add([first.entry, second.entry], { kind: 'file', from: path.join(mixed, 'e12.gif'), name: 'Gif' });
  assert.deepEqual([third.entry.id, third.entry.files], ['L3', { 0: 'd.gif' }]);

  // Pictures deleted outside the app: a missing expression picture leaves the entry, a missing d the whole character.
  fs.copyFileSync(path.join(root, '1', 'e12.gif'), path.join(temp, 'e12-backup.gif'));
  fs.rmSync(path.join(root, '1', 'e12.gif'));
  assert.deepEqual(local.check(first.entry).files, { 0: 'd.svg', 1: 'e1.png' });
  fs.copyFileSync(path.join(temp, 'e12-backup.gif'), path.join(root, '1', 'e12.gif'));
  assert.deepEqual(local.check(first.entry), first.entry, 'nothing missing, nothing changes');
  assert.equal(local.check({ ...third.entry, folder: '99' }), null, 'folder gone');

  // Renaming keeps everything else; names are trimmed and limited.
  assert.deepEqual(local.rename(first.entry, 'New name'), { ...first.entry, name: 'New name' });
  assert.equal(cleanName('x'.repeat(60)).length, 40);

  // Removing deletes only that folder; removeAll deletes Data/Local.
  local.remove(second.entry);
  assert.deepEqual(fs.readdirSync(root).sort(), ['1', '3', '7']);
  const reused = local.add([first.entry, third.entry], { kind: 'file', from: path.join(mixed, 'e1.png'), name: 'Again' });
  assert.equal(reused.entry.id, 'L2', 'a deleted number is given again');
  local.removeAll();
  assert.equal(fs.existsSync(root), false);
  assert(fs.existsSync(path.join(mixed, 'D.SVG')), 'sources never touched');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log(JSON.stringify({ ok: true, singleFileBecomesD: true, folderRules: true, refusals: true, copyKeepsOriginals: true, numbering: true, rename: true, deletedOutside: true, remove: true }));
