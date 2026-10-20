// Expression menus: every menu that picks an expression (表情, the poke expressions of 細部調整, an extension's own)
// opens a list under its button instead of a native menu, which never tells the page where the mouse is. Hovering an
// item (or moving to it with ↑↓) shows that expression in the preview while the list is open, when the character's
// kind can (previewExpression); an item without an expression ('', such as 不變) shows the chosen one. Leaving the list
// or closing it shows the chosen expression again; nothing is sent to the app until an item is chosen.
// The <select> stays, hidden, as the menu's value for everything else (kinds, panels, self-tests): choosing works
// exactly like choosing in it. createExpressionMenu(select, { preview, decorate }) adds the button (<id>-button, its
// text <id>-current) and the list (<id>-list); extensions use it through CharacterDesktop.expressionMenu. The
// character menu uses it too, without previews (preview: false) and with a pin on each item (decorate(item, option)).

const HOVER_PREVIEW_MS = 60;   // an expression only passed over on the way to another is not loaded
const expressionMenus = [];

function createExpressionMenu(select, { preview: previews = true, decorate = null } = {}) {
  const id = select.id;
  const wrapper = document.createElement('div'), button = document.createElement('button'), current = document.createElement('span'), list = document.createElement('ul');
  wrapper.className = 'menu';
  wrapper.id = id + '-menu';
  button.type = 'button';
  button.className = 'menu-button';
  button.id = id + '-button';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', id + '-list');
  current.id = id + '-current';
  button.appendChild(current);
  list.className = 'menu-list';
  list.id = id + '-list';
  list.setAttribute('role', 'listbox');
  list.tabIndex = -1;
  list.hidden = true;
  // The menu's label now names the button; the list lives over the page (under <body>, fixed), so a panel's own
  // scrolling never cuts it off.
  const label = document.querySelector('label[for="' + id + '"]');
  if (label) {
    label.id ||= id + '-label';
    label.htmlFor = button.id;
    button.setAttribute('aria-labelledby', label.id + ' ' + current.id);
    list.setAttribute('aria-labelledby', label.id);
  }
  select.before(wrapper);
  wrapper.append(select, button);
  select.hidden = true;
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  document.body.appendChild(list);

  let index = -1, hoverTimer = null, hovered;
  const isOpen = () => !list.hidden;

  // Shows an item's expression in the preview for now ('' or null: the chosen one); a short pause skips items passed over.
  function hover(value) {
    if (!previews || hovered === value) return;
    hovered = value;
    clearTimeout(hoverTimer);
    if (value === undefined) activeKind?.previewExpression?.(null);
    else hoverTimer = setTimeout(() => activeKind?.previewExpression?.(value || null), HOVER_PREVIEW_MS);
  }

  function mark(next, { preview = true, scroll = false } = {}) {
    const items = [...list.children];
    if (!items.length) return;
    index = Math.max(0, Math.min(items.length - 1, next));
    items.forEach((item, i) => item.classList.toggle('active', i === index));
    const item = items[index];
    list.setAttribute('aria-activedescendant', item.id);
    // Only the list scrolls to show it (scrollIntoView would scroll the panel too).
    if (scroll && item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (scroll && item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
    if (preview) hover(item.dataset.value);
  }

  function place() {
    const box = button.getBoundingClientRect();
    list.style.left = box.left + 'px';
    list.style.top = box.bottom + 4 + 'px';
    // At least as wide as its button, wider when the names need it (not past the window's right edge).
    list.style.minWidth = box.width + 'px';
    list.style.width = 'max-content';
    list.style.maxWidth = Math.max(box.width, Math.min(420, innerWidth - box.left - 12)) + 'px';
    list.style.maxHeight = Math.max(120, Math.min(320, innerHeight - box.bottom - 16)) + 'px';
  }

  function render() {
    list.replaceChildren();
    [...select.options].forEach((option, i) => {
      const item = document.createElement('li'), label = document.createElement('span');
      item.id = id + '-option-' + i;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.selected));
      item.dataset.value = option.value;
      label.textContent = option.textContent;
      item.appendChild(label);
      decorate?.(item, option);
      item.addEventListener('pointerenter', () => mark(i));
      item.addEventListener('click', () => choose(option.value));
      list.appendChild(item);
    });
  }
  function open() {
    if (isOpen() || select.disabled || !select.options.length) return;
    for (const menu of expressionMenus) menu.close();
    render();
    place();
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    mark(select.selectedIndex, { preview: false, scroll: true });
    list.focus({ preventScroll: true });
  }

  function close() {
    if (!isOpen()) return;
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    hover(undefined);
  }

  // Choosing sets the menu first, so closing (which shows the chosen expression again) already shows the new one.
  function choose(value) {
    const changed = select.value !== value;
    select.value = value;
    close();
    if (changed) select.dispatchEvent(new Event('change'));
    button.focus();
  }

  // The button shows the chosen item, and is disabled with the menu.
  function sync() {
    current.textContent = select.selectedOptions[0]?.textContent ?? '';
    button.disabled = select.disabled;
    if (select.disabled) close();
  }

  button.onclick = () => (isOpen() ? close() : open());
  button.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open(); }
  });
  list.addEventListener('keydown', event => {
    const keys = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: list.children.length - 1 };
    if (event.key in keys) { event.preventDefault(); mark(keys[event.key], { scroll: true }); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(list.children[index].dataset.value); }
    else if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); close(); button.focus(); }
  });
  // Leaving the list shows the chosen expression again.
  list.addEventListener('pointerleave', () => hover(undefined));
  // The menu changes when a character or costume loads (new expressions), when an item is chosen, renamed or
  // pinned; an open list follows.
  new MutationObserver(() => {
    if (isOpen()) { render(); mark(Math.max(0, select.selectedIndex), { preview: false }); }
    sync();
  }).observe(select, { childList: true, subtree: true, characterData: true });
  new MutationObserver(sync).observe(select, { attributes: true, attributeFilter: ['disabled'] });
  select.addEventListener('change', sync);
  sync();
  const menu = { select, button, list, open, close, sync, contains: node => wrapper.contains(node) || list.contains(node) };
  expressionMenus.push(menu);
  return menu;
}

// A press anywhere else, resizing or scrolling a panel closes the open list.
document.addEventListener('pointerdown', event => {
  for (const menu of expressionMenus) if (!menu.contains(event.target)) menu.close();
}, true);
window.addEventListener('resize', () => { for (const menu of expressionMenus) menu.close(); });
document.addEventListener('scroll', event => {
  if (event.target.closest?.('.panel')) for (const menu of expressionMenus) menu.close();
}, true);

function setUpExpressionMenus() {
  for (const id of ['expression', 'tuning-poke', 'tuning-fifth']) createExpressionMenu($(id));
}
