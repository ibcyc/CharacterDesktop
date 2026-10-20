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
// The picture of the expression on show (a poke's temporary one or the chosen one), fitted into the window.
let localPacket = null;
const localPokes = createPokeSession(() => showPicture());

async function showPicture() {
  if (!localPacket) return;
  try {
    await picturePlayer().show(await localImageURL(localPacket.entry, localPokes.temporaryExpression || localPacket.selection.expression));
    fitPicture();
  } catch (error) {
    CharacterDesktop.error(error.message || error);
  }
}

registerCharacterKind('local', {
  async apply(packet) {
    picturePlayer();
    if (packet.entry.id !== localPacket?.entry.id) localPokes.reset();
    localPacket = packet;
    imagePlayer.setTuning(packet.tuning);
    imagePlayer.setMirror(packet.mirror);
    await showPicture();
  },
  unload() {
    localPokes.reset();
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
  test: {
    metrics: () => ({
      key: localPacket ? localPacket.entry.id + ':local' : '', tempExpression: localPokes.temporaryExpression,
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
const opaqueAt = (x, y) => !!activeKind?.opaqueAt(x, y);

// Tells the app whether to take mouse input (pointer over the character) or let it pass through.
function updateHit() {
  if (pointerDown) return;
  window.desktopAPI.hit(!!lastPointer && opaqueAt(lastPointer.x, lastPointer.y));
}

function pokePet(point) {
  if (petBusy || !activeKind || !lastPacket?.entry) return;
  lastPokePlan = activeKind.poke(point);
}

function listenToPointer() {
  window.addEventListener('mousemove', event => { lastPointer = { x: event.clientX, y: event.clientY }; updateHit(); });
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
  window.desktopAPI.petReady();
  listenToPointer();
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => activeKind?.fit(), 100);
  });
  // Test hooks used by the self-tests; a kind adds its own metrics.
  window.desktopTest = {
    getMetrics: () => ({ busy: petBusy, lastPlan: lastPokePlan, packets, ...activeKind?.test?.metrics?.() }),
    poke: point => pokePet(point),
    autoPoke: () => ({ seconds: autoPokeSeconds, armed: !!autoPokeTimer }),
    autoPokeNow: () => autoPoke(),
    opaqueAt,
    kind: id => characterKinds.get(id)?.test
  };
}

startPet().catch(error => CharacterDesktop.error(error.message || error));
