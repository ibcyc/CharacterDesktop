// Tools (工具, in the app menu): an extension registers one from its page script with registerTool(id, { name,
// open(), close() }); without any, 工具 is not shown. A tool that works on pictures can add
// takePictures: { label, load(files) }: the App then offers it (its label as a button) for pictures that are
// better worked on first, such as a JPG without transparency, and opens it with them. Opening one turns the window into the tool's own editor: the
// character page is hidden and #tool-host (holding the tool's markup, from its "tool" slot) takes the window. The
// tool calls CharacterDesktop.closeTool() to come back; the page then starts again from the library (the tool may
// have added a character). The characters on the desktop stay as they are.

const tools = new Map();
let toolOpen = '';

function registerTool(id, tool) { tools.set(id, tool); }

// The tools that take pictures: [{ id, label }].
const pictureTools = () => [...tools].filter(([, tool]) => typeof tool.takePictures?.load === 'function').map(([id, tool]) => ({ id, label: String(tool.takePictures.label || tool.name) }));
async function openToolWith(id, files) {
  if (!await openTool(id)) return false;
  await tools.get(id).takePictures.load(files);
  return true;
}

function setToolsOpen(open) {
  $('tools-menu').hidden = !open;
  $('tools-toggle').setAttribute('aria-expanded', String(open));
}

async function openTool(id) {
  const tool = tools.get(id);
  if (!tool || toolOpen || busy || downloading) return false;
  setAppMenuOpen(false);
  for (const panel of document.querySelectorAll('.download-dock .download-panel')) setDockPanel(panel, false);
  toolOpen = id;
  document.body.classList.add('tool-mode');
  $('tool-host').hidden = false;
  await tool.open();
  return true;
}

async function closeTool() {
  const tool = tools.get(toolOpen);
  if (!tool) return false;
  await tool.close();
  toolOpen = '';
  $('tool-host').hidden = true;
  document.body.classList.remove('tool-mode');
  await restoreFromApp(await window.desktopAPI.getState());
  return true;
}

function setUpTools() {
  $('tools-item').hidden = !tools.size;
  $('tools-menu').replaceChildren(...[...tools].map(([id, tool]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = tool.name;
    button.onclick = () => openTool(id);
    return button;
  }));
  $('tools-toggle').onclick = () => setToolsOpen($('tools-menu').hidden);
}
