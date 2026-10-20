// 細部調整 (characters that are pictures: local ones and those of an extension's kind with tuning: true; under the
// expression menu): how strongly and how often the picture breathes, how strongly it bounces when poked, and the
// expressions shown by a poke and by every fifth poke (those of the expression menu).
// Kept per character by the app; 重設 restores the defaults.
// The switch only shows or hides the controls.

let tuningDefaults = {};
const TUNING_SLIDERS = { breath: value => value + '%', rate: value => value + ' 次/分', bounce: value => value + '%' };

function tuningOf(id) { return { ...tuningDefaults, ...(profiles[id]?.tuning || {}) }; }

function fillTuningMenu(select, value) {
  select.replaceChildren();
  makeOption(select, '', '不變');
  for (const option of $('expression').options) makeOption(select, option.value, option.textContent);
  select.value = [...select.options].some(option => option.value === value) ? value : '';
}

function syncTuningControls() {
  const pictures = !!currentEntry() && kindOf(currentEntry())?.tuning === true;
  $('tuning-field').hidden = !pictures;
  $('tuning-options').hidden = !pictures || !$('tuning-toggle').checked;
  if (!pictures) return;
  const tuning = tuningOf(activeId);
  for (const [key, label] of Object.entries(TUNING_SLIDERS)) {
    $('tuning-' + key).value = tuning[key];
    $('tuning-' + key + '-label').textContent = label(tuning[key]);
  }
  fillTuningMenu($('tuning-poke'), tuning.pokeFace);
  fillTuningMenu($('tuning-fifth'), tuning.fifthFace);
  // With a single picture there is no expression to choose.
  $('tuning-poke-field').hidden = $('tuning-fifth-field').hidden = $('expression').options.length < 2;
}

// A change shows in the preview at once and goes to the app, which keeps it and tells the desktop character.
let sendTuning = null;
function changeTuning(change) {
  const tuning = { ...tuningOf(activeId), ...change };
  profileOf(activeId).tuning = tuning;
  picturePlayer().setTuning(tuning);
  for (const [key, label] of Object.entries(TUNING_SLIDERS)) $('tuning-' + key + '-label').textContent = label(tuning[key]);
  sendTuning({ id: activeId, tuning });
}

function setUpTuningPanel(state) {
  tuningDefaults = state.tuning.defaults;
  for (const [key, [min, max]] of Object.entries(state.tuning.limits)) Object.assign($('tuning-' + key), { min, max });
  sendTuning = latestOnly(({ id, tuning }) => window.desktopAPI.setTuning(id, tuning));
  for (const key of Object.keys(TUNING_SLIDERS)) $('tuning-' + key).oninput = event => changeTuning({ [key]: Number(event.target.value) });
  $('tuning-poke').onchange = event => changeTuning({ pokeFace: event.target.value });
  $('tuning-fifth').onchange = event => changeTuning({ fifthFace: event.target.value });
  $('tuning-toggle').onchange = syncTuningControls;
}
