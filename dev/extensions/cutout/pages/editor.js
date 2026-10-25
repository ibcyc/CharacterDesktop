// The tool 圖片去背 on the settings page (one of the app's tools, settings/tool-host.js): the window becomes an editor
// over a checkerboard. Photos dragged in (JPG, PNG or WebP; anything else shakes the stage) join a queue and are cut
// out one after another: each is scaled to 1024×1024 for the model (engine.cjs, in the main process) and the mask
// that comes back is laid over it at full size. 乾淨 edges also recover the true colour of soft edge pixels
// (Approximate Fast Foreground Colour Estimation, Forte & Pitié 2021); 自然 keeps the photo's own.
// Top (with more than one photo): the queue, to switch photos or drop one. Left: the erase / restore brushes (left
// drag) and their size. Right: the edges, 裁邊 (trim the transparent margin from what is added or downloaded) and the
// photo itself for comparison. Bottom: 加入 (a new local character named after the photo, or the next expression of
// one), 下載 (the PNG) and ✕. Wheel and right drag zoom and pan as in the preview; Ctrl+Z / Ctrl+Shift+Z undo and
// redo strokes. A photo added leaves the queue; with none left the editor closes.
// The heavy pixel work (decoding, scaling, the cutout and its edges) runs in a background worker, so the page stays
// smooth however many photos are dropped; a photo is only decoded in full when its turn comes.
// An animation (GIF, animated WebP or APNG) asks first: 逐格去背 cuts out every frame like a photo (with progress;
// at most MAX_FRAMES) and it plays in the editor without brushes, then is added or downloaded as an animated PNG
// (apng.js) with soft edges; 只用第一格 treats it as a photo.
(() => {
  const ID = 'cutout';
  const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const ANIMATED = ['image/gif', 'image/webp', 'image/png'];   // formats that can hold an animation
  const MAX_FRAMES = 100;
  const MAX_FRAME_PIXELS = 30e6;            // all frames of an animation together, as decoded
  const PICTURE_BYTES = 19 * 1024 * 1024;   // an animation added to a character stays under the app's 20 MB
  const MAX_QUEUE = 30;
  const HISTORY_BYTES = 64 * 1024 * 1024;   // undo steps kept per photo, at most
  const ADD_MAX_SIDE = 2048;                // a picture added to a character is at most this large
  const TRIM_ALPHA = 8;                     // pixels fainter than this do not count when trimming
  const $ = id => document.getElementById(id);
  const call = (name, ...args) => CharacterDesktop.call(ID, name, ...args);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  // ---------- The background worker ----------
  // Runs on its own thread; it keeps each photo (as decoded) and its cutout alpha until the photo leaves the queue.
  function cutoutWorker() {
    const SIZE = 1024, MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
    const photos = new Map();   // id -> { image: ImageBitmap, alpha: Uint8ClampedArray }
    const context = canvas => canvas.getContext('2d', { willReadFrequently: true });
    const pixelsOf = (image, width, height) => {
      const ctx = context(new OffscreenCanvas(width, height));
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, 0, 0, width, height);
      return ctx.getImageData(0, 0, width, height).data;
    };

    // A small picture for the queue, at most 112 px.
    async function thumb({ file }) {
      const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const scale = Math.min(112 / image.width, 112 / image.height), canvas = new OffscreenCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      image.close();
      return { thumb: await canvas.convertToBlob({ type: 'image/png' }) };
    }

    // A picture as rembg gives it to the model: 1024×1024, scaled by its brightest value, normalized.
    function inputOf(image) {
      const pixels = pixelsOf(image, SIZE, SIZE), plane = SIZE * SIZE, input = new Float32Array(3 * plane);
      let max = 0;
      for (let i = 0; i < pixels.length; i += 4) max = Math.max(max, pixels[i], pixels[i + 1], pixels[i + 2]);
      const scale = 1 / Math.max(max, 1e-6);
      for (let i = 0; i < plane; i++) for (let c = 0; c < 3; c++) input[c * plane + i] = (pixels[i * 4 + c] * scale - MEAN[c]) / STD[c];
      return input;
    }
    // The photo decoded, and its input for the model.
    async function prepare({ id, file }) {
      const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
      photos.set(id, { image, alpha: null });
      return { width: image.width, height: image.height, input: inputOf(image), image: await createImageBitmap(image) };
    }

    // ---------- Animations ----------
    // How many frames a picture has (1 for a still one), read in full so a GIF's count is final.
    async function frames({ file }) {
      if (typeof ImageDecoder === 'undefined' || !await ImageDecoder.isTypeSupported(file.type)) return { count: 1 };
      const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type });
      try {
        await decoder.tracks.ready;
        await decoder.completed;
        return { count: decoder.tracks.selectedTrack?.frameCount || 1 };
      } catch {
        return { count: 1 };
      } finally {
        decoder.close();
      }
    }
    // Every frame (up to limit) decoded whole, as it shows, scaled down together if very large; their delays in ms.
    async function prepareFrames({ id, file, limit, maxPixels }) {
      const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type });
      try {
        await decoder.tracks.ready;
        await decoder.completed;
        const count = Math.min(limit, decoder.tracks.selectedTrack.frameCount), list = [], delays = [];
        for (let index = 0; index < count; index++) {
          const { image } = await decoder.decode({ frameIndex: index });
          const scale = Math.min(1, Math.sqrt(maxPixels / (count * image.displayWidth * image.displayHeight)));
          list.push(await createImageBitmap(image, { resizeWidth: Math.max(1, Math.round(image.displayWidth * scale)), resizeHeight: Math.max(1, Math.round(image.displayHeight * scale)), resizeQuality: 'high' }));
          delays.push((image.duration ?? 100000) / 1000);
          image.close();
        }
        photos.set(id, { image: list[0], frames: list, alphas: [], alpha: null });
        return { width: list[0].width, height: list[0].height, count, delays, sources: await Promise.all(list.map(frame => createImageBitmap(frame))) };
      } finally {
        decoder.close();
      }
    }
    const frameInput = ({ id, index }) => ({ input: inputOf(photos.get(id).frames[index]) });
    // The cut-out frames as one animated PNG: trimmed to what shows in any frame (with trim), at most maxSide, and
    // smaller again until it is under maxBytes.
    async function encode({ frames: list, delays, trim, maxSide, maxBytes }) {
      const width = list[0].width, height = list[0].height, alphaOf = frame => pixelsOf(frame, width, height);
      let box = { x: 0, y: 0, width, height };
      if (trim) {
        let left = width, top = height, right = -1, bottom = -1;
        for (const frame of list) {
          const data = alphaOf(frame);
          for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] <= 8) continue;
            if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
          }
        }
        if (right >= 0) {
          left = Math.max(0, left - 2); top = Math.max(0, top - 2);
          box = { x: left, y: top, width: Math.min(width, right + 3) - left, height: Math.min(height, bottom + 3) - top };
        }
      }
      let side = Math.min(maxSide, Math.max(box.width, box.height));
      for (;;) {
        const scale = side / Math.max(box.width, box.height), w = Math.max(1, Math.round(box.width * scale)), h = Math.max(1, Math.round(box.height * scale));
        const rgba = list.map(frame => {
          const ctx = context(new OffscreenCanvas(w, h));
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(frame, box.x, box.y, box.width, box.height, 0, 0, w, h);
          return ctx.getImageData(0, 0, w, h).data;
        });
        const data = await cutoutWriteAPNG(rgba, w, h, delays);
        if (data.length <= maxBytes || side <= 128) {
          for (const frame of list) frame.close();
          if (data.length > maxBytes) throw new Error('動圖太大，請換一個格數或尺寸小一點的。');
          return { data };
        }
        side = Math.floor(side * 0.75);
      }
    }

    // r×r mean, edges repeated (as cv2.blur), in two passes.
    function boxBlur(source, width, height, r) {
      const across = new Float32Array(source.length), out = new Float32Array(source.length), half = r >> 1;
      for (let y = 0; y < height; y++) {
        const row = y * width;
        let sum = 0;
        for (let k = -half; k < r - half; k++) sum += source[row + Math.min(width - 1, Math.max(0, k))];
        for (let x = 0; x < width; x++) {
          across[row + x] = sum / r;
          sum += source[row + Math.min(width - 1, x + r - half)] - source[row + Math.max(0, x - half)];
        }
      }
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let k = -half; k < r - half; k++) sum += across[Math.min(height - 1, Math.max(0, k)) * width + x];
        for (let y = 0; y < height; y++) {
          out[y * width + x] = sum / r;
          sum += across[Math.min(height - 1, y + r - half) * width + x] - across[Math.max(0, y - half) * width + x];
        }
      }
      return out;
    }

    // Approximate Fast Foreground Colour Estimation ("blur fusion"; M. Forte, F. Pitié, ICIP 2021,
    // doi:10.1109/ICIP42928.2021.9506164; radius 90, then 6), written here in JavaScript from the paper's method: the
    // colour a soft edge pixel would have without the background mixed in. The smooth fields are worked out on a copy at
    // most 2048 px large (radii scaled alike) and read back at the photo's size, where F = bF + a(I − a·bF − (1 − a)·bB).
    function foregroundFields(image, alpha, width, height) {
      const s = Math.min(1, 2048 / Math.max(width, height)), w = Math.max(1, Math.round(width * s)), h = Math.max(1, Math.round(height * s)), n = w * h;
      const rgb = pixelsOf(image, w, h), alphaImage = new ImageData(width, height);
      for (let i = 0; i < alpha.length; i++) { alphaImage.data[i * 4] = alpha[i]; alphaImage.data[i * 4 + 3] = 255; }
      const full = new OffscreenCanvas(width, height);
      full.getContext('2d').putImageData(alphaImage, 0, 0);
      const smallAlpha = pixelsOf(full, w, h);
      const I = [0, 1, 2].map(c => Float32Array.from({ length: n }, (_, i) => rgb[i * 4 + c] / 255));
      const A = Float32Array.from({ length: n }, (_, i) => smallAlpha[i * 4] / 255);
      let F = I, B = I, fields = null;
      for (const radius of [90, 6]) {
        const r = Math.max(1, Math.round(radius * s)), blurredA = boxBlur(A, w, h, r), nextF = [], bF = [], bB = [];
        for (let c = 0; c < 3; c++) {
          const FA = new Float32Array(n), BA = new Float32Array(n);
          for (let i = 0; i < n; i++) { FA[i] = F[c][i] * A[i]; BA[i] = B[c][i] * (1 - A[i]); }
          const blurredFA = boxBlur(FA, w, h, r), blurredBA = boxBlur(BA, w, h, r);
          const f = new Float32Array(n), b = new Float32Array(n), next = new Float32Array(n);
          for (let i = 0; i < n; i++) {
            f[i] = blurredFA[i] / (blurredA[i] + 1e-5);
            b[i] = blurredBA[i] / (1 - blurredA[i] + 1e-5);
            next[i] = Math.min(1, Math.max(0, f[i] + A[i] * (I[c][i] - A[i] * f[i] - (1 - A[i]) * b[i])));
          }
          nextF.push(next); bF.push(f); bB.push(b);
        }
        F = nextF;
        B = bB;
        fields = { bF, bB };
      }
      // A field's value at a full-size pixel, read bilinearly.
      const read = (field, x, y) => {
        const fx = Math.min(w - 1, Math.max(0, (x + 0.5) * s - 0.5)), fy = Math.min(h - 1, Math.max(0, (y + 0.5) * s - 0.5));
        const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
        const top = field[y0 * w + x0] * (1 - tx) + field[y0 * w + x1] * tx, bottom = field[y1 * w + x0] * (1 - tx) + field[y1 * w + x1] * tx;
        return top * (1 - ty) + bottom * ty;
      };
      return { read, ...fields };
    }

    // The cutout: with a mask (1024×1024 bytes from the model) it becomes the photo's alpha, smoothly up to its size
    // and times its own alpha; then the colours, by the chosen edges.
    // With index, one frame of an animation.
    function compose({ id, index, mask, edges }) {
      const photo = photos.get(id), image = index === undefined ? photo.image : photo.frames[index], width = image.width, height = image.height;
      const pixels = pixelsOf(image, width, height);
      if (mask) {
        const small = new ImageData(SIZE, SIZE);
        for (let i = 0; i < mask.length; i++) { small.data[i * 4] = mask[i]; small.data[i * 4 + 3] = 255; }
        const canvas = new OffscreenCanvas(SIZE, SIZE);
        canvas.getContext('2d').putImageData(small, 0, 0);
        const scaled = pixelsOf(canvas, width, height), made = new Uint8ClampedArray(width * height);
        for (let i = 0; i < made.length; i++) made[i] = Math.round(scaled[i * 4] * pixels[i * 4 + 3] / 255);
        if (index === undefined) photo.alpha = made; else photo.alphas[index] = made;
      }
      const alpha = index === undefined ? photo.alpha : photo.alphas[index], out = new ImageData(width, height), data = out.data;
      const fields = edges === 'clean' ? foregroundFields(image, alpha, width, height) : null;
      for (let i = 0; i < alpha.length; i++) {
        const a = alpha[i], at = i * 4;
        data[at + 3] = a;
        if (fields && a > 0 && a < 255) {
          const x = i % width, y = (i - x) / width, t = a / 255;
          for (let c = 0; c < 3; c++) {
            const bF = fields.read(fields.bF[c], x, y), bB = fields.read(fields.bB[c], x, y);
            data[at + c] = Math.round(255 * Math.min(1, Math.max(0, bF + t * (pixels[at + c] / 255 - t * bF - (1 - t) * bB))));
          }
        } else {
          data[at] = pixels[at]; data[at + 1] = pixels[at + 1]; data[at + 2] = pixels[at + 2];
        }
      }
      const canvas = new OffscreenCanvas(width, height);
      canvas.getContext('2d').putImageData(out, 0, 0);
      return { result: canvas.transferToImageBitmap() };
    }

    function drop({ id }) {
      const photo = photos.get(id);
      for (const image of photo?.frames || [photo?.image]) image?.close();
      photos.delete(id);
      return {};
    }

    const handlers = { thumb, prepare, compose, drop, frames, prepareFrames, frameInput, encode };
    const movable = item => item instanceof ImageBitmap ? [item] : ArrayBuffer.isView(item) ? [item.buffer] : Array.isArray(item) ? item.flatMap(movable) : [];
    self.onmessage = async ({ data }) => {
      try {
        const value = await handlers[data.type](data);
        self.postMessage({ task: data.task, value }, Object.values(value).flatMap(movable));
      } catch (error) {
        self.postMessage({ task: data.task, error: String(error.message || error) });
      }
    };
  }

  let worker = null, tasks = 0;
  const waiting = new Map();
  // One request to the worker; resolves with its answer.
  function ask(type, payload = {}) {
    // The worker gets the APNG writer (apng.js) too.
    worker ??= Object.assign(new Worker(URL.createObjectURL(new Blob([String(cutoutWriteAPNG), '\n(' + cutoutWorker + ')()'], { type: 'text/javascript' }))), {
      onmessage: ({ data }) => {
        const pending = waiting.get(data.task);
        waiting.delete(data.task);
        if (data.error) pending?.reject(new Error(data.error)); else pending?.resolve(data.value);
      }
    });
    const task = ++tasks;
    return new Promise((resolve, reject) => {
      waiting.set(task, { resolve, reject });
      worker.postMessage({ ...payload, type, task }, [...(ArrayBuffer.isView(payload.mask) ? [payload.mask.buffer] : []), ...(payload.frames || [])]);
    });
  }

  // ---------- The queue ----------
  // { id, name, file, thumb (URL), status: 'waiting' | 'working' | 'ready' | 'failed', and once decoded: width, height,
  // image (ImageBitmap); once cut out: result (canvas being edited), undo, redo, edges }. An animation also has
  // frames (how many to cut out), and once decoded: sources and delays; once cut out: results (one per frame).
  let items = [], current = null, processing = false, ids = 0;
  let photo = null;    // the photo on show once it is cut out (current, when ready)
  let view = { scale: 1, x: 0, y: 0 }, controls = null, queued = false, adding = false;
  let brush = 'erase', edges = 'clean', trim = true, comparing = false;
  let stroke = null, pointer = null;

  function newCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  const context = canvas => canvas.getContext('2d', { willReadFrequently: true });

  // ---------- The view: the photo in a space 600 units high, zoomed and panned like the preview ----------
  // At rest the photo fits between the queue, the brushes, the details and the actions.
  function base() {
    const stage = $('cut-stage'), width = stage.clientWidth, height = stage.clientHeight, unit = height / 600;
    if (!current?.image || !unit) return { scale: 1, x: 0, y: 0 };
    const top = items.length > 1 ? 96 : 40, bottom = 96, side = 96;
    const pixel = Math.min((width - 2 * side) / current.width, (height - top - bottom) / current.height);
    return { scale: Math.max(pixel, 0.01) / unit, x: 0, y: (top - bottom) / 2 / unit };
  }
  function place() {
    const stage = $('cut-stage'), unit = stage.clientHeight / 600, pixel = view.scale * unit;
    const width = current.width * pixel, height = current.height * pixel;
    return { pixel, width, height, left: stage.clientWidth / 2 + view.x * unit - width / 2, top: stage.clientHeight / 2 + view.y * unit - height / 2 };
  }
  const toPhoto = (clientX, clientY) => {
    const box = $('cut-canvas').getBoundingClientRect(), at = place();
    return { x: (clientX - box.left - at.left) / at.pixel, y: (clientY - box.top - at.top) / at.pixel };
  };

  function draw() {
    const canvas = $('cut-canvas'), ratio = devicePixelRatio || 1;
    const width = Math.round(canvas.clientWidth * ratio), height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    if (!current?.image) return;
    const at = place();
    ctx.imageSmoothingEnabled = at.pixel < 2;
    ctx.imageSmoothingQuality = 'high';
    // A photo still being cut out shows faintly behind the ring; an animation plays (its frames, by their delays).
    ctx.globalAlpha = photo ? 1 : 0.35;
    if (photo?.results) {
      const frame = frameAt(photo, performance.now());
      ctx.drawImage(comparing ? photo.sources[frame] : photo.results[frame], at.left, at.top, at.width, at.height);
      requestDraw();
    } else {
      ctx.drawImage(photo && !comparing ? photo.result : current.image, at.left, at.top, at.width, at.height);
    }
    ctx.globalAlpha = 1;
    // The brush's outline under the pointer.
    if (pointer && photo && !comparing) {
      const radius = Number($('cut-size').value) / 2;
      ctx.lineWidth = 1;
      for (const [colour, extra] of [['rgba(0,0,0,.6)', 1], ['rgba(255,255,255,.9)', 0]]) {
        ctx.strokeStyle = colour;
        ctx.beginPath();
        ctx.arc(pointer.x, pointer.y, radius + extra, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
  // The frame of an animation showing at a time (ms).
  function frameAt(item, time) {
    const delays = item.delays.slice(0, item.results.length).map(delay => delay >= 20 ? delay : 100), total = delays.reduce((sum, delay) => sum + delay, 0);
    let left = time % total, frame = 0;
    while (left >= delays[frame] && frame < delays.length - 1) left -= delays[frame++];
    return frame;
  }
  function requestDraw() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; draw(); });
  }

  // ---------- Controls ----------
  function sync() {
    const ready = !!photo && !adding;
    $('cut-drop').hidden = items.length > 0;
    $('cut-busy').hidden = !current || current.status === 'ready' || current.status === 'failed';
    $('cut-tools').hidden = !photo || !!photo.results;
    $('cut-options').hidden = !photo;
    for (const id of ['cut-add', 'cut-save', 'cut-erase', 'cut-restore', 'cut-clean', 'cut-natural', 'cut-trim', 'cut-compare']) $(id).disabled = !ready;
    for (const [id, on] of [['cut-erase', brush === 'erase'], ['cut-restore', brush === 'restore'], ['cut-clean', edges === 'clean'], ['cut-natural', edges === 'natural'], ['cut-trim', trim], ['cut-compare', comparing]]) {
      $(id).setAttribute('aria-pressed', String(on));
    }
    renderQueue();
    requestDraw();
  }
  const message = text => { $('cut-message').textContent = text || ''; };
  // A short shake (editor.css, 0.32 s), then the stage as it was.
  let shaking = null;
  function shake() {
    const stage = $('cut-stage');
    clearTimeout(shaking);
    stage.classList.remove('shake');
    void stage.offsetWidth;
    stage.classList.add('shake');
    shaking = setTimeout(() => stage.classList.remove('shake'), 340);
  }

  // The queue (with more than one photo): a thumbnail each, the one on show marked; × drops one.
  function renderQueue() {
    const row = $('cut-queue');
    row.hidden = items.length < 2;
    row.replaceChildren(...items.map(item => {
      const cell = document.createElement('div'), pick = document.createElement('button'), drop = document.createElement('button');
      cell.className = 'cut-thumb ' + item.status + (item === current ? ' current' : '');
      pick.type = drop.type = 'button';
      pick.title = item.name;
      pick.ariaLabel = item.name;
      pick.style.backgroundImage = 'url("' + item.thumb + '")';
      pick.onclick = () => show(item);
      drop.className = 'cut-thumb-drop';
      drop.title = drop.ariaLabel = '移除';
      drop.textContent = '×';
      drop.onclick = () => removeItem(item);
      cell.append(pick, drop);
      return cell;
    }));
  }

  function show(item) {
    if (stroke) return;
    current = item;
    photo = item?.status === 'ready' ? item : null;
    comparing = false;
    message(item?.status === 'failed' ? item.failure : '');
    controls?.reset();
    sync();
    // A photo cut out with the other edges is cut out again with these.
    if (photo && photo.edges !== edges) recompose(photo);
  }
  function forget(item) {
    if (item.status !== 'waiting') ask('drop', { id: item.id });
    item.image?.close();
    for (const frame of [...(item.sources || []), ...(item.results || [])]) frame.close();
    URL.revokeObjectURL(item.thumb);
  }
  function removeItem(item) {
    const index = items.indexOf(item);
    items = items.filter(other => other !== item);
    forget(item);
    if (item === current) show(items[Math.min(index, items.length - 1)] || null); else sync();
  }

  // ---------- Photos in: the queue, cut out one after another ----------
  // The model, downloaded once after asking (its size is said); its progress shows in the ring.
  async function ensureModel() {
    let status = await call('status');
    if (status.model === 'missing') {
      const agreed = await CharacterDesktop.confirm('需要先下載去背模型', {
        detail: '約 ' + Math.round(status.bytes / 1e6) + ' MB，只需下載一次。' + (status.failure ? '\n上次失敗：' + status.failure : ''), ok: '下載'
      });
      if (!agreed) return false;
      status = await call('fetchModel');
    }
    while (status.model === 'downloading') {
      $('cut-percent').textContent = Math.floor(status.received / Math.max(1, status.total) * 100) + '%';
      await sleep(400);
      status = await call('status');
    }
    $('cut-percent').textContent = '';
    if (status.model !== 'ready') message(status.failure || '模型下載失敗。');
    return status.model === 'ready';
  }

  // Photos join the queue with a thumbnail only; files that are not photos (or cannot be read) shake the stage at
  // once. The first one new is shown.
  async function loadFiles(files) {
    message('');
    if (files.some(file => !TYPES.includes(file?.type))) shake();
    const added = [];
    for (const file of files.filter(item => TYPES.includes(item?.type))) {
      if (items.length + added.length >= MAX_QUEUE) { shake(); break; }
      try {
        const frames = ANIMATED.includes(file.type) ? await animationFrames(file) : 1;
        if (!frames) continue;
        const { thumb } = await ask('thumb', { file });
        added.push({ id: ++ids, name: file.name.replace(/\.[^.]+$/, '') || '去背', file, status: 'waiting', thumb: URL.createObjectURL(thumb), ...(frames > 1 ? { frames } : {}) });
      } catch {
        shake();
      }
    }
    if (!added.length) return false;
    items = [...items, ...added];
    if (!current || current.status === 'failed') show(added[0]); else sync();
    work();
    return true;
  }

  // An animation asks first: how many frames to cut out (0: leave it out; 1: as a photo).
  async function animationFrames(file) {
    const { count } = await ask('frames', { file });
    if (count < 2) return 1;
    const answer = await CharacterDesktop.ask({
      message: '這是動圖（共 ' + count + ' 格）', detail: (count > MAX_FRAMES ? '只會處理前 ' + MAX_FRAMES + ' 格。' : '') + '每一格都要去背，需要一點時間。',
      buttons: [{ label: '取消', value: 'cancel' }, { label: '只用第一格', value: 'first' }, { label: '逐格去背', value: 'all', kind: 'primary' }]
    });
    return answer === 'all' ? Math.min(count, MAX_FRAMES) : answer === 'first' ? 1 : 0;
  }

  // An animation: every frame through the model and cut out, one after another; the ring counts them.
  async function cutOutFrames(item) {
    const prepared = await ask('prepareFrames', { id: item.id, file: item.file, limit: item.frames, maxPixels: MAX_FRAME_PIXELS });
    Object.assign(item, { width: prepared.width, height: prepared.height, image: prepared.sources[0], sources: prepared.sources, delays: prepared.delays });
    if (item === current) { controls?.reset(); sync(); }
    const results = [];
    try {
      for (let index = 0; index < prepared.count && items.includes(item); index++) {
        if (item === current) $('cut-percent').textContent = (index + 1) + ' / ' + prepared.count;
        const mask = await call('remove', (await ask('frameInput', { id: item.id, index })).input);
        results.push((await ask('compose', { id: item.id, index, mask, edges })).result);
      }
    } finally {
      $('cut-percent').textContent = '';
    }
    Object.assign(item, { results, result: null, undo: [], redo: [], edges });
  }

  // One photo at a time: decoded in the worker, through the model, cut out in the worker.
  async function cutOut(item) {
    if (item.frames) return cutOutFrames(item);
    const prepared = await ask('prepare', { id: item.id, file: item.file });
    Object.assign(item, { width: prepared.width, height: prepared.height, image: prepared.image });
    if (item === current) { controls?.reset(); sync(); }
    const mask = await call('remove', prepared.input);
    const { result } = await ask('compose', { id: item.id, mask, edges });
    setResult(item, result);
  }
  function setResult(item, bitmap) {
    item.result = newCanvas(bitmap.width, bitmap.height);
    item.result.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    Object.assign(item, { undo: [], redo: [], edges });
  }
  async function work() {
    if (processing) return;
    processing = true;
    try {
      while (items.some(item => item.status === 'waiting')) {
        if (!await ensureModel()) {
          for (const item of items) if (item.status === 'waiting') Object.assign(item, { status: 'failed', failure: '需要去背模型。' });
          break;
        }
        const item = items.find(other => other.status === 'waiting');
        item.status = 'working';
        sync();
        try {
          await cutOut(item);
          item.status = 'ready';
        } catch (error) {
          Object.assign(item, { status: 'failed', failure: String(error.message || error) });
        }
        if (!items.includes(item)) forget(item);
        else if (item === current) show(item); else sync();
      }
    } finally {
      processing = false;
      sync();
    }
  }

  // ---------- Edges: the cutout again (in the worker), without the repairs ----------
  async function recompose(item) {
    item.status = 'working';
    if (item === current) photo = null;
    sync();
    try {
      if (item.results) {
        const results = [];
        for (let index = 0; index < item.results.length; index++) results.push((await ask('compose', { id: item.id, index, edges })).result);
        for (const frame of item.results) frame.close();
        Object.assign(item, { results, edges });
      } else {
        setResult(item, (await ask('compose', { id: item.id, edges })).result);
      }
      item.status = 'ready';
    } catch (error) {
      Object.assign(item, { status: 'failed', failure: String(error.message || error) });
    }
    if (item === current) show(item); else sync();
  }
  function setEdges(next) {
    if (edges === next || !photo) return;
    edges = next;
    recompose(photo);
  }

  // ---------- Brushes: erase, or bring the photo back; each stroke can be undone ----------
  const stamps = new Map();
  function stampOf(radius) {
    const size = Math.max(2, Math.ceil(radius * 2)), key = size;
    if (!stamps.has(key)) {
      const stamp = newCanvas(size, size), ctx = stamp.getContext('2d'), gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      // Feathered, so repairs leave no hard circular edge.
      gradient.addColorStop(0, 'rgba(0,0,0,1)');
      gradient.addColorStop(0.6, 'rgba(0,0,0,1)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      stamps.clear();
      stamps.set(key, stamp);
    }
    return stamps.get(key);
  }
  function paintAt(point, radius) {
    const ctx = photo.result.getContext('2d'), stamp = stampOf(radius), size = stamp.width, left = point.x - size / 2, top = point.y - size / 2;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(stamp, left, top);
    if (brush === 'restore') {
      // Replaced by the photo where the brush covers, rather than piled up.
      const piece = newCanvas(size, size), pctx = piece.getContext('2d');
      pctx.drawImage(photo.image, left, top, size, size, 0, 0, size, size);
      pctx.globalCompositeOperation = 'destination-in';
      pctx.drawImage(stamp, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(piece, left, top);
    }
    ctx.globalCompositeOperation = 'source-over';
    const box = stroke.box;
    box[0] = Math.min(box[0], left); box[1] = Math.min(box[1], top); box[2] = Math.max(box[2], left + size); box[3] = Math.max(box[3], top + size);
  }
  function paint(to) {
    const radius = Number($('cut-size').value) / 2 / place().pixel, from = stroke.last;
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / Math.max(1, radius * 0.25)));
    for (let k = 1; k <= steps; k++) paintAt({ x: from.x + (to.x - from.x) * k / steps, y: from.y + (to.y - from.y) * k / steps }, radius);
    stroke.last = to;
  }
  function startStroke(event) {
    if (event.button !== 0 || !photo || photo.results || adding || comparing) return;
    const before = newCanvas(photo.result.width, photo.result.height);
    before.getContext('2d').drawImage(photo.result, 0, 0);
    const point = toPhoto(event.clientX, event.clientY);
    stroke = { before, box: [Infinity, Infinity, -Infinity, -Infinity], last: point };
    paint(point);
    try { $('cut-canvas').setPointerCapture(event.pointerId); } catch { /* synthetic events have no pointer */ }
    requestDraw();
  }
  function endStroke() {
    if (!stroke) return;
    const { before, box } = stroke, result = photo.result;
    stroke = null;
    const x = Math.max(0, Math.floor(box[0])), y = Math.max(0, Math.floor(box[1]));
    const width = Math.min(result.width, Math.ceil(box[2])) - x, height = Math.min(result.height, Math.ceil(box[3])) - y;
    if (width <= 0 || height <= 0) return;
    photo.undo.push({ x, y, before: context(before).getImageData(x, y, width, height), after: context(result).getImageData(x, y, width, height) });
    photo.redo = [];
    const bytes = () => [...photo.undo, ...photo.redo].reduce((sum, step) => sum + step.before.data.length * 2, 0);
    while (photo.undo.length && bytes() > HISTORY_BYTES) photo.undo.shift();
  }
  function history(back) {
    const step = photo && (back ? photo.undo : photo.redo).pop();
    if (!step) return;
    context(photo.result).putImageData(back ? step.before : step.after, step.x, step.y);
    (back ? photo.redo : photo.undo).push(step);
    requestDraw();
  }

  // ---------- What leaves the editor: trimmed (裁邊) and, for a character, not too large ----------
  // The smallest box holding every pixel that shows (repairs included), with 2 px around it.
  function trimBox(canvas) {
    const { width, height } = canvas, data = context(canvas).getImageData(0, 0, width, height).data;
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] <= TRIM_ALPHA) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    if (right < 0) return { x: 0, y: 0, width, height };
    left = Math.max(0, left - 2); top = Math.max(0, top - 2);
    return { x: left, y: top, width: Math.min(width, right + 3) - left, height: Math.min(height, bottom + 3) - top };
  }
  function output(item, maxSide = Infinity) {
    const box = trim ? trimBox(item.result) : { x: 0, y: 0, width: item.result.width, height: item.result.height };
    const scale = Math.min(1, maxSide / Math.max(box.width, box.height));
    const out = newCanvas(Math.max(1, Math.round(box.width * scale)), Math.max(1, Math.round(box.height * scale))), ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(item.result, box.x, box.y, box.width, box.height, 0, 0, out.width, out.height);
    return out;
  }
  const pngOf = canvas => new Promise(resolve => canvas.toBlob(resolve, 'image/png')).then(blob => blob.arrayBuffer()).then(buffer => new Uint8Array(buffer));
  // What is added or downloaded: a PNG, or for an animation an animated PNG (made in the worker from copies of its
  // frames). maxSide applies to characters.
  async function pictureOf(item, maxSide = Infinity) {
    if (!item.results) return pngOf(output(item, maxSide));
    const frames = await Promise.all(item.results.map(frame => createImageBitmap(frame)));
    return (await ask('encode', { frames, delays: item.delays.slice(0, frames.length), trim, maxSide, maxBytes: maxSide === Infinity ? Infinity : PICTURE_BYTES })).data;
  }

  // ---------- 加入, 下載, ✕ ----------
  // 加入: with local characters, a menu: a new character, or the next expression of one of them.
  function setAddMenuOpen(open) {
    const locals = CharacterDesktop.characters().filter(entry => CharacterDesktop.isLocal(entry)), menu = $('cut-add-menu');
    if (open && locals.length) {
      const item = (label, characterId) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.onclick = () => { setAddMenuOpen(false); addTo(characterId); };
        return button;
      };
      menu.replaceChildren(item('新角色', ''), ...locals.map(entry => item(CharacterDesktop.label(entry), entry.id)));
    }
    menu.hidden = !(open && locals.length);
    $('cut-add').setAttribute('aria-expanded', String(!menu.hidden));
    return !menu.hidden;
  }
  async function addTo(characterId) {
    if (!photo || adding) return null;
    const item = photo;
    adding = true;
    sync();
    try {
      let data;
      try { data = await pictureOf(item, ADD_MAX_SIDE); } catch (error) { message(String(error.message || error)); return null; }
      const answer = await CharacterDesktop.addPicture(item.name, data, characterId || '');
      if (!answer?.ok) { message(answer?.message || '無法加入。'); return answer; }
      // Added: the photo leaves the queue; with none left the editor closes.
      removeItem(item);
      if (!items.length) await CharacterDesktop.closeTool();
      return answer;
    } finally {
      adding = false;
      sync();
    }
  }
  async function savePicture() {
    if (!photo || adding) return null;
    let data;
    try { data = await pictureOf(photo); } catch (error) { message(String(error.message || error)); return null; }
    const answer = await CharacterDesktop.saveFile(photo.name + '.png', data);
    if (!answer?.ok && !answer?.cancelled) message(answer?.message || '無法儲存。');
    return answer;
  }

  // ---------- Opening and closing ----------
  const listeners = {
    dragover: event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; $('cut-stage').classList.add('over'); },
    dragleave: event => { if (!event.relatedTarget) $('cut-stage').classList.remove('over'); },
    drop: event => { event.preventDefault(); $('cut-stage').classList.remove('over'); loadFiles([...(event.dataTransfer?.files || [])]); },
    keydown: event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); history(!event.shiftKey); }
      if (event.key === 'Escape') setAddMenuOpen(false);
    },
    pointerdown: event => { if (!event.target.closest?.('#cut-add, #cut-add-menu')) setAddMenuOpen(false); },
    resize: () => requestDraw()
  };
  function open() {
    controls ??= CharacterDesktop.panZoom($('cut-canvas'), {
      isReady: () => !!current?.image, getBase: base, apply: next => { view = next; requestDraw(); }, onPoke: () => {}, maxZoom: 16
    });
    for (const [name, listener] of Object.entries(listeners)) window.addEventListener(name, listener);
    message('');
    sync();
  }
  async function close() {
    for (const [name, listener] of Object.entries(listeners)) window.removeEventListener(name, listener);
    setAddMenuOpen(false);
    for (const item of items) forget(item);
    items = [];
    current = photo = stroke = pointer = null;
    comparing = false;
    sync();
    await call('release');
  }

  const canvas = $('cut-canvas');
  canvas.addEventListener('pointerdown', startStroke);
  canvas.addEventListener('pointermove', event => {
    pointer = { x: event.offsetX, y: event.offsetY };
    if (stroke && event.buttons & 1) paint(toPhoto(event.clientX, event.clientY));
    requestDraw();
  });
  canvas.addEventListener('pointerleave', () => { pointer = null; requestDraw(); });
  window.addEventListener('pointerup', endStroke);
  window.addEventListener('pointercancel', endStroke);
  $('cut-erase').onclick = () => { brush = 'erase'; sync(); };
  $('cut-restore').onclick = () => { brush = 'restore'; sync(); };
  $('cut-size').oninput = requestDraw;
  $('cut-clean').onclick = () => setEdges('clean');
  $('cut-natural').onclick = () => setEdges('natural');
  $('cut-trim').onclick = () => { trim = !trim; sync(); };
  $('cut-compare').onclick = () => { comparing = !comparing; sync(); };
  $('cut-add').onclick = () => { if (!setAddMenuOpen($('cut-add-menu').hidden)) addTo(''); };
  $('cut-save').onclick = savePicture;
  $('cut-close').onclick = () => CharacterDesktop.closeTool();

  registerTool(ID, {
    name: '圖片去背',
    open,
    close,
    // Pictures the App would rather have cut out first (a JPG without transparency) can come straight here.
    takePictures: { label: '去背', load: files => loadFiles(files) },
    test: {
      load: files => loadFiles(files),
      show: index => show(items[index]),
      add: characterId => addTo(characterId),
      save: savePicture,
      state: () => ({
        photo: !!photo, width: photo?.width, height: photo?.height, undo: photo?.undo.length, redo: photo?.redo.length,
        brush, edges, trim, comparing, queue: items.map(item => item.status), index: items.indexOf(current), frames: photo?.results?.length || 0
      }),
      pixelAt: (x, y) => [...context(photo.result).getImageData(x, y, 1, 1).data],
      screenOf: (x, y) => { const box = $('cut-canvas').getBoundingClientRect(), at = place(); return { x: box.left + at.left + x * at.pixel, y: box.top + at.top + y * at.pixel }; }
    }
  });
})();
