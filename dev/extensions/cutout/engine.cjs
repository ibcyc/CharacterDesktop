// The cutout extension's engine (main process): BiRefNet General (MIT, Peng Zheng et al.) run with ONNX Runtime on
// the CPU, the way rembg runs it. The page sends the photo scaled to 1024×1024 and normalized (3×1024×1024 floats);
// the mask comes back as 1024×1024 bytes (sigmoid, stretched to 0–255). One model session, kept while the editor is
// open; one photo at a time.
// The model (about 973 MB) is not part of the extension: it is downloaded once, after the user agrees, from rembg's
// release (the very file rembg uses, checked by its size and MD5), into the extension's data folder. In the app's
// self-tests nothing is downloaded and, without a model, a stand-in mask is returned instead.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const os = require('node:os');

const SIZE = 1024;
const MODEL = {
  file: 'birefnet-general.onnx', bytes: 972666916, md5: '7a35a0141cbbc80de11d9c9a28f52697',
  url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-epoch_244.onnx'
};
// GitHub sends release files from its own storage hosts.
const HOSTS = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];

// The model's raw output -> mask bytes, as rembg makes them: sigmoid, then stretched to the full 0–255 range.
function toMask(output) {
  const values = new Float32Array(SIZE * SIZE);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const value = 1 / (1 + Math.exp(-output[i]));
    values[i] = value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const mask = new Uint8Array(values.length), range = max - min || 1;
  for (let i = 0; i < values.length; i++) mask[i] = Math.floor((values[i] - min) / range * 255);
  return mask;
}

// Self-tests without the model: an opaque disc in the middle with a soft edge.
function standInMask() {
  const mask = new Uint8Array(SIZE * SIZE), centre = SIZE / 2, radius = SIZE * 0.35;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) mask[y * SIZE + x] = Math.round(255 * Math.max(0, Math.min(1, (radius - Math.hypot(x - centre, y - centre)) / 8)));
  }
  return mask;
}

// The page's input, however IPC handed the floats over.
function inputOf(value) {
  const view = ArrayBuffer.isView(value) ? value : null;
  const floats = view instanceof Float32Array ? view : view && view.byteLength % 4 === 0 ? new Float32Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)) : null;
  if (!floats || floats.length !== 3 * SIZE * SIZE) throw new Error('照片資料不正確。');
  return floats;
}

// Downloads one file to `target`, following redirects within GitHub's hosts; progress(received, total).
function download(url, target, { userAgent, progress, redirects = 0 }) {
  return new Promise((resolve, reject) => {
    const address = new URL(url);
    if (address.protocol !== 'https:' || !HOSTS.includes(address.hostname)) return reject(new Error('模型連結不屬於預期的網站。'));
    const request = https.get(address, { headers: { 'User-Agent': userAgent } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        if (redirects >= 5) return reject(new Error('重新導向次數過多。'));
        download(new URL(response.headers.location, address).href, target, { userAgent, progress, redirects: redirects + 1 }).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) { response.resume(); return reject(new Error('模型下載失敗（HTTP ' + response.statusCode + '）。')); }
      const total = Number(response.headers['content-length']) || MODEL.bytes, file = fs.createWriteStream(target);
      let received = 0;
      response.on('data', chunk => { received += chunk.length; progress(received, total); });
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
      response.on('error', reject);
    });
    request.setTimeout(60000, () => request.destroy(new Error('模型下載逾時，請確認網路後重試。')));
    request.on('error', reject);
  });
}

function md5Of(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    fs.createReadStream(file).on('data', chunk => hash.update(chunk)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
  });
}

function createEngine({ folder, offline, userAgent, log = () => {}, fetch = download, runtime = () => require('onnxruntime-node'), model = MODEL }) {
  const modelFile = path.join(folder, model.file);
  let session = null, loading = null, fetching = null, received = 0, total = model.bytes, failure = '';
  const hasModel = () => { try { return fs.statSync(modelFile).size === model.bytes; } catch { return false; } };

  // 'ready' (also the self-tests' stand-in), 'downloading' with its progress, or 'missing' (with the last failure).
  function status() {
    if (hasModel() || offline) return { model: 'ready' };
    if (fetching) return { model: 'downloading', received, total };
    return { model: 'missing', bytes: model.bytes, failure };
  }

  // Starts the download once; the page follows it with status().
  function fetchModel() {
    if (offline || hasModel() || fetching) return status();
    const partial = modelFile + '.partial';
    failure = '';
    received = 0;
    fetching = (async () => {
      fs.mkdirSync(folder, { recursive: true });
      try {
        await fetch(model.url, partial, { userAgent, progress: (now, all) => { received = now; total = all; } });
        if (fs.statSync(partial).size !== model.bytes || await md5Of(partial) !== model.md5) throw new Error('下載的模型檔不完整，請重試。');
        fs.renameSync(partial, modelFile);
      } catch (error) {
        log(error);
        failure = String(error.message || error);
        fs.rmSync(partial, { force: true });
      } finally {
        fetching = null;
      }
    })();
    return status();
  }

  async function open() {
    const ort = runtime();
    // About three quarters of the processor: the pages and the rest of the computer stay smooth meanwhile.
    const threads = Math.max(1, Math.floor((os.availableParallelism?.() ?? os.cpus().length) * 0.75));
    return ort.InferenceSession.create(modelFile, { executionProviders: ['cpu'], graphOptimizationLevel: 'all', intraOpNumThreads: threads, interOpNumThreads: 1 });
  }

  async function remove(value) {
    const input = inputOf(value);
    if (!hasModel()) {
      if (offline) return standInMask();
      throw new Error('還沒有去背模型。');
    }
    session ??= await (loading ??= open().finally(() => { loading = null; }));
    const output = await session.run({ [session.inputNames[0]]: new (runtime().Tensor)('float32', input, [1, 3, SIZE, SIZE]) });
    return toMask(output[session.outputNames[0]].data);
  }

  // The editor closed: the model's memory (about 1–2 GB) goes back.
  async function release() {
    const old = session;
    session = null;
    await old?.release?.();
    return true;
  }

  return { status, fetchModel, remove, release, modelFile };
}

module.exports = { SIZE, MODEL, HOSTS, toMask, standInMask, inputOf, download, createEngine };
