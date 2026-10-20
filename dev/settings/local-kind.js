// The kind 'local' on the settings page: the user's pictures, one per expression, shown by the picture player.
// Its own controls are rename (pencil) and the folder button (local-panel.js); like every kind of pictures it has
// 細部調整 (tuning-panel.js).

const localPokes = createPokeSession(() => showLocalPicture());
let localHovered = null;   // the expression hovered in the open expression menu

// The picture of the expression on show: one hovered in the menu, a poke's temporary one, or the one chosen.
function showLocalPicture() {
  const entry = currentEntry();
  if (!isLocal(entry)) return Promise.resolve();
  return localImageURL(entry, localHovered || localPokes.temporaryExpression || $('expression').value).then(url => picturePlayer().show(url)).catch(showError);
}

registerCharacterKind('local', {
  label: entry => '[L] ' + entry.name,
  tuning: true,
  async load(entry, start) {
    localPokes.reset();
    localHovered = null;
    picturePlayer().setTuning(tuningOf(entry.id));
    picturePlayer().setMirror(start.mirror);
    setExpressions(localExpressions(entry).map(id => ({ id, label: localExpressionLabel(id) })), start.expression || '0');
    await picturePlayer().show(await localImageURL(entry, $('expression').value));
  },
  unload() {
    localPokes.reset();
    localHovered = null;
    imagePlayer?.hide();
  },
  showExpression() { showLocalPicture(); },
  previewExpression(id) {
    localHovered = id;
    showLocalPicture();
  },
  poke() {
    const plan = localPokes.pokeLocal(tuningOf(activeId));
    imagePlayer.poke(plan.special ? 1.6 : 1);
    return plan;
  },
  base: pictureBase,
  setTransform(scale, x, y) {
    imagePlayer.setScale(scale);
    imagePlayer.setPosition(x, y);
  },
  look: () => null,
  setMirror(on) { imagePlayer?.setMirror(on); },
  sync(entry) {
    const local = isLocal(entry);
    $('character-rename').hidden = !local;
    $('character-rename').disabled = $('character').disabled;
    if (!local) $('rename-row').hidden = true;
    $('local-folder-field').hidden = !local;
  },
  test: { temporaryExpression: () => localPokes.temporaryExpression }
});
