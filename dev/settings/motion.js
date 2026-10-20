// Moderate UI motion for the settings window, using the bundled anime.js.
// Does nothing without it or when Windows asks for reduced motion. It only listens; nothing depends on it.
(() => {
  const anime = window.anime;
  if (!anime || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const { animate, stagger } = anime;

  // Entrance, the first time the window is actually visible (it is created hidden).
  // Only the controls move: the docks and status line are positioned with their own transforms.
  function intro() {
    animate('.stage', { opacity: { from: 0 }, duration: 600, ease: 'outQuad' });
    animate(['.panel-left>.field', '.panel-right>.field', '.visibility-dock>*', '.dock-row>.fab', '.app-dock-row .fab'], {
      opacity: { from: 0 }, translateY: { from: 14 }, delay: stagger(60, { start: 120 }), duration: 520, ease: 'outCubic'
    });
  }
  if (document.visibilityState === 'visible') intro();
  else document.addEventListener('visibilitychange', function once() {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', once);
    intro();
  });

  // The preview fades in after a character loads; opacity and blur leave its layout untouched. Both end values are
  // given, so a fade that starts while another is running still ends fully clear.
  const settle = () => animate(['#viewer-canvas', '#viewer-image'], { opacity: { from: 0.25, to: 1 }, filter: { from: 'blur(6px)', to: 'blur(0px)' }, duration: 420, ease: 'outQuad' });
  document.addEventListener('preview:loaded', settle);
  $('desktop-reset').addEventListener('click', settle);

  // Items added to a list marked .pop-in (an extension's thumbnails, for one) pop in one after another.
  new MutationObserver(records => {
    const added = records.filter(record => record.target.classList?.contains('pop-in')).flatMap(record => [...record.addedNodes]).filter(node => node.nodeType === 1);
    if (added.length) animate(added, { opacity: { from: 0 }, translateY: { from: 10 }, delay: stagger(35), duration: 320, ease: 'outCubic' });
  }).observe(document.body, { childList: true, subtree: true });

  // Springy press feedback on buttons.
  document.addEventListener('pointerdown', event => {
    const button = event.target.closest?.('button');
    if (button && !button.disabled && !button.closest('.pop-in')) animate(button, { scale: { from: 0.95, to: 1 }, duration: 380, ease: 'outBack(2.2)' });
  });

  // The saved groups rise out of their round button.
  new MutationObserver(() => {
    if (!$('groups-panel').hidden) animate('#groups-panel', { opacity: { from: 0 }, translateY: { from: 8 }, duration: 240, ease: 'outCubic' });
  }).observe($('groups-panel'), { attributes: true, attributeFilter: ['hidden'] });

  // The app menu's items (with a submenu or not) rise out of its round button, one after another.
  new MutationObserver(() => {
    if (!$('app-menu').hidden) animate([...$('app-menu').children].filter(item => !item.hidden), { opacity: { from: 0 }, translateY: { from: 10 }, delay: stagger(40, { reversed: true }), duration: 260, ease: 'outCubic' });
  }).observe($('app-menu'), { attributes: true, attributeFilter: ['hidden'] });

  // The menu's second level: a submenu's choices slide out of their item one after another (the nearest first); the
  // 來源 and UI 設定 popups grow in beside the menu.
  const second = new MutationObserver(records => {
    for (const { target } of records) {
      if (target.hidden) continue;
      if (target.classList.contains('submenu')) animate([...target.children].filter(item => !item.hidden), { opacity: { from: 0 }, translateX: { from: 10 }, delay: stagger(40, { reversed: true }), duration: 240, ease: 'outCubic' });
      else animate(target, { opacity: { from: 0 }, scale: { from: 0.96 }, translateX: { from: 8 }, duration: 240, ease: 'outCubic' });
    }
  });
  for (const element of document.querySelectorAll('#app-menu .submenu, #sources-panel, #ui-panel')) second.observe(element, { attributes: true, attributeFilter: ['hidden'] });

  // Into a tool and back (tool-host.js): the tool's editor, or the character page, comes in gently.
  let inTool = document.body.classList.contains('tool-mode');
  new MutationObserver(() => {
    if (document.body.classList.contains('tool-mode') === inTool) return;
    inTool = !inTool;
    if (inTool) {
      animate('#tool-host', { opacity: { from: 0 }, scale: { from: 0.985 }, duration: 280, ease: 'outCubic' });
      return;
    }
    animate('.stage', { opacity: { from: 0 }, duration: 320, ease: 'outQuad' });
    animate(['.panel-left>.field', '.panel-right>.field', '.visibility-dock>*', '.dock-row>.fab', '.app-dock-row .fab'], {
      opacity: { from: 0 }, translateY: { from: 8 }, delay: stagger(25), duration: 300, ease: 'outCubic'
    });
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // A question's card rises in over the dimmed page.
  new MutationObserver(() => {
    if (!$('dialog').hidden) {
      animate('#dialog', { opacity: { from: 0 }, duration: 180, ease: 'outQuad' });
      animate('#dialog .dialog', { opacity: { from: 0 }, scale: { from: 0.94 }, translateY: { from: 8 }, duration: 260, ease: 'outCubic' });
    }
  }).observe($('dialog'), { attributes: true, attributeFilter: ['hidden'] });

  // The dock's panels (download, file, an extension's) grow out of their round buttons.
  new MutationObserver(records => {
    for (const { target } of records) {
      if (target.classList.contains('download-panel') && !target.hidden) animate(target, { opacity: { from: 0 }, scale: { from: 0.94 }, translateX: { from: -8 }, duration: 260, ease: 'outCubic' });
    }
  }).observe(document.body, { attributes: true, attributeFilter: ['hidden'], subtree: true });

})();
