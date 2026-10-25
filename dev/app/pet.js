// Desktop character page: shows the character in the transparent window and handles hovering, clicking (poking),
// dragging and the right-click menu. The character's kind (shared/character-kinds.js) draws it: 'local' below for the
// user's pictures, or an extension's kind, whose scripts run here first (loadExtensionPages).

let lastPacket = null, pendingPacket = null, petReady = false, petBusy = false, activeKind = null;
let lastPokePlan = null, packets = 0;    // read by the self-tests

// What a kind on this page may use.
// ---------- Pictures ----------
// One picture player for every kind whose characters are pictures; fitPicture fits the picture into the window.
let imagePlayer = null;
function picturePlayer() { return imagePlayer ??= new ImagePlayer(document.getElementById('pet-image'), document.getElementById('pet-canvas')); }
function fitPicture() {
  const { scale, x, y } = picturePlayer().fit(Math.max(12, Math.min(innerWidth, innerHeight) * 0.055));
  imagePlayer.setScale(scale);
  imagePlayer.setPosition(x, y);
}

const CharacterDesktop = {
  canvas: () => document.getElementById('pet-canvas'),
  busy: () => petBusy,
  error: message => window.desktopAPI.petError(String(message)),
  call: (id, name, ...args) => window.desktopAPI.extensionCall(id, name, args),
  imagePlayer: picturePlayer,
  fitPicture
};

// ---------- Local characters ----------
// The picture of the expression on show (a poke's temporary one, an automatic change's or the chosen one), fitted
// into the window.
let localPacket = null, localAuto = null;
const localPokes = createPokeSession(() => showPicture());

async function showPicture() {
  if (!localPacket) return;
  try {
    await picturePlayer().show(await localImageURL(localPacket.entry, localPokes.temporaryExpression || localAuto || localPacket.selection.expression));
    fitPicture();
  } catch (error) {
    CharacterDesktop.error(error.message || error);
  }
}

registerCharacterKind('local', {
  async apply(packet) {
    picturePlayer();
    if (packet.entry.id !== localPacket?.entry.id) { localPokes.reset(); localAuto = null; }
    localPacket = packet;
    imagePlayer.setTuning(packet.tuning);
    imagePlayer.setMirror(packet.mirror);
    await showPicture();
  },
  unload() {
    localPokes.reset();
    localAuto = null;
    imagePlayer?.hide();
    localPacket = null;
  },
  poke() {
    const plan = localPokes.pokeLocal(localPacket.tuning);
    imagePlayer.poke(plan.special ? 1.6 : 1);
    return plan;
  },
  opaqueAt: (x, y) => !!imagePlayer?.opaqueAt(x, y),
  fit: () => { if (localPacket) fitPicture(); },
  expressions: () => localPacket ? localExpressions(localPacket.entry) : [],
  setAutoExpression(id) {
    localAuto = id;
    showPicture();
  },
  test: {
    metrics: () => ({
      key: localPacket ? localPacket.entry.id + ':local' : '', tempExpression: localPokes.temporaryExpression, auto: localAuto,
      picture: imagePlayer?.url ? { transform: imagePlayer.img.style.transform, tuning: imagePlayer.tuning, mirror: imagePlayer.mirror } : null
    })
  }
});

// ---------- Pokes by itself ----------
// Every packet.autoPoke seconds (0: never) the character is poked as if clicked in its middle, unless it is held.
let autoPokeSeconds = 0, autoPokeTimer = null;
function autoPoke() { if (!pointerDown) pokePet(); }
function scheduleAutoPoke(seconds) {
  if (seconds === autoPokeSeconds) return;
  autoPokeSeconds = seconds;
  clearInterval(autoPokeTimer);
  autoPokeTimer = seconds > 0 ? setInterval(autoPoke, seconds * 1000) : null;
}

// ---------- 滑鼠跟隨: the character leans toward the cursor, around its feet; the window stays put ----------
const LEAN_MAX = 8;   // degrees, at strength 100
let lean = 0, leanTarget = 0, leaning = false, cursors = 0;
function leanToward(cursor) {
  cursors++;
  const strength = lastPacket?.follow || 0;
  leanTarget = strength ? LEAN_MAX * strength / 100 * Math.tanh((cursor.x - innerWidth / 2) / Math.max(200, innerHeight)) : 0;
  startLeaning();
}
function startLeaning() {
  if (leaning || lean === leanTarget) return;
  leaning = true;
  requestAnimationFrame(stepLean);
}
function stepLean() {
  lean += (leanTarget - lean) * 0.12;
  if (Math.abs(leanTarget - lean) < 0.01) lean = leanTarget;
  document.body.style.transform = lean ? 'rotate(' + lean.toFixed(3) + 'deg)' : '';
  if (lean !== leanTarget) requestAnimationFrame(stepLean); else leaning = false;
}
// A point of the window as it is on the character before the lean (kinds work in the unleaned picture).
function unlean(x, y) {
  if (!lean) return { x, y };
  const px = innerWidth / 2, py = innerHeight, a = -lean * Math.PI / 180, dx = x - px, dy = y - py;
  return { x: px + dx * Math.cos(a) - dy * Math.sin(a), y: py + dx * Math.sin(a) + dy * Math.cos(a) };
}

// ---------- 互動音效: a poke's sound, and on every fifth poke the fifth's (if one is chosen) ----------
let pokeCount = 0, lastSound = '';
const soundURLs = new Map();
async function playPokeSound() {
  pokeCount++;
  const sounds = lastPacket?.sounds, name = sounds && (pokeCount % 5 === 0 && sounds.fifth ? sounds.fifth : sounds.poke);
  if (!name) return;
  lastSound = name;
  try {
    if (!soundURLs.has(name)) soundURLs.set(name, window.desktopAPI.soundData(name).then(sound => {
      if (!sound) throw new Error('missing');
      return URL.createObjectURL(new Blob([sound.data], { type: sound.mime }));
    }));
    const audio = new Audio(await soundURLs.get(name));
    audio.volume = (lastPacket?.volume ?? 70) / 100;
    await audio.play();
  } catch {
    soundURLs.delete(name);
  }
}

// ---------- 自動換表情 and 台詞 ----------
// Every packet.autoFace seconds the character shows another of its expressions (its kind's expressions() and
// setAutoExpression(); a kind without them keeps its look) until a poke brings back the chosen one. Lines
// (packet.lines, null when off) show in a bubble above the character: an automatic line with each such change, or
// every lines.seconds without them; a poke's line, and on every fifth poke the fifth's (the poke's if it has none).
let autoFaceSeconds = 0, autoFaceTimer = null, autoExpression = null, autoKey = '';
let autoLineSeconds = 0, autoLineTimer = null, lastLine = '';
function setAutoExpression(id) {
  autoExpression = id;
  activeKind?.setAutoExpression?.(id);
}
function changeFace() {
  if (pointerDown || petBusy || !activeKind) return;
  const ids = activeKind.expressions?.() || [], current = autoExpression || lastPacket?.selection?.expression || ids[0];
  const others = ids.filter(id => id !== current);
  if (others.length) setAutoExpression(others[Math.floor(Math.random() * others.length)]);
  say('auto');
}
function startAutoFace() {
  clearInterval(autoFaceTimer);
  autoFaceTimer = autoFaceSeconds > 0 ? setInterval(changeFace, autoFaceSeconds * 1000) : null;
}
function scheduleAuto(packet) {
  const face = Number(packet.autoFace) || 0, lineSeconds = !face && packet.lines?.auto.length ? packet.lines.seconds : 0;
  if (face !== autoFaceSeconds) { autoFaceSeconds = face; startAutoFace(); }
  if (lineSeconds !== autoLineSeconds) {
    autoLineSeconds = lineSeconds;
    clearInterval(autoLineTimer);
    autoLineTimer = lineSeconds ? setInterval(() => { if (!pointerDown) say('auto'); }, lineSeconds * 1000) : null;
  }
  // Another character or expression chosen, or no more changes: the chosen look again.
  const key = JSON.stringify([packet.entry.id, packet.selection]);
  if (autoExpression && (!face || key !== autoKey)) setAutoExpression(null);
  autoKey = key;
}

// A line at random from the list (not the same one twice in a row), where its place says (lines.place, fractions of
// the window) or else above the character's top: the first row, every 6 pixels, with something opaque, at its middle.
function say(list) {
  const lines = lastPacket?.lines;
  const pool = !lines ? [] : list === 'fifth' && lines.fifth.length ? lines.fifth : lines[list === 'fifth' ? 'poke' : list];
  if (!pool.length) return;
  const choices = pool.length > 1 ? pool.filter(line => line !== lastLine) : pool;
  lastLine = choices[Math.floor(Math.random() * choices.length)];
  const place = lines.place;
  window.desktopAPI.say(lastLine, place ? { x: Math.round(place.x * innerWidth), y: Math.round(place.y * innerHeight) } : characterTop());
}
function characterTop() {
  for (let y = 0; y < innerHeight; y += 6) {
    const xs = [];
    for (let x = 0; x < innerWidth; x += 8) if (opaqueAt(x, y)) xs.push(x);
    if (xs.length) return { x: Math.round((xs[0] + xs.at(-1)) / 2), y };
  }
  return { x: Math.round(innerWidth / 2), y: 0 };
}

// ---------- The character packet from the app ----------
// Packets arriving while one is loading wait; only the newest is kept.
async function applyPacket(packet) {
  packets++;
  if (!petReady || petBusy) { pendingPacket = packet; return; }
  petBusy = true;
  try {
    const kind = kindOf(packet?.entry);
    if (activeKind && activeKind !== kind) activeKind.unload();
    activeKind = kind;
    lastPacket = packet;
    if (!kind) return;
    await kind.apply(packet);
    scheduleAutoPoke(Number(packet.autoPoke) || 0);
    scheduleAuto(packet);
    // Following stopped: back upright.
    if (!packet.follow) { leanTarget = 0; startLeaning(); }
    document.title = '角色桌面 · ' + packet.entry.name;
  } catch (error) {
    CharacterDesktop.error(error.message || error);
  } finally {
    petBusy = false;
    if (pendingPacket) { const next = pendingPacket; pendingPacket = null; applyPacket(next); }
  }
}

// ---------- Pointer: hover, poke and drag ----------
let lastPointer = null, pointerDown = null;
const opaqueAt = (x, y) => { const point = unlean(x, y); return !!activeKind?.opaqueAt(point.x, point.y); };

// Tells the app whether to take mouse input (pointer over the character) or let it pass through; moved: the mouse
// really moved here (the app revives a window that stops hearing it).
function updateHit(moved = false) {
  if (pointerDown) { if (moved) window.desktopAPI.hit(true, true); return; }
  window.desktopAPI.hit(!!lastPointer && opaqueAt(lastPointer.x, lastPointer.y), moved);
}

// A poke brings back the chosen expression at once (an automatic change waits a whole interval again).
function pokePet(point) {
  if (petBusy || !activeKind || !lastPacket?.entry) return;
  if (autoExpression) setAutoExpression(null);
  startAutoFace();
  lastPokePlan = activeKind.poke(point && unlean(point.x, point.y));
  playPokeSound();
  say(pokeCount % 5 === 0 ? 'fifth' : 'poke');
}

function listenToPointer() {
  window.addEventListener('mousemove', event => { lastPointer = { x: event.clientX, y: event.clientY }; updateHit(true); });
  window.addEventListener('mouseleave', () => { if (!pointerDown) { lastPointer = null; window.desktopAPI.hit(false); } });
  // The character moves under a still pointer too (breathing, poses), so the answer is checked again regularly.
  setInterval(() => { if (lastPointer) updateHit(); }, 100);
  window.addEventListener('contextmenu', event => {
    event.preventDefault();
    if (opaqueAt(event.clientX, event.clientY)) window.desktopAPI.openSettings();
  });
  // A left press on the character becomes a drag after 5 px of movement, otherwise a poke.
  // A locked character does not move, and a press that moved is not a poke either.
  window.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !opaqueAt(event.clientX, event.clientY)) return;
    pointerDown = { x: event.screenX, y: event.screenY, clientX: event.clientX, clientY: event.clientY, moved: false, dragging: false };
    event.target.setPointerCapture(event.pointerId);
    window.desktopAPI.hit(true);
  });
  // While dragging, every move (one a displayed frame) goes to the app, which moves the window with it.
  window.addEventListener('pointermove', event => {
    if (pointerDown?.dragging) { window.desktopAPI.dragTo(event.screenX, event.screenY); return; }
    if (!pointerDown || pointerDown.moved) return;
    if (Math.hypot(event.screenX - pointerDown.x, event.screenY - pointerDown.y) > 5) {
      pointerDown.moved = true;
      if (lastPacket?.locked) return;
      pointerDown.dragging = true;
      window.desktopAPI.dragStart(pointerDown.x, pointerDown.y);
      window.desktopAPI.dragTo(event.screenX, event.screenY);
    }
  });
  window.addEventListener('pointerup', () => {
    if (!pointerDown) return;
    const { moved, dragging, clientX, clientY } = pointerDown;
    pointerDown = null;
    if (dragging) window.desktopAPI.dragEnd(); else if (!moved) pokePet({ x: clientX, y: clientY });
    updateHit();
  });
  window.addEventListener('pointercancel', () => { pointerDown = null; window.desktopAPI.dragEnd(); updateHit(); });
}

// ---------- Start ----------
async function startPet() {
  await loadExtensionPages('pet');
  petReady = true;
  window.desktopAPI.onCharacter(applyPacket);
  window.desktopAPI.onCursor(leanToward);
  window.desktopAPI.petReady();
  listenToPointer();
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => activeKind?.fit(), 100);
  });
  // Test hooks used by the self-tests; a kind adds its own metrics.
  window.desktopTest = {
    getMetrics: () => ({ busy: petBusy, lastPlan: lastPokePlan, packets, follow: lastPacket?.follow || 0, sounds: lastPacket?.sounds || null, cursors, leanTarget, lastSound, pokeCount,
      autoFace: autoFaceSeconds, autoLines: autoLineSeconds, autoExpression, lines: lastPacket?.lines || null, lastLine, ...activeKind?.test?.metrics?.() }),
    leanToward,
    changeFace,
    sayAuto: () => say('auto'),
    characterTop,
    poke: point => pokePet(point),
    autoPoke: () => ({ seconds: autoPokeSeconds, armed: !!autoPokeTimer }),
    autoPokeNow: () => autoPoke(),
    opaqueAt,
    kind: id => characterKinds.get(id)?.test
  };
}

startPet().catch(error => CharacterDesktop.error(error.message || error));
