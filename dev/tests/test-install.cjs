// Unit tests for the Windows integration (app/install.cjs): the desktop shortcut, the entry in Settings › Apps and
// 解除安裝. Works in temporary folders with a stand-in for Electron's shortcut functions; the registry is never
// touched (the .reg file is read instead of imported) and no folder is deleted (the removal is only recorded).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createInstall, scheduleRemoval, KEY } = require('../app/install.cjs');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'install-test-'));
const folder = (...names) => { const dir = path.join(temp, ...names); fs.mkdirSync(dir, { recursive: true }); return dir; };
// Shortcuts as small JSON files, so the test can read back what was made.
const shell = {
  writeShortcutLink: (file, operation, options) => { fs.writeFileSync(file, JSON.stringify({ operation, ...options })); return true; },
  readShortcutLink: file => JSON.parse(fs.readFileSync(file, 'utf8'))
};
function setUp(root, { packaged = true } = {}) {
  const calls = [], desktop = folder('Desktop-' + path.basename(root));
  const exe = path.join(root, 'CharacterDesktop.exe');
  fs.writeFileSync(exe, '');
  const install = createInstall({
    app: { isPackaged: packaged }, shell, exe, root, version: '1.2.3', platform: 'win32', desktop: () => desktop,
    run: async (file, args) => { calls.push([file, ...args, ...(args[0] === 'import' ? [fs.readFileSync(args[1]).toString('utf16le')] : [])]); return true; },
    removeLater: job => calls.push(['remove', job])
  });
  return { install, calls, desktop, exe };
}

(async () => {
  // A folder of its own can be deleted; a developer's (dev/ or .git) or one the App is not in cannot.
  const own = setUp(folder('Apps', 'CharacterDesktop'));
  assert.equal(own.install.removable, true, 'own folder');
  const source = folder('Source');
  folder('Source', 'dev');
  assert.equal(setUp(source).install.removable, false, 'a folder with dev/');
  const repository = folder('Repository');
  folder('Repository', '.git');
  assert.equal(setUp(repository).install.removable, false, 'a git repository');
  const outside = setUp(folder('Elsewhere'));
  const other = createInstall({ app: { isPackaged: true }, shell, exe: outside.exe, root: temp, version: '1', platform: 'win32', desktop: () => outside.desktop });
  assert.equal(other.removable, false, 'a folder the App is not in');
  const unpackaged = setUp(folder('Unpackaged'), { packaged: false }).install;
  assert.deepEqual([unpackaged.supported, unpackaged.removable, unpackaged.createShortcut(), await unpackaged.register()], [false, false, false, false], 'nothing outside Windows builds');

  // The desktop shortcut: made once, pointing to the App and its folder; one to another program is never taken.
  assert.equal(own.install.hasShortcut(), false);
  assert.equal(own.install.createShortcut(), true);
  const link = shell.readShortcutLink(path.join(own.desktop, 'CharacterDesktop.lnk'));
  assert.deepEqual([own.install.hasShortcut(), link.target, link.cwd, link.icon], [true, own.exe, path.dirname(own.exe), own.exe], 'shortcut');
  const foreign = setUp(folder('Foreign'));
  shell.writeShortcutLink(path.join(foreign.desktop, 'CharacterDesktop.lnk'), 'create', { target: 'C:\\Other\\Other.exe' });
  foreign.install.removeShortcut();
  assert.equal(fs.existsSync(path.join(foreign.desktop, 'CharacterDesktop.lnk')), true, 'another program\'s shortcut stays');

  // Settings › Apps: one .reg import for this user, with the App's folder, version and --uninstall.
  assert.equal(await own.install.register(), true);
  const [file, operation, regFile, text] = own.calls.at(-1);
  assert.deepEqual([file, operation, fs.existsSync(regFile)], ['reg.exe', 'import', false], 'imported, then the file is gone');
  for (const line of ['[' + KEY + ']', '"DisplayName"="CharacterDesktop"', '"DisplayVersion"="1.2.3"', '"Publisher"="ibcyc"', '"NoModify"=dword:00000001',
    '"InstallLocation"="' + path.dirname(own.exe).replace(/\\/g, '\\\\') + '"', '"UninstallString"="\\"' + own.exe.replace(/\\/g, '\\\\') + '\\" --uninstall"']) {
    assert.ok(text.includes(line), 'registry entry: ' + line);
  }
  assert.ok(KEY.startsWith('HKEY_CURRENT_USER\\'), 'this user only');

  // 解除安裝: the shortcut and the entry go; the folder is removed after the App closes, all of it or all but Data.
  own.calls.length = 0;
  assert.deepEqual(await own.install.uninstall(), { removed: true });
  assert.deepEqual([own.install.hasShortcut(), own.calls[0], own.calls[1][0], own.calls[1][1].root, own.calls[1][1].keep, own.calls[1][1].pid],
    [false, ['reg.exe', 'delete', KEY, '/f'], 'remove', path.dirname(own.exe), [], process.pid], 'uninstalled');
  own.calls.length = 0;
  await own.install.uninstall({ keepData: true });
  assert.deepEqual(own.calls[1][1].keep, ['Data'], 'Data kept');
  const developer = setUp(source);
  developer.install.createShortcut();
  assert.deepEqual(await developer.install.uninstall(), { removed: false });
  assert.deepEqual([developer.install.hasShortcut(), developer.calls.map(call => call[0])], [false, ['reg.exe']], 'a developer\'s folder stays');

  // The real removal (Windows only), in temporary folders: it waits for the App's process to end, then deletes the
  // folder, or all but Data.
  if (process.platform === 'win32') {
    const app = name => { const root = folder('Removal', name); fs.writeFileSync(path.join(root, 'CharacterDesktop.exe'), ''); fs.mkdirSync(path.join(root, 'resources', 'app'), { recursive: true }); fs.mkdirSync(path.join(root, 'Data')); fs.writeFileSync(path.join(root, 'Data', 'settings.json'), '{}'); return root; };
    const whole = app('Whole'), kept = app('Kept');
    const running = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1500)'], { stdio: 'ignore' });
    scheduleRemoval({ root: whole, pid: running.pid, keep: [] });
    scheduleRemoval({ root: kept, pid: running.pid, keep: ['Data'] });
    assert.equal(fs.existsSync(path.join(whole, 'CharacterDesktop.exe')), true, 'nothing goes while the App runs');
    for (let wait = 0; wait < 60 && (fs.existsSync(whole) || fs.readdirSync(kept).length > 1); wait++) await new Promise(resolve => setTimeout(resolve, 500));
    assert.deepEqual([fs.existsSync(whole), fs.readdirSync(kept), fs.existsSync(path.join(kept, 'Data', 'settings.json'))], [false, ['Data'], true], 'removed after the App closed');
  }

  fs.rmSync(temp, { recursive: true, force: true });
  console.log(JSON.stringify({ ok: true, removable: true, shortcut: true, register: true, uninstall: true, removal: process.platform === 'win32' }, null, 2));
})().catch(error => { console.error(error); process.exit(1); });
