// Unit tests for the cutout extension's engine (engine.cjs). Nothing goes online and the real model is not needed:
// downloads go to a fake fetcher and the model runtime is a stand-in.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { SIZE, MODEL, toMask, standInMask, inputOf, download, createEngine } = require('../engine.cjs');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cutout-test-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async check => { for (let i = 0; i < 100 && !check(); i++) await sleep(20); assert(check(), 'timed out'); };

async function run() {
  // The model is rembg's own file, checked by size and MD5.
  assert.deepEqual([MODEL.bytes, MODEL.md5, new URL(MODEL.url).hostname], [972666916, '7a35a0141cbbc80de11d9c9a28f52697', 'github.com']);

  // The mask: sigmoid, stretched to 0–255 (rembg's way).
  const raw = new Float32Array(SIZE * SIZE).fill(-8);
  raw[0] = 8; raw[1] = 0;
  const mask = toMask(raw);
  assert.deepEqual([mask[0], mask[2], mask.length], [255, 0, SIZE * SIZE]);
  assert(mask[1] > 120 && mask[1] < 135, 'sigmoid(0) is about half');
  const disc = standInMask();
  assert.deepEqual([disc[SIZE / 2 * SIZE + SIZE / 2], disc[0]], [255, 0]);

  // Only a full 3×1024×1024 float input is taken, however IPC hands it over.
  const floats = new Float32Array(3 * SIZE * SIZE).fill(0.5);
  assert.equal(inputOf(floats), floats);
  assert.equal(inputOf(new Uint8Array(floats.buffer))[5], 0.5);
  for (const bad of [new Float32Array(10), 'text', null, [1, 2]]) assert.throws(() => inputOf(bad), /照片資料/);

  // Downloads only from GitHub's hosts, over https.
  await assert.rejects(download('https://example.com/model.onnx', path.join(temp, 'x'), { userAgent: 'test', progress: () => {} }), /預期的網站/);
  await assert.rejects(download('http://github.com/model.onnx', path.join(temp, 'x'), { userAgent: 'test', progress: () => {} }), /預期的網站/);

  // Without the model: 'missing' with its size; the download only starts when asked; a wrong file is refused and
  // nothing is left; the right one is kept.
  const content = Buffer.from('a small stand-in model');
  const model = { file: 'm.onnx', bytes: content.length, md5: crypto.createHash('md5').update(content).digest('hex'), url: 'https://github.com/x/m.onnx' };
  let served = Buffer.from('wrong file!!!!!!!!!!!!'), asked = 0;
  const fetch = async (url, target, { progress }) => { asked++; assert.equal(url, model.url); progress(5, served.length); fs.writeFileSync(target, served); };
  const folder = path.join(temp, 'Model');
  const engine = createEngine({ folder, offline: false, userAgent: 'test', fetch, model });
  assert.deepEqual(engine.status(), { model: 'missing', bytes: model.bytes, failure: '' });
  await assert.rejects(engine.remove(floats), /還沒有去背模型/);
  assert.equal(asked, 0, 'nothing is downloaded unasked');
  engine.fetchModel();
  await until(() => engine.status().model === 'missing' && engine.status().failure);
  assert.deepEqual([engine.status().failure, fs.readdirSync(folder)], ['下載的模型檔不完整，請重試。', []]);
  served = content;
  assert.equal(engine.fetchModel().model, 'downloading');
  await until(() => engine.status().model === 'ready');
  assert.deepEqual(fs.readdirSync(folder), ['m.onnx']);

  // With the model: one session, its output made a mask; release gives the memory back.
  const sessions = [];
  const runtime = () => ({
    Tensor: class { constructor(type, data, dims) { Object.assign(this, { type, data, dims }); } },
    InferenceSession: { create: async file => { const session = { file, inputNames: ['input_image'], outputNames: ['output_image'], released: false,
      run: async feeds => ({ output_image: { data: new Float32Array(SIZE * SIZE).fill(feeds.input_image.dims[1] === 3 ? 4 : -4) } }),
      release: async () => { session.released = true; } }; sessions.push(session); return session; } }
  });
  const ready = createEngine({ folder, offline: false, userAgent: 'test', runtime, model });
  const out = await ready.remove(floats);
  await ready.remove(floats);
  assert.deepEqual([out.length, sessions.length, sessions[0].file], [SIZE * SIZE, 1, path.join(folder, 'm.onnx')]);
  await ready.release();
  assert.equal(sessions[0].released, true);

  // The app's self-tests: no download, and without the model a stand-in mask.
  const offline = createEngine({ folder: path.join(temp, 'none'), offline: true, userAgent: 'test', fetch: () => assert.fail('offline'), model });
  assert.deepEqual([offline.status(), offline.fetchModel()], [{ model: 'ready' }, { model: 'ready' }]);
  assert.deepEqual(await offline.remove(floats), standInMask());

  fs.rmSync(temp, { recursive: true, force: true });
  console.log(JSON.stringify({ mask: true, input: true, hosts: true, download: true, session: true, offline: true }, null, 2));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
