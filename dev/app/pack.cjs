// Character packs (.cdpack): characters with their pictures and settings, to keep and to bring back (匯出 / 匯入).
// A pack is a zip file:
//   pack.json                  { format: 'CharacterDesktop pack', version: 1, app, characters: [{ dir, id }] }
//   c1/entry.json              the character's library entry
//   c1/profile.json            its settings (look, expression, heights, mirror, 細部調整, an extension's options)
//   c1/files/…                 its files: a local character's pictures, or the files an extension keeps for it
// Pictures are stored as they are (already compressed), the rest deflated. Reading checks every name, size and CRC,
// so a pack from anywhere can only ever give back plain data and files inside the folders the app chooses.
const zlib = require('node:zlib');

const FORMAT = 'CharacterDesktop pack';
const VERSION = 1;
const MAX_CHARACTERS = 1000;
const MAX_FILE_BYTES = 512 * 1024 * 1024;     // one file, unpacked
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024 - 1;
const STORED = /\.(png|webp|gif|jpe?g)$/i;   // compressed already: kept as they are

class PackError extends Error {}

// ---------- Zip ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(data) {
  if (zlib.crc32) return zlib.crc32(data) >>> 0;
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// A name inside a pack: forward slashes, no empty, '.' or '..' parts, nothing a Windows file name cannot hold.
function safeName(name) {
  const parts = name.split('/');
  return name.length <= 400 && parts.every(part => part && part !== '.' && part !== '..' && part.length <= 120 && !/[\\:*?"<>|\x00-\x1f]/.test(part));
}

// files: [{ name, data }] -> the zip as one Buffer.
function writeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    if (!safeName(name)) throw new PackError('不允許的檔名：' + name);
    const nameBytes = Buffer.from(name, 'utf8'), crc = crc32(data);
    const deflated = STORED.test(name) ? null : zlib.deflateRawSync(data, { level: 6 });
    const method = deflated && deflated.length < data.length ? 8 : 0, body = method ? deflated : data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + body.length;
    if (offset > MAX_TOTAL_BYTES) throw new PackError('角色包超過 4 GB，請分批匯出。');
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  if (files.length > 0xffff) throw new PackError('角色包的檔案太多，請分批匯出。');
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// A zip Buffer -> Map(name -> Buffer). Only plain zips (stored or deflated, not encrypted, no zip64) are read.
function readZip(zip) {
  const bad = () => new PackError('不是有效的角色包（.cdpack）。');
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw bad();
  const count = zip.readUInt16LE(end + 10), start = zip.readUInt32LE(end + 16);
  const files = new Map();
  let at = start, total = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== 0x02014b50) throw bad();
    const flags = zip.readUInt16LE(at + 8), method = zip.readUInt16LE(at + 10), crc = zip.readUInt32LE(at + 16);
    const packed = zip.readUInt32LE(at + 20), size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28), extra = zip.readUInt16LE(at + 30), comment = zip.readUInt16LE(at + 32), offset = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extra + comment;
    if (name.endsWith('/')) continue;   // folders
    if (flags & 1 || ![0, 8].includes(method) || !safeName(name) || files.has(name)) throw bad();
    if (size > MAX_FILE_BYTES || (total += size) > MAX_TOTAL_BYTES) throw new PackError('角色包裡的檔案太大。');
    if (offset + 30 > zip.length || zip.readUInt32LE(offset) !== 0x04034b50) throw bad();
    const dataStart = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
    if (dataStart + packed > zip.length) throw bad();
    const body = zip.subarray(dataStart, dataStart + packed);
    let data;
    try { data = method === 8 ? zlib.inflateRawSync(body, { maxOutputLength: Math.max(1, size) }) : Buffer.from(body); } catch { throw bad(); }
    if (data.length !== size || crc32(data) !== crc) throw bad();
    files.set(name, data);
  }
  return files;
}

// ---------- Packs ----------
const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

// characters: [{ entry, profile, files: [{ name, data }] }] (file names relative to the character's files folder).
function buildPack({ appVersion, characters }) {
  if (!characters.length) throw new PackError('沒有角色可以匯出。');
  const files = [], listed = [];
  characters.forEach(({ entry, profile, files: own }, index) => {
    const dir = 'c' + (index + 1);
    listed.push({ dir, id: String(entry.id) });
    files.push({ name: dir + '/entry.json', data: Buffer.from(JSON.stringify(entry)) });
    files.push({ name: dir + '/profile.json', data: Buffer.from(JSON.stringify(profile || {})) });
    for (const file of own) files.push({ name: dir + '/files/' + file.name, data: file.data });
  });
  files.unshift({ name: 'pack.json', data: Buffer.from(JSON.stringify({ format: FORMAT, version: VERSION, app: appVersion, characters: listed }, null, 1)) });
  return writeZip(files);
}

// A pack Buffer -> { app, characters: [{ entry, profile, files: [{ name, data }] }] }; entries and profiles are only
// known to be plain objects here: the app checks them as it would its own saved data.
function readPack(zip) {
  const files = readZip(zip), json = name => { try { return JSON.parse(files.get(name).toString('utf8')); } catch { return null; } };
  const head = files.has('pack.json') ? json('pack.json') : null;
  if (head?.format !== FORMAT) throw new PackError('不是有效的角色包（.cdpack）。');
  if (head.version !== VERSION) throw new PackError('這個角色包來自較新的版本，請先更新 App。');
  if (!Array.isArray(head.characters) || head.characters.length > MAX_CHARACTERS) throw new PackError('角色包的內容不正確。');
  const characters = head.characters.map(({ dir } = {}) => {
    if (!/^c\d{1,4}$/.test(String(dir))) throw new PackError('角色包的內容不正確。');
    const entry = json(dir + '/entry.json'), profile = json(dir + '/profile.json');
    if (!plainObject(entry) || !plainObject(profile)) throw new PackError('角色包的內容不正確。');
    const prefix = dir + '/files/';
    const own = [...files].filter(([name]) => name.startsWith(prefix)).map(([name, data]) => ({ name: name.slice(prefix.length), data }));
    return { entry, profile, files: own };
  });
  return { app: String(head.app || ''), characters };
}

module.exports = { FORMAT, VERSION, PackError, safeName, writeZip, readZip, buildPack, readPack };
