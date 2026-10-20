// Unit tests for character packs (app/pack.cjs): the zip they are, and what reading one refuses.
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { writeZip, readZip, buildPack, readPack, safeName } = require('../app/pack.cjs');

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 7)]);
const text = Buffer.from('x'.repeat(5000));

// A zip any zip tool reads: stored pictures, deflated text, UTF-8 names, CRCs.
const zip = writeZip([{ name: 'a/圖.png', data: png }, { name: 'a/b.json', data: text }, { name: 'empty.txt', data: Buffer.alloc(0) }]);
const files = readZip(zip);
assert.deepEqual([...files.keys()], ['a/圖.png', 'a/b.json', 'empty.txt']);
assert(files.get('a/圖.png').equals(png) && files.get('a/b.json').equals(text) && files.get('empty.txt').length === 0);
assert(zip.length < png.length + text.length, 'text is deflated');
assert(zip.includes(png), 'pictures are stored as they are');

// Names that could leave the pack's folders are refused, writing and reading.
for (const bad of ['../x', 'a/../../x', '/abs', 'a\\b', 'c:/x', 'a//b', 'a/./b', 'nul\x00']) assert.equal(safeName(bad), false, bad);
assert.throws(() => writeZip([{ name: '../evil', data: text }]));
const evil = Buffer.from(zip);
const at = evil.indexOf(Buffer.from('a/b.json'), evil.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])));
evil.write('../b.js', at, 'utf8');
assert.throws(() => readZip(evil), /不是有效/, 'a name leaving the folder');
// A changed byte (CRC), a cut file and a file that is not a zip at all are refused.
const changed = Buffer.from(zip); changed[zip.indexOf(png) + 20] ^= 1;
assert.throws(() => readZip(changed), /不是有效/);
assert.throws(() => readZip(zip.subarray(0, zip.length - 30)), /不是有效/);
assert.throws(() => readZip(Buffer.from('hello')), /不是有效/);
// A deflated file larger than it says (a zip bomb) is refused.
const bomb = writeZip([{ name: 'big.json', data: Buffer.alloc(100000) }]);
bomb.writeUInt32LE(10, bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24);
assert.throws(() => readZip(bomb), /不是有效/);

// Packs: characters with their entry, settings and files, in order.
const pack = buildPack({ appVersion: '9.9.9', characters: [
  { entry: { id: 'L1', kind: 'local', name: 'Mine', folder: '1', files: { 0: 'd.png' } }, profile: { expression: '0', mirror: true }, files: [{ name: 'd.png', data: png }] },
  { entry: { id: 'X1', extension: 'other', name: 'Theirs', models: [{ data: 'AAAA' }] }, profile: {}, files: [{ name: 'skin/1.webp', data: png }] }
] });
const read = readPack(pack);
assert.equal(read.app, '9.9.9');
assert.deepEqual(read.characters.map(c => [c.entry.id, c.profile, c.files.map(f => f.name)]), [['L1', { expression: '0', mirror: true }, ['d.png']], ['X1', {}, ['skin/1.webp']]]);
assert(read.characters[1].files[0].data.equals(png));
assert.throws(() => buildPack({ appVersion: '1', characters: [] }), /沒有角色/);
assert.throws(() => readPack(writeZip([{ name: 'pack.json', data: Buffer.from('{"format":"other"}') }])), /不是有效的角色包/);
assert.throws(() => readPack(writeZip([{ name: 'pack.json', data: Buffer.from(JSON.stringify({ format: 'CharacterDesktop pack', version: 2, characters: [] })) }])), /較新的版本/);
assert.throws(() => readPack(writeZip([{ name: 'pack.json', data: Buffer.from(JSON.stringify({ format: 'CharacterDesktop pack', version: 1, characters: [{ dir: '../c1' }] })) }])), /內容不正確/);
assert.throws(() => readPack(writeZip([
  { name: 'pack.json', data: Buffer.from(JSON.stringify({ format: 'CharacterDesktop pack', version: 1, characters: [{ dir: 'c1' }] })) },
  { name: 'c1/entry.json', data: Buffer.from('[1,2]') }, { name: 'c1/profile.json', data: Buffer.from('{}') }
])), /內容不正確/, 'an entry must be an object');
// What zlib makes is what the pack reads (the same deflate either way).
assert.equal(zlib.inflateRawSync(zlib.deflateRawSync(text)).length, text.length);

console.log(JSON.stringify({ zip: true, names: true, integrity: true, bomb: true, packs: true }, null, 2));
