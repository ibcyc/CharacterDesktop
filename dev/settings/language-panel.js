// 語言 (設定 in the app menu; its popup opens where UI 設定's does): the UI language, each named in its own language.
// Choosing one keeps it, and the page starts again in it (shared/i18n.js translates the page). At the first start the
// page asks, in both languages, before anything else.

function setLanguageOpen(open) {
  $('language-panel').hidden = !open;
  $('language-toggle').setAttribute('aria-expanded', String(open));
  // Like UI 設定, it replaces the 設定 submenu it was chosen from.
  if (open) { setSettingsMenuOpen(false); setUiOpen(false); }
}

let languageChoices = [];
async function askLanguage() {
  const answer = await askDialog({ title: 'Language · 語言', message: '請選擇語言\nChoose a language', buttons: languageChoices.map(({ id, name }) => ({ label: name, value: id })) });
  return window.desktopAPI.setLanguage(answer.value);
}

function setUpLanguage(state) {
  const { current, choices, ask } = state.language;
  languageChoices = choices;
  $('language-choices').replaceChildren(...choices.map(({ id, name }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = name;
    button.dataset.language = id;
    button.className = id === current ? 'primary' : '';
    button.setAttribute('aria-pressed', String(id === current));
    button.onclick = () => window.desktopAPI.setLanguage(id);
    return button;
  }));
  $('language-toggle').onclick = () => setLanguageOpen($('language-panel').hidden);
  window.addEventListener('keydown', event => { if (event.key === 'Escape') setLanguageOpen(false); });
  if (ask) askLanguage();
}
