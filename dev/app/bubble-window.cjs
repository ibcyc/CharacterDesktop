// A speech bubble (台詞) above a desktop character: a small window of its own, transparent and click-through, that
// moves with the character and fades after a moment (longer for a longer line).
const { BrowserWindow, screen } = require('electron');

const WIDTH = 300, HEIGHT = 170;   // room for a 60-character line; the tail's tip is at the bottom centre
const whole = value => Math.round(value) || 0;
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden}
.bubble{position:absolute;left:50%;bottom:12px;max-width:250px;width:max-content;padding:8px 13px;border-radius:15px;background:#fffdf8;color:#2a2622;
font:14px/1.5 system-ui,"Microsoft JhengHei",sans-serif;box-shadow:0 3px 10px rgba(0,0,0,.3);white-space:pre-wrap;overflow-wrap:anywhere;
opacity:0;transform:translate(-50%,6px) scale(.96);transform-origin:50% 100%;transition:opacity .18s,transform .18s}
.bubble::after{content:"";position:absolute;left:50%;bottom:-7px;margin-left:-7px;border:7px solid transparent;border-top-color:#fffdf8;border-bottom:0}
.bubble.on{opacity:1;transform:translate(-50%,0) scale(1)}
</style></head><body><div class="bubble" id="bubble"></div><script>
function say(text) { const bubble = document.getElementById('bubble'); bubble.textContent = text; bubble.classList.add('on'); return true; }
function fade() { document.getElementById('bubble').classList.remove('on'); return true; }
</script></body></html>`;

// petWindow: the character's window. A line said while it is hidden (as in the self-tests) is only remembered.
function createBubble(petWindow, safeWindow) {
  let win = null, point = null, fadeTimer = null, hideTimer = null, said = null;
  const alive = () => !!win && !win.isDestroyed();

  function open() {
    if (alive()) return win;
    win = new BrowserWindow({
      width: WIDTH, height: HEIGHT, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, hasShadow: false,
      skipTaskbar: true, alwaysOnTop: true, focusable: false, show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
    });
    safeWindow(win);
    win.setMenu(null);
    win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.loading = win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE)).catch(() => {});
    return win;
  }

  // Above the character's top (point, in its window), kept on its display.
  function place() {
    if (!alive() || !point || petWindow.isDestroyed()) return;
    const pet = petWindow.getBounds(), area = screen.getDisplayMatching(pet).workArea;
    const x = Math.max(area.x, Math.min(pet.x + point.x - WIDTH / 2, area.x + area.width - WIDTH));
    win.setBounds({ x: whole(x), y: whole(Math.max(area.y, pet.y + point.y - HEIGHT + 4)), width: WIDTH, height: HEIGHT });
  }

  function hide() {
    clearTimeout(fadeTimer);
    clearTimeout(hideTimer);
    point = null;
    if (alive() && win.isVisible()) win.hide();
  }

  return {
    said: () => said,
    async say(text, at) {
      said = { text, point: at };
      if (petWindow.isDestroyed() || !petWindow.isVisible()) return;
      const bubble = open();
      await bubble.loading;
      if (bubble.isDestroyed()) return;
      point = at;
      place();
      await bubble.webContents.executeJavaScript('say(' + JSON.stringify(text) + ')').catch(() => {});
      if (bubble.isDestroyed()) return;
      if (!bubble.isVisible()) bubble.showInactive();
      bubble.moveTop();
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
      fadeTimer = setTimeout(() => {
        if (alive()) win.webContents.executeJavaScript('fade()').catch(() => {});
        hideTimer = setTimeout(hide, 250);
      }, Math.min(7000, 2200 + text.length * 90));
    },
    // The character moved: the bubble goes with it.
    follow() { if (alive() && win.isVisible()) place(); },
    raise() { if (alive() && win.isVisible()) win.moveTop(); },
    hide,
    close() {
      hide();
      if (alive()) win.destroy();
    }
  };
}

module.exports = { createBubble };
