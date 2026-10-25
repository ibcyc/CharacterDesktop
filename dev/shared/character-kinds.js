// Character kinds: who shows a character in the preview and on the desktop. The app brings the kind 'local' (the
// user's pictures); an extension registers its own kind under its id from its page scripts, which run in the page
// (loadExtensionPages). The settings page and the desktop page each expose a `CharacterDesktop` object with what a
// kind may use (settings/preview.js, app/pet.js): on the settings page also the characters in the list (with their
// labels, and whether one is local), a question
// in the page's style (confirm), refresh() after its extension changed characters, dockPanel() for a round button
// it adds above the download button (its markup's "dock" slot), and for a tool (settings/tool-host.js) closeTool(),
// panZoom(), saveFile() and addPicture().
//
// A kind on the settings page:
//   label(entry)                    the name in menus and the layer list (optional; the plain name otherwise)
//   tuning: true                    its characters are pictures shown by CharacterDesktop.imagePlayer(), with 細部調整
//                                   and the page's mirror switch (other kinds place their own)
//                                   (CharacterDesktop.tuning() is the character's; the panel lists its expressions)
//   load(entry, start)              show the character in the preview; start = { look, expression, mirror, options }.
//                                   It fills the expression menu with CharacterDesktop.setExpressions.
//   unload()                        another character, of another kind, takes the preview
//   showExpression(id)              the expression menu changed
//   previewExpression(id | null)    show an expression only for now (hovered in an open expression menu); null: the
//                                   chosen one again (optional; without it hovering shows nothing)
//   poke(event) -> plan             a left click on the preview
//   base() -> { scale, x, y }       where the preview rests; setTransform(scale, x, y) applies zoom and pan
//   look() -> look | null           what to keep for the character (its costume, …)
//   setMirror(on)
//   sync(entry)                     show its own controls for this entry (of any kind), hide them otherwise
//   test                            hooks for the self-tests (optional)
// A kind on the desktop page:
//   apply(packet)                   show or update the character; packet = { entry, selection, options, mirror, tuning }
//                                   (pictures: CharacterDesktop.imagePlayer() and CharacterDesktop.fitPicture())
//   unload(), poke(point) -> plan, opaqueAt(x, y), fit()   (fit: the window was resized), test (optional)
//   expressions() -> ids            the expressions it can show, for 自動換表情 (optional, with setAutoExpression)
//   setAutoExpression(id | null)    show this expression instead of the chosen one (a poke's still comes first);
//                                   null: the chosen one again

const characterKinds = new Map();
function registerCharacterKind(id, kind) { characterKinds.set(id, kind); }
function kindOf(entry) { return entry ? characterKinds.get(isLocal(entry) ? 'local' : entry.extension) || null : null; }
function characterLabel(entry) { return kindOf(entry)?.label?.(entry) ?? entry.name; }

// The parts of this page that extensions bring: their text in the app's language (shared/i18n.js), their styles, their
// markup (into the page's data-slot elements) and their scripts, run in that order.
async function loadExtensionPages(page) {
  for (const part of await window.desktopAPI.extensionPages(page)) {
    translator.add(part.strings);
    for (const css of part.styles) {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
    }
    for (const [slot, html] of Object.entries(part.html)) document.querySelector('[data-slot="' + slot + '"]')?.insertAdjacentHTML('beforeend', html);
    for (const code of part.scripts) {
      const script = document.createElement('script');
      script.textContent = code;
      document.head.appendChild(script);
    }
  }
}
