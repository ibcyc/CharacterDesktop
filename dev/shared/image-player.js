// ImagePlayer: shows a local character's picture (png, webp, svg or gif) in an <img> and gives it some life: it
// breathes (stretching up from its feet), bounces when poked, and can be mirrored. Animated gif and webp play by
// themselves. Like CharacterViewer, it places the picture in a space 600 units high centred on `frame` (an element
// the same size as the img's container): (x, y) is where the picture's bottom centre stands and one picture pixel
// is `scale` units, so the preview's zoom and pan work the same for both.

const IMAGE_REF_HEIGHT = 600;
const BREATH_MAX = 0.04;      // stretch at breath strength 100
const BOUNCE_MAX = 0.18;      // squash at bounce strength 100
const BOUNCE_SECONDS = 1.2;
const HIT_SAMPLE_SIZE = 256;  // longest side of the picture copy used to tell its outline

// Pictures of local characters as object URLs, fetched from the app once per page.
const localImageURLs = new Map();
function localImageURL(entry, expression) {
  const id = entry.files[expression] ? String(expression) : '0', key = entry.id + ':' + id + ':' + entry.files[id];
  if (!localImageURLs.has(key)) {
    localImageURLs.set(key, window.desktopAPI.localImage(entry.id, id).then(image => {
      if (!image) throw new Error('讀不到圖片：' + entry.files[id]);
      return URL.createObjectURL(new Blob([image.data], { type: image.mime }));
    }).catch(error => { localImageURLs.delete(key); throw error; }));
  }
  return localImageURLs.get(key);
}

class ImagePlayer {
  constructor(img, frame) {
    this.img = img;
    this.frame = frame;
    this.scale = 1;
    this.x = 0;
    this.y = 0;
    this.url = '';                    // the newest picture asked for
    this.loading = Promise.resolve(); // settles once that picture is on show
    this.source = null;               // the decoded picture on show, for opaqueAt
    this.width = 0;
    this.height = 0;
    this.tuning = { breath: 40, rate: 15, bounce: 50 };
    this.mirror = false;
    this.bounce = null;     // { start, strength } of the poke being played
    this.sample = null;     // alpha of the picture, for opaqueAt
    requestAnimationFrame(time => this.tick(time));
  }

  // Shows a picture and settles once the newest picture asked for is on show. A picture is decoded off screen first,
  // so the one on show stays until the next is ready (large pictures take a moment). A picture replaced by a newer
  // one while it decodes is dropped quietly; only the newest can fail.
  show(url) {
    if (url !== this.url) {
      this.url = url;
      this.loading = this.load(url);
    }
    return this.loading;
  }
  async load(url) {
    const next = new Image();
    next.src = url;
    try {
      await next.decode();
    } catch (error) {
      if (this.url !== url) return this.loading;
      throw error;
    }
    if (this.url !== url) return this.loading;
    this.source = next;
    // An svg without its own size counts as 300 px square.
    this.width = next.naturalWidth || 300;
    this.height = next.naturalHeight || 300;
    this.sample = null;
    this.img.src = url;
    this.img.hidden = false;
    this.place(performance.now());
  }
  hide() {
    this.url = '';
    this.loading = Promise.resolve();
    this.source = null;
    this.sample = null;
    this.img.hidden = true;
    this.img.removeAttribute('src');
  }

  // Every change shows at once, not only on the next animation frame.
  setScale(scale) { this.scale = scale; this.refresh(); }
  setPosition(x, y) { this.x = x; this.y = y; this.refresh(); }
  setTuning(tuning) { this.tuning = { ...this.tuning, ...tuning }; this.refresh(); }
  setMirror(on) { this.mirror = !!on; this.refresh(); }
  poke(strength = 1) { this.bounce = { start: performance.now(), strength }; this.refresh(); }
  refresh() { if (this.url) this.place(performance.now()); }

  // How far beyond its size the picture can stretch while breathing and bouncing, for fitting it into a window.
  reach() { return 1 + BREATH_MAX * this.tuning.breath / 100 + BOUNCE_MAX * 1.6 * this.tuning.bounce / 100; }

  // The scale and position that fit the picture into `frame`, standing on its bottom edge with `pad` pixels around.
  fit(pad) {
    const width = this.frame.clientWidth, height = this.frame.clientHeight, unit = height / IMAGE_REF_HEIGHT;
    const pixels = Math.min((width - 2 * pad) / this.width, (height - 2 * pad) / this.height) / this.reach();
    return { scale: pixels / unit, x: 0, y: (height / 2 - pad) / unit };
  }

  // The picture's box in the frame, in CSS pixels, before breathing and bouncing.
  box() {
    const unit = this.frame.clientHeight / IMAGE_REF_HEIGHT;
    const width = this.width * this.scale * unit, height = this.height * this.scale * unit;
    const left = this.frame.clientWidth / 2 + this.x * unit - width / 2, bottom = this.frame.clientHeight / 2 + this.y * unit;
    return { left, top: bottom - height, width, height };
  }

  tick(time) {
    if (this.url) this.place(time);
    requestAnimationFrame(next => this.tick(next));
  }

  place(time) {
    const { left, top, width, height } = this.box(), style = this.img.style;
    style.left = left + 'px';
    style.top = top + 'px';
    style.width = width + 'px';
    style.height = height + 'px';
    // Breathing: up and slightly in, `rate` times a minute. A poke squashes the picture and lets it spring back.
    let stretch = BREATH_MAX * this.tuning.breath / 100 * Math.sin(time / 1000 * 2 * Math.PI * this.tuning.rate / 60);
    if (this.bounce) {
      const seconds = (time - this.bounce.start) / 1000;
      if (seconds > BOUNCE_SECONDS) this.bounce = null;
      else stretch -= BOUNCE_MAX * this.tuning.bounce / 100 * this.bounce.strength * Math.exp(-seconds * 5) * Math.sin(seconds * 2 * Math.PI * 3);
    }
    style.transform = 'scale(' + (this.mirror ? -1 : 1) * (1 - stretch / 2) + ',' + (1 + stretch) + ')';
  }

  // Whether a point of the frame (CSS pixels) is on the picture and not on a transparent part of it.
  opaqueAt(x, y) {
    if (!this.url || !this.source) return false;
    const { left, top, width, height } = this.box();
    let u = (x - left) / width;
    const v = (y - top) / height;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;
    if (this.mirror) u = 1 - u;
    if (!this.sample) {
      const ratio = Math.min(1, HIT_SAMPLE_SIZE / Math.max(this.width, this.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(this.width * ratio));
      canvas.height = Math.max(1, Math.round(this.height * ratio));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(this.source, 0, 0, canvas.width, canvas.height);
      this.sample = { width: canvas.width, height: canvas.height, alpha: context.getImageData(0, 0, canvas.width, canvas.height).data };
    }
    const { width: sw, height: sh, alpha } = this.sample;
    return alpha[(Math.floor(v * sh) * sw + Math.floor(u * sw)) * 4 + 3] > 16;
  }
}
