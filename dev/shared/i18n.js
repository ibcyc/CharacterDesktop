// UI languages. The UI is written in Traditional Chinese, in the code; another language is a table from the Chinese
// text to its own: shared/strings-en.js for the app, and an extension's strings/<language>.json for its own text.
// On a page, every text and title is translated as it appears (translatePage watches the page), so the code keeps
// writing Chinese; the app's own process translates only what it shows itself (the tray, its file dialogs).
//
// A key may hold parts that vary: {} any text, {#} a number. The translation takes them in order ({}, {#}) or by
// position ({1}, {2}…). What a part holds is translated as well (a message within a message), item by item when it is
// a list ('、'), and Chinese punctuation left in it becomes the language's own. Text is translated line by line.
// The same Chinese can mean different things: 'context|text' keys apply inside an element with
// data-i18n-context="context" (and its children), before plain ones.

const LANGUAGES = [{ id: 'zh-Hant', name: '繁體中文' }, { id: 'en', name: 'English' }];
const DEFAULT_LANGUAGE = 'zh-Hant';
const languageId = value => LANGUAGES.some(language => language.id === value) ? value : '';
const CJK = /[　-〿一-鿿＀-￯]/;

function createTranslator() {
  const exact = new Map(), patterns = [];
  let punctuation = [];
  const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // table: { key: translation }; a table may also bring the punctuation its language uses ({ '「': '"', … }).
  function add(table, marks) {
    if (marks) punctuation = Object.entries(marks);
    for (const [key, value] of Object.entries(table || {})) {
      if (typeof key !== 'string' || typeof value !== 'string' || !value) continue;
      if (!/\{#?\}/.test(key)) { exact.set(key, value); continue; }
      const [context, text] = key.includes('|') ? [key.slice(0, key.indexOf('|')), key.slice(key.indexOf('|') + 1)] : ['', key];
      const source = text.split(/(\{#?\})/).map(part => part === '{}' ? '(.+?)' : part === '{#}' ? '(\\d+)' : escape(part)).join('');
      // The most literal text first: '{}（不是有效的圖片）' before '{}（{}）'.
      patterns.push({ context, regex: new RegExp('^' + source + '$', 's'), value, weight: text.replace(/\{#?\}/g, '').length });
      patterns.sort((a, b) => b.weight - a.weight);
    }
  }

  const marksOf = text => punctuation.reduce((result, [mark, own]) => result.split(mark).join(own), text);
  // A part of a pattern: itself translated, or each item of a list, or at least its punctuation.
  function part(text, context) {
    if (!CJK.test(text)) return text;
    const known = line(text, context, false);
    if (known !== text) return known;
    if (text.includes('、')) return text.split('、').map(item => part(item, context)).join(marksOf('、'));
    const whole = line(text, context);
    return whole !== text ? whole : marksOf(text);
  }
  function line(text, context = '', withPatterns = true) {
    const core = text.trim();
    if (!core || !CJK.test(core)) return text;
    let result = (context ? exact.get(context + '|' + core) : undefined) ?? exact.get(core);
    for (const { context: own, regex, value } of result === undefined && withPatterns ? patterns : []) {
      if (own && own !== context) continue;
      const match = regex.exec(core);
      if (!match) continue;
      const parts = match.slice(1).map(value => part(value, context));
      let next = 0;
      result = value.replace(/\{(\d*)#?\}/g, (_, position) => parts[position ? Number(position) - 1 : next++] ?? '');
      break;
    }
    if (result === undefined) return text;
    const start = text.indexOf(core);
    return text.slice(0, start) + result + text.slice(start + core.length);
  }
  const translate = (text, context = '') => typeof text === 'string' && CJK.test(text) ? text.split('\n').map(item => line(item, context)).join('\n') : text;
  return { add, translate, get empty() { return !exact.size && !patterns.length; } };
}

// Translates the page now and whatever appears on it later: text, and the titles, labels and placeholders shown.
// Nothing inside translate="no" (names and lines the user wrote) is touched.
const TRANSLATED_ATTRIBUTES = ['title', 'aria-label', 'placeholder', 'alt'];
function translatePage(translator) {
  if (translator.empty) return;
  const contextOf = element => element?.closest('[data-i18n-context]')?.dataset.i18nContext || '';
  const kept = element => !element || !!element.closest('[translate="no"], script, style');
  function text(node) {
    if (kept(node.parentElement)) return;
    const next = translator.translate(node.nodeValue, contextOf(node.parentElement));
    if (next !== node.nodeValue) node.nodeValue = next;
  }
  function attributes(element, names = TRANSLATED_ATTRIBUTES) {
    if (kept(element)) return;
    for (const name of names) {
      const value = element.getAttribute(name);
      if (!value) continue;
      const next = translator.translate(value, contextOf(element));
      if (next !== value) element.setAttribute(name, next);
    }
  }
  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) return text(node);
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    attributes(node);
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (walker.currentNode.nodeType === Node.TEXT_NODE) text(walker.currentNode); else attributes(walker.currentNode);
    }
  }
  walk(document.documentElement);
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'childList') record.addedNodes.forEach(walk);
      else if (record.type === 'characterData') text(record.target);
      else attributes(record.target, [record.attributeName]);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: TRANSLATED_ATTRIBUTES });
}

// A page (the settings or a desktop character) starts in the app's language, which its preload gives; extensions add
// their own tables as they load (loadExtensionPages).
const translator = createTranslator();
if (typeof document === 'object') {
  const language = languageId(window.desktopAPI?.language) || DEFAULT_LANGUAGE;
  document.documentElement.lang = language;
  if (language === 'en') translator.add(STRINGS_EN, PUNCTUATION_EN);
  translatePage(translator);
}

if (typeof module === 'object') module.exports = { LANGUAGES, DEFAULT_LANGUAGE, languageId, createTranslator };
