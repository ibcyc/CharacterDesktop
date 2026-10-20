// The desktop character window: transparent, frameless, always on top, and click-through except on the character.
const { BrowserWindow, screen } = require('electron');
const { MIN_HEIGHT, MAX_HEIGHT } = require('./profiles.cjs');

const WIDTH_RATIO = 0.72;   // window width / height
const EDGE_MARGIN = 60;     // how much of the window must stay on a display

// Keeps at least EDGE_MARGIN pixels of the window on the display it is on.
function clampBounds(bounds) {
  const area = screen.getDisplayMatching(bounds).workArea;
  return {
    ...bounds,
    x: Math.round(Math.max(area.x - bounds.width + EDGE_MARGIN, Math.min(bounds.x, area.x + area.width - EDGE_MARGIN))),
    y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - EDGE_MARGIN)))
  };
}

// Bottom-right corner of the primary display, slightly inset; each further character (slot) stands to the left.
function homeBounds(width, height, slot = 0) {
  const area = screen.getPrimaryDisplay().workArea;
  return clampBounds({ x: area.x + area.width - width - 35 - slot * Math.round(width * 0.8), y: area.y + area.height - height - 25, width, height });
}

function createPetWindow({ height, savedBounds, slot, opacity, preload, page, onMove, onCloseRequest, safeWindow }) {
  const area = screen.getPrimaryDisplay().workArea;
  const startHeight = Math.min(height, area.height), startWidth = Math.round(startHeight * WIDTH_RATIO);
  const start = savedBounds ? { x: savedBounds.x, y: savedBounds.y, width: startWidth, height: startHeight } : homeBounds(startWidth, startHeight, slot);

  const win = new BrowserWindow({
    ...clampBounds(start), title: '角色桌面', frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, hasShadow: false, skipTaskbar: true, alwaysOnTop: true, focusable: false, show: false,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  safeWindow(win);
  win.setMenu(null);
  win.setOpacity(opacity / 100);

  // Click-through: the page reports whether the pointer is over the character, and only then does the window take mouse input.
  let ignoringMouse = true;
  win.setIgnoreMouseEvents(true, { forward: true });

  function pin() {
    if (win.isDestroyed()) return;
    win.setAlwaysOnTop(true, 'screen-saver');
    if (win.isVisible()) win.moveTop();
  }
  pin();

  win.on('close', event => { if (onCloseRequest()) event.preventDefault(); });
  win.on('move', onMove);
  win.on('always-on-top-changed', (_, top) => { if (!top) setTimeout(pin, 0); });
  // On Windows a hidden-then-shown window ignores clicks until it is resized, so resize it once on every show.
  win.on('show', () => {
    pin();
    const bounds = win.getBounds();
    win.setBounds({ ...bounds, height: bounds.height + 1 });
    win.setBounds(bounds);
  });
  win.loadFile(page);

  // Dragging moves the window with the cursor, as the page reports it (once a displayed frame, so the window moves in
  // step with the screen; a timer would move it unevenly); the window takes all mouse input meanwhile.
  let drag = null;

  return {
    window: win,
    pin,
    isVisible: () => win.isVisible(),
    show: () => win.showInactive(),
    hide: () => win.hide(),
    bounds: () => win.getBounds(),
    setOpacity: percent => win.setOpacity(percent / 100),
    // Resizes around the bottom centre and returns the height actually used.
    resize(height) {
      const old = win.getBounds();
      const maxHeight = Math.min(MAX_HEIGHT, screen.getDisplayMatching(old).workArea.height);
      const next = Math.round(Math.max(MIN_HEIGHT, Math.min(height, maxHeight)));
      if (old.height !== next) {
        const width = Math.round(next * WIDTH_RATIO);
        win.setBounds(clampBounds({ x: old.x + Math.round((old.width - width) / 2), y: old.y + old.height - next, width, height: next }));
      }
      return next;
    },
    moveHome(homeSlot = 0) {
      const { width, height } = win.getBounds();
      win.setBounds(homeBounds(width, height, homeSlot));
    },
    keepOnDisplay: () => win.setBounds(clampBounds(win.getBounds())),
    moveTo: (x, y) => win.setBounds(clampBounds({ ...win.getBounds(), x, y })),
    setPointerOverCharacter(over) {
      if (drag || ignoringMouse === !over) return;
      ignoringMouse = !over;
      win.setIgnoreMouseEvents(ignoringMouse, { forward: true });
    },
    // point: where the press began (screen coordinates); without one, where the cursor is now.
    startDrag(point) {
      if (drag) return;
      drag = { point: point || screen.getCursorScreenPoint(), bounds: win.getBounds(), at: null };
      win.setIgnoreMouseEvents(false);
    },
    dragTo(x, y) {
      if (!drag || drag.at?.x === x && drag.at?.y === y) return;
      drag.at = { x, y };
      win.setPosition(Math.round(drag.bounds.x + x - drag.point.x), Math.round(drag.bounds.y + y - drag.point.y));
    },
    stopDrag() {
      drag = null;
    },
    isDragging: () => !!drag,
    close() {
      if (!win.isDestroyed()) win.destroy();
    }
  };
}

module.exports = { createPetWindow };
