// Windows integration of the portable App. Everything else stays in its folder; outside it there is only what
// Windows needs: a desktop shortcut (offered once at the first start, or made from 設定), an entry in Settings ›
// Apps (written at each start, so a moved folder is found again; it starts the App with --uninstall) and
// 解除安裝, which takes all of that away and, once the App has closed, deletes its folder (or all but Data).
// A developer's folder (with the source in dev/, or a git repository) is never deleted.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

const KEY = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CharacterDesktop';
const NAME = 'CharacterDesktop';

const runFile = (file, args) => new Promise(resolve => execFile(file, args, { windowsHide: true }, error => resolve(!error)));

// After the App has closed: its folder goes (but the names in keep), tried again while files are still in use.
function scheduleRemoval({ root, pid, keep }) {
  const quote = text => "'" + String(text).replace(/'/g, "''") + "'";
  const left = `Get-ChildItem -LiteralPath ${quote(root)} -Force | Where-Object { $keep -notcontains $_.Name }`;
  const script = [
    `Wait-Process -Id ${pid} -Timeout 60 -ErrorAction SilentlyContinue`, 'Start-Sleep -Seconds 1',
    `$keep = @(${keep.map(quote).join(',')})`,
    `for ($i = 0; $i -lt 15; $i++) { ${left} | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue; if (-not (${left})) { break }; Start-Sleep -Seconds 1 }`,
    `if ($keep.Count -eq 0) { Remove-Item -LiteralPath ${quote(root)} -Recurse -Force -ErrorAction SilentlyContinue }`
  ].join('; ');
  // Started through cmd (PowerShell started detached by itself exits at once without running); the script is
  // encoded, so no path in it is read by cmd. It outlives the App.
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  spawn('powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ' + encoded, [],
    { cwd: os.tmpdir(), detached: true, stdio: 'ignore', windowsHide: true, shell: true }).unref();
}

function createInstall({ app, shell, exe, root, version, platform = process.platform, desktop = () => app.getPath('desktop'),
  run = runFile, removeLater = scheduleRemoval }) {
  const supported = platform === 'win32' && app.isPackaged;
  const shortcut = () => path.join(desktop(), NAME + '.lnk');
  const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  const ours = file => { try { return same(shell.readShortcutLink(file).target, exe); } catch { return false; } };
  // Only an App folder of its own is deleted: the App is in it, and it is no drive, home, desktop or source folder.
  const folder = path.resolve(root);
  const removable = supported && same(path.dirname(exe), folder) && path.parse(folder).root !== folder
    && ![os.homedir(), desktop()].some(dir => same(dir, folder))
    && !fs.existsSync(path.join(folder, 'dev')) && !fs.existsSync(path.join(folder, '.git'));

  const hasShortcut = () => supported && fs.existsSync(shortcut()) && ours(shortcut());
  function createShortcut() {
    if (!supported) return false;
    return shell.writeShortcutLink(shortcut(), 'create', { target: exe, cwd: root, icon: exe, iconIndex: 0, description: NAME });
  }
  function removeShortcut() {
    if (hasShortcut()) fs.rmSync(shortcut(), { force: true });
  }

  // Settings › Apps: one entry for this user (no administrator needed), imported as a .reg file in one go.
  async function register() {
    if (!supported) return false;
    const text = value => '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    const lines = ['Windows Registry Editor Version 5.00', '', '[' + KEY + ']',
      '"DisplayName"=' + text(NAME), '"DisplayVersion"=' + text(version), '"Publisher"=' + text('ibcyc'),
      '"DisplayIcon"=' + text(exe), '"InstallLocation"=' + text(root), '"UninstallString"=' + text('"' + exe + '" --uninstall'),
      '"NoModify"=dword:00000001', '"NoRepair"=dword:00000001', ''];
    const file = path.join(os.tmpdir(), 'CharacterDesktop-' + process.pid + '.reg');
    fs.writeFileSync(file, Buffer.from('﻿' + lines.join('\r\n'), 'utf16le'));
    try { return await run('reg.exe', ['import', file]); } finally { fs.rmSync(file, { force: true }); }
  }
  const unregister = () => supported ? run('reg.exe', ['delete', KEY, '/f']) : Promise.resolve(false);

  // 解除安裝: the shortcut and the Apps entry go now; the folder after the App has closed (Data stays with keepData).
  async function uninstall({ keepData = false } = {}) {
    if (!supported) return { removed: false };
    removeShortcut();
    await unregister();
    if (removable) removeLater({ root: folder, pid: process.pid, keep: keepData ? ['Data'] : [] });
    return { removed: removable };
  }

  return { supported, removable, hasShortcut, createShortcut, removeShortcut, register, unregister, uninstall };
}

module.exports = { createInstall, scheduleRemoval, KEY };
