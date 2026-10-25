// Local characters: the user's own pictures. Each one is a folder Data/Local/<number>/ holding d.<ext> (the
// default look) and e1.<ext>, e2.<ext>… (expressions), whatever the picture or folder was called before.
// Its library entry: { id: 'L<number>', kind: 'local', name, folder: '<number>', files: { 0: 'd.png', 1: 'e1.gif' } }
// Expression '0' is the default look. Only files named this way are taken; the originals are never changed.
const fs = require('node:fs');
const path = require('node:path');

// JPG has no transparency: such a character shows its whole picture (the page reminds the user before adding).
const FORMATS = { '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_NAME_LENGTH = 40;
const FILE_NAME = /^(?:(d)|e([1-9]\d?))(\.(?:png|webp|svg|gif|jpe?g))$/i;   // d, e1 … e99

class LocalError extends Error {}

function isLocal(entry) { return entry?.kind === 'local'; }
const ONLY_PICTURES = '只接受 png、webp、svg、gif、jpg 圖片。';
function formatOf(file) { return FORMATS[path.extname(file).toLowerCase()] || ''; }

// Whether the bytes really are a picture of that format.
function looksLike(data, ext) {
  const head = data.subarray(0, 16);
  if (ext === '.png') return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (ext === '.gif') return /^GIF8[79]a/.test(head.toString('latin1'));
  if (ext === '.webp') return head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP';
  if (ext === '.svg') return /<svg[\s>]/i.test(data.subarray(0, 4096).toString('utf8'));
  if (ext === '.jpg' || ext === '.jpeg') return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  return false;
}
// The file extension that bytes of an accepted picture call for ('' if they are none), for pictures without a name.
function pictureExtension(data) {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return ['.png', '.gif', '.webp', '.jpg', '.svg'].find(ext => looksLike(bytes, ext)) || '';
}

function cleanName(value) {
  const name = String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
  if (!name) throw new LocalError('請輸入角色名稱。');
  return name;
}

// ---------- Choosing the files ----------
// A single picture always becomes the default look (d), whatever it was called.
function planFile(file) {
  const ext = path.extname(file).toLowerCase();
  if (!FORMATS[ext]) throw new LocalError(ONLY_PICTURES);
  return { files: { 0: { from: file, name: 'd' + ext } }, skipped: [] };
}

// A folder needs d; e1, e2… are expressions. Anything else is left out and reported.
// Two files for the same picture (e1.png and e1.gif) refuse the whole folder.
function planFolder(folder) {
  const files = {}, skipped = [], twice = [];
  for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
    const match = item.isFile() && FILE_NAME.exec(item.name);
    if (!match) { skipped.push(item.name); continue; }
    const id = match[1] ? '0' : String(Number(match[2])), name = (match[1] ? 'd' : 'e' + id) + match[3].toLowerCase();
    if (files[id]) { twice.push(files[id].original + '、' + item.name); continue; }
    files[id] = { from: path.join(folder, item.name), name, original: item.name };
  }
  if (twice.length) throw new LocalError('同一張圖有兩個檔案，請只留一個：' + twice.join('；'));
  if (!Object.keys(files).length) throw new LocalError('資料夾裡沒有可用的檔案（需要 d，表情是 e1、e2…；格式 png、webp、svg、gif、jpg），已取消。');
  if (!files[0]) throw new LocalError('資料夾裡缺少 d（預設樣子），已取消。');
  return { files, skipped };
}

// ---------- The library ----------
function createLocal(root) {
  const folderOf = entry => path.join(root, entry.folder);

  // The next folder number: the smallest from 1 up that no local character and no folder already there uses,
  // so the number of a deleted character is given again.
  function nextNumber(library) {
    const used = new Set([
      ...library.filter(isLocal).map(entry => Number(entry.folder)),
      ...(fs.existsSync(root) ? fs.readdirSync(root).map(Number) : [])
    ]);
    let number = 1;
    while (used.has(number)) number++;
    return number;
  }

  // Copies the planned pictures into a new folder and returns the new entry and what was left out.
  // Pictures that are not what their name says are left out too; without a usable d nothing is kept.
  // With `replacing` (a local entry) the pictures take the place of that character's, under its id and folder.
  function add(library, { kind, from, name }, replacing = null) {
    const characterName = cleanName(name);
    const plan = kind === 'folder' ? planFolder(from) : planFile(from);
    const number = replacing ? Number(replacing.folder) : nextNumber(library), files = {}, skipped = [...plan.skipped];
    const target = path.join(root, String(number)), folder = replacing ? target + '.new' : target;
    if (replacing) fs.rmSync(folder, { recursive: true, force: true });
    fs.mkdirSync(folder, { recursive: true });
    try {
      for (const [id, item] of Object.entries(plan.files)) {
        const size = fs.statSync(item.from).size;
        const data = size <= MAX_FILE_BYTES ? fs.readFileSync(item.from) : null;
        if (!data || !looksLike(data, path.extname(item.name))) { skipped.push(path.basename(item.from) + (data ? '（不是有效的圖片）' : '（超過 20 MB）')); continue; }
        fs.writeFileSync(path.join(folder, item.name), data);
        files[id] = item.name;
      }
      if (!files[0]) throw new LocalError('d（預設樣子）不是可用的圖片，已取消。');
      if (replacing) {
        fs.rmSync(target, { recursive: true, force: true });
        fs.renameSync(folder, target);
      }
    } catch (error) {
      fs.rmSync(folder, { recursive: true, force: true });
      throw error;
    }
    return { entry: { id: 'L' + number, kind: 'local', name: characterName, folder: String(number), files }, skipped };
  }

  // One picture added as the next free expression (e1 … e99) of a local character: the new entry and its id.
  function addExpression(entry, file) {
    const ext = path.extname(file).toLowerCase(), size = fs.statSync(file).size;
    if (!FORMATS[ext]) throw new LocalError(ONLY_PICTURES);
    if (size > MAX_FILE_BYTES) throw new LocalError('圖片超過 20 MB。');
    const data = fs.readFileSync(file);
    if (!looksLike(data, ext)) throw new LocalError('不是有效的圖片。');
    let number = 1;
    while (entry.files[number]) number++;
    if (number > 99) throw new LocalError('這個角色的表情已經滿了（最多 99 個）。');
    const name = 'e' + number + ext;
    fs.writeFileSync(path.join(folderOf(entry), name), data);
    return { entry: { ...entry, files: { ...entry.files, [number]: name } }, expression: String(number) };
  }

  return {
    folderOf,
    add,
    addExpression,
    rename: (entry, name) => ({ ...entry, name: cleanName(name) }),
    remove: entry => fs.rmSync(folderOf(entry), { recursive: true, force: true }),
    removeAll: () => fs.rmSync(root, { recursive: true, force: true }),
    // The entry as its folder is now: a picture deleted outside the app (in Explorer) leaves its expression; without
    // its default picture, or its folder, the character is gone (null). Other files in the folder are left alone.
    check(entry) {
      const files = Object.fromEntries(Object.entries(entry.files).filter(([, file]) => fs.existsSync(path.join(folderOf(entry), file))));
      return files[0] ? { ...entry, files } : null;
    },
    // One picture of a character for the pages: its type and bytes.
    read(entry, expression) {
      const file = entry.files[String(expression)] || entry.files[0];
      return { mime: formatOf(file), data: fs.readFileSync(path.join(folderOf(entry), file)) };
    }
  };
}

module.exports = { createLocal, isLocal, cleanName, planFile, planFolder, pictureExtension };
