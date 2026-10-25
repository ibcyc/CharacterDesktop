// 滑鼠跟隨, 互動音效, 自動換表情 and 台詞, for every character (under 細部調整, or under an extension's own controls): on
// the desktop the character leans toward the cursor (its strength; the window stays put), sounds from the sound
// library (sounds-panel.js) play when it is poked, and on every fifth poke; every few seconds it shows another of its
// expressions for a while; and it says lines in a bubble (edited in their own window, below). The app keeps them per
// character and look (like the height), each part with its switch: off keeps what was set. It sends the look's
// settings with the desktop options (showInteraction). Out with a group a character neither follows nor speaks.

let soundNames = [];   // the sound library, as the sounds panel last read it
let interaction = null;   // { id, look, follow, sounds, autoFace, lines } of the character being edited, as app/profiles.cjs keeps them
const LINE_LENGTH = 60, LINE_COUNT = 30, PLACE_TOP = -0.35;
const LINE_LISTS = ['auto', 'poke', 'fifth'];
// The settings of the character being edited (null until the app sent them).
const currentInteraction = () => interaction?.id === activeId ? interaction : null;
// While changes are on their way, the page's own state stands (the last reply shows it again, settleSlider).
function showInteraction(value) {
  if (sliderSends && value?.id === interaction?.id) return;
  interaction = value;
  syncInteraction();
}

function fillSoundMenu(select, value) {
  select.replaceChildren();
  makeOption(select, '', '無');
  for (const name of soundNames) makeOption(select, name, name.replace(/\.[^.]+$/, ''));
  select.value = soundNames.includes(value) ? value : '';
}

const secondsLabel = seconds => seconds + ' 秒';
const lineCount = lines => LINE_LISTS.reduce((sum, list) => sum + (lines?.[list]?.length || 0), 0);

function syncInteraction() {
  const now = currentInteraction(), has = !!now;
  $('follow-field').hidden = $('sound-field').hidden = $('lines-field').hidden = !has;
  if (!has) {
    for (const id of ['follow-strength-field', 'sound-options', 'autoface-field', 'autoface-seconds-field', 'lines-edit-field']) $(id).hidden = true;
    return;
  }
  const { follow, sounds, autoFace, lines } = now;
  $('follow-toggle').checked = follow.on;
  $('follow-strength-field').hidden = !follow.on;
  if (slidingId !== 'follow-strength') {
    $('follow-strength').value = follow.strength;
    $('follow-strength-label').textContent = follow.strength + '%';
  }
  $('sound-toggle').checked = sounds.on;
  $('sound-options').hidden = !sounds.on;
  $('sound-empty').hidden = soundNames.length > 0;
  fillSoundMenu($('sound-poke'), sounds.poke);
  fillSoundMenu($('sound-fifth'), sounds.fifth);
  // Changing expressions needs two at least.
  $('autoface-field').hidden = $('expression').options.length < 2;
  $('autoface-toggle').checked = autoFace.on;
  $('autoface-seconds-field').hidden = $('autoface-field').hidden || !autoFace.on;
  if (slidingId !== 'autoface-seconds') {
    $('autoface-seconds').value = autoFace.seconds;
    $('autoface-seconds-label').textContent = secondsLabel(autoFace.seconds);
  }
  $('lines-toggle').checked = lines.on;
  $('lines-edit-field').hidden = !lines.on;
  const count = lineCount(lines);
  $('lines-edit').textContent = '編輯台詞' + (count ? '（' + count + ' 句）' : '');
}

// A change to one part ({ follow: { on: true } }, …) is shown at once and goes to the app, which keeps it for the look
// and tells the desktop character.
let sendInteraction = null;
function changeInteraction(change) {
  const now = currentInteraction();
  if (!now) return;
  for (const [part, value] of Object.entries(change)) now[part] = { ...now[part], ...value };
  sendInteraction({ id: activeId, value: structuredClone(now) });
  syncInteraction();
}

// ---------- A poke in the preview ----------
// It plays the character's sounds and says its lines too, as on the desktop; the count starts again for another
// character.
let previewPokes = { id: null, count: 0 }, lastPreviewSound = '', lastPreviewLine = '', previewBubbleTimer = null;
function reactToPreviewPoke() {
  if (previewPokes.id !== activeId) previewPokes = { id: activeId, count: 0 };
  const count = ++previewPokes.count, fifth = count % 5 === 0, now = currentInteraction();
  const sounds = now?.sounds.on ? now.sounds : null, sound = sounds && (fifth && sounds.fifth ? sounds.fifth : sounds.poke);
  if (sound) {
    lastPreviewSound = (fifth ? 'fifth:' : '') + sound;
    playSound(sound);
  }
  const lines = now?.lines.on ? now.lines : null;
  const pool = !lines ? [] : fifth && lines.fifth.length ? lines.fifth : lines.poke;
  if (!pool.length) return;
  const choices = pool.length > 1 ? pool.filter(line => line !== lastPreviewLine) : pool;
  lastPreviewLine = choices[Math.floor(Math.random() * choices.length)];
  const bubble = $('preview-bubble');
  bubble.textContent = lastPreviewLine;
  bubble.hidden = false;
  bubble.classList.remove('on');
  requestAnimationFrame(() => bubble.classList.add('on'));
  clearTimeout(previewBubbleTimer);
  previewBubbleTimer = setTimeout(() => {
    bubble.classList.remove('on');
    previewBubbleTimer = setTimeout(() => { bubble.hidden = true; }, 250);
  }, Math.min(7000, 2200 + lastPreviewLine.length * 90));
}

// ---------- The lines window ----------
// Three lists of lines (自動說的, 戳的時候, 戳第 5 下), each line a field with ✕; ＋ adds one, Enter in a line adds one
// below it. Automatic lines come with each 自動換表情, or without it every few seconds (the slider). Below them,
// 氣泡位置. 儲存 keeps it all (empty lines dropped), 取消 or Esc leaves them as they were.
const REMOVE_LINE = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>';
let linesBefore = null;

function lineRow(list, text = '', after = null) {
  const row = document.createElement('div'), input = document.createElement('input'), remove = document.createElement('button');
  row.className = 'line-row';
  input.type = 'text';
  input.maxLength = LINE_LENGTH;
  input.spellcheck = false;
  input.value = text;
  input.setAttribute('aria-label', '台詞');
  input.onkeydown = event => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    addLine(list, row);
  };
  remove.type = 'button';
  remove.className = 'icon-button';
  remove.innerHTML = REMOVE_LINE;
  remove.title = remove.ariaLabel = '刪除這句';
  remove.onclick = () => { row.remove(); syncLineButtons(); };
  row.append(input, remove);
  const box = linesBox(list);
  if (after) after.after(row); else box.append(row);
  return row;
}
const linesBox = list => document.querySelector('#lines-dialog [data-list="' + list + '"] .lines-list');
function addLine(list, after = null) {
  if (linesBox(list).children.length >= LINE_COUNT) return;
  lineRow(list, '', after).querySelector('input').focus();
  syncLineButtons();
}
function syncLineButtons() {
  for (const list of LINE_LISTS) document.querySelector('#lines-dialog [data-list="' + list + '"] .lines-add').hidden = linesBox(list).children.length >= LINE_COUNT;
}
const linesOnPage = () => Object.fromEntries(LINE_LISTS.map(list => [list, [...linesBox(list).querySelectorAll('input')].map(input => input.value.replace(/\s+/g, ' ').trim()).filter(Boolean)]));

// ---------- 氣泡位置 ----------
// The character's desktop window as it is now (a picture the app takes; dashed), with room above it, at a scale that
// fits; the bubble at the same scale. Pressing or dragging in it moves where the bubble's tail points (fractions of
// the window); 自動 goes back to the top of the character. Shown only while the character is on the desktop.
let bubbleStage = null, linesPlace = null;   // { width, height, image, top } from the app; the place being edited

function stageFrame() {
  const stage = $('bubble-stage'), { width, height } = bubbleStage;
  const scale = Math.min(stage.clientHeight / ((1 - PLACE_TOP) * height), stage.clientWidth / width);
  return { scale, left: (stage.clientWidth - width * scale) / 2, top: -PLACE_TOP * height * scale, width: width * scale, height: height * scale };
}
function drawBubblePlace() {
  $('bubble-place-auto').hidden = !linesPlace;
  if (!bubbleStage || $('bubble-stage').hidden) return;
  const frame = stageFrame(), image = $('bubble-stage-image'), sample = $('bubble-sample');
  Object.assign(image.style, { left: frame.left + 'px', top: frame.top + 'px', width: frame.width + 'px', height: frame.height + 'px' });
  const tip = linesPlace ? { x: linesPlace.x * bubbleStage.width, y: linesPlace.y * bubbleStage.height } : bubbleStage.top || { x: bubbleStage.width / 2, y: 0 };
  sample.style.left = frame.left + tip.x * frame.scale + 'px';
  sample.style.top = frame.top + tip.y * frame.scale + 'px';
  sample.style.transform = 'translate(-50%, -100%) scale(' + frame.scale + ')';
  sample.classList.toggle('auto', !linesPlace);
}
// From the window's rectangle as drawn, so it holds while the card still grows in (motion.js).
function placeAt(event) {
  const drawn = $('bubble-stage-image').getBoundingClientRect();
  const x = (event.clientX - drawn.left) / drawn.width, y = (event.clientY - drawn.top) / drawn.height;
  linesPlace = { x: Math.round(Math.min(1, Math.max(0, x)) * 1000) / 1000, y: Math.round(Math.min(1, Math.max(PLACE_TOP, y)) * 1000) / 1000 };
  drawBubblePlace();
}
async function showBubbleStage(lines) {
  linesPlace = lines.place;
  bubbleStage = null;
  $('bubble-stage').hidden = $('bubble-place-note').hidden = true;
  $('bubble-sample-text').textContent = LINE_LISTS.map(list => lines[list][0]).find(Boolean) || '台詞';
  drawBubblePlace();
  const id = activeId, stage = await window.desktopAPI.bubbleStage(id);
  if (!stage || id !== activeId || $('lines-dialog').hidden) return;
  bubbleStage = stage;
  if (stage.image) $('bubble-stage-image').src = stage.image; else $('bubble-stage-image').removeAttribute('src');
  $('bubble-stage').hidden = $('bubble-place-note').hidden = false;
  drawBubblePlace();
}

function openLines() {
  const now = currentInteraction();
  if (!now) return;
  const lines = now.lines;
  linesBefore = document.activeElement;
  $('lines-character').textContent = characterLabel(currentEntry());
  for (const list of LINE_LISTS) {
    linesBox(list).replaceChildren();
    for (const line of lines[list].length ? lines[list] : ['']) lineRow(list, line);
  }
  // With 自動換表情 the automatic lines come with each change; otherwise on their own.
  $('lines-auto-note').hidden = !now.autoFace.on;
  $('lines-seconds-field').hidden = now.autoFace.on;
  $('lines-seconds').value = lines.seconds;
  $('lines-seconds-label').textContent = secondsLabel(lines.seconds);
  syncLineButtons();
  $('lines-dialog').hidden = false;
  showBubbleStage(lines);
  $('lines-dialog').querySelector('.lines-scroll').scrollTop = 0;
  document.addEventListener('keydown', onLinesKey, true);
  linesBox('auto').querySelector('input')?.focus();
}
function closeLines(save) {
  if ($('lines-dialog').hidden) return;
  if (save) changeInteraction({ lines: { ...linesOnPage(), seconds: Number($('lines-seconds').value), place: linesPlace } });
  $('lines-dialog').hidden = true;
  document.removeEventListener('keydown', onLinesKey, true);
  linesBefore?.focus?.({ preventScroll: true });
}
function onLinesKey(event) {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  closeLines(false);
}

function setUpInteraction() {
  sendInteraction = latestOnly(({ id, value }) => window.desktopAPI.setInteraction(id, value));
  $('follow-toggle').onchange = () => changeInteraction({ follow: { on: $('follow-toggle').checked } });
  $('follow-strength').oninput = () => {
    $('follow-strength-label').textContent = $('follow-strength').value + '%';
    changeInteraction({ follow: { strength: Number($('follow-strength').value) } });
  };
  $('sound-toggle').onchange = () => changeInteraction({ sounds: { on: $('sound-toggle').checked } });
  $('sound-poke').onchange = () => changeInteraction({ sounds: { poke: $('sound-poke').value } });
  $('sound-fifth').onchange = () => changeInteraction({ sounds: { fifth: $('sound-fifth').value } });
  $('autoface-toggle').onchange = () => changeInteraction({ autoFace: { on: $('autoface-toggle').checked } });
  $('autoface-seconds').oninput = () => {
    $('autoface-seconds-label').textContent = secondsLabel($('autoface-seconds').value);
    changeInteraction({ autoFace: { seconds: Number($('autoface-seconds').value) } });
  };
  // A slider being dragged is not moved by the app's replies (slidingId, desktop-panel.js).
  for (const id of ['follow-strength', 'autoface-seconds']) $(id).addEventListener('pointerdown', () => { slidingId = id; });
  $('lines-toggle').onchange = () => changeInteraction({ lines: { on: $('lines-toggle').checked } });
  $('lines-edit').onclick = openLines;
  for (const list of LINE_LISTS) document.querySelector('#lines-dialog [data-list="' + list + '"] .lines-add').onclick = () => addLine(list);
  $('lines-seconds').oninput = () => { $('lines-seconds-label').textContent = secondsLabel($('lines-seconds').value); };
  $('bubble-stage').onpointerdown = event => {
    if (event.button !== 0 || !bubbleStage) return;
    try { $('bubble-stage').setPointerCapture(event.pointerId); } catch {}
    placeAt(event);
  };
  $('bubble-stage').onpointermove = event => { if (event.buttons & 1 && bubbleStage) placeAt(event); };
  $('bubble-place-auto').onclick = () => { linesPlace = null; drawBubblePlace(); };
  $('lines-cancel').onclick = () => closeLines(false);
  $('lines-save').onclick = () => closeLines(true);
}
