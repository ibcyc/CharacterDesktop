**English** | [繁體中文](README.zh-TW.md)

# CharacterDesktop

Turn any picture into a character on your desktop. CharacterDesktop is a desktop pet app for Windows: characters stay on your desktop, can be dragged around and react when you poke them. It also has a built-in AI background-removal tool that runs on your own computer, so a photo or an AI-generated picture becomes a character in about a minute.

- No installation: unzip and run. All data stays in the App's own folder.
- The App itself does not go online. Only the background-removal tool downloads its AI model, the first time you use it and only after you agree.
- Open source, MIT licensed.
- The interface is in Traditional Chinese; the names of buttons below are given in Chinese with an English translation.

## Features

- **Your own pictures as characters**: one picture is one character; a folder can add several expressions. PNG, WebP, SVG and GIF are supported.
- **Many characters on the desktop at once**: each has its own height, opacity and place, and can be locked so it is not dragged by accident.
- **Reacts when poked**: characters bounce and change expression. With auto-poke they move on their own now and then.
- **Layers and groups**: change which character is in front; save several characters as a group to bring them all out at once and drag them together.
- **Character packs**: export characters with their settings as a `.cdpack` file for friends to import.
- **Background removal**: drop in photos, the background is removed automatically, touch up the edges with brushes, then add the result as a new character or a new expression. Everything runs on your computer; photos are never uploaded.
- **UI settings**: the settings window's background transparency and blur can be adjusted, so it doesn't cover your desktop.
- **Tray icon**: left-click hides or shows all characters, right-click opens the settings window (right-clicking a character works too). The App can also start at login.

## Download and use

Requires Windows 10 or 11 (64-bit). Nothing else to install.

1. Download **`CharacterDesktop.zip`** from [Releases](https://github.com/ibcyc/CharacterDesktop/releases/latest). The `ffmpeg-…tar.gz` and Source code files on the same page are source code; you don't need them to use the App.
2. Right-click the zip → **Extract All**, and put it somewhere easy to find, such as Documents. Extract it first; don't run the App from inside the zip.
3. Open the folder and double-click **`CharacterDesktop.exe`**.
4. If "Windows protected your PC" appears, choose **More info** → **Run anyway**. This happens because the App is not code-signed.
5. On first start, the App offers to create a desktop shortcut.

### Add your first character

1. Click the round button at the bottom left of the settings window and choose 單張圖片 (single picture) or 資料夾 (folder).
2. In a folder, `d` is the default look and `e1`, `e2`, … are expressions (for example `d.png`, `e1.png`).
3. Give it a name and click 加入 (Add).
4. Turn on the switch at the bottom centre, and the character appears on your desktop.

### Everyday use

| To | Do this |
|---|---|
| Put the settings window away | ✕ at the top right (characters stay on the desktop) |
| Hide or show all characters | Left-click the App's icon in the taskbar's notification area |
| Open the settings window | Right-click the App's icon in the notification area (right-clicking a character works too) |
| Make a group | In the layer list, Shift+click characters, then right-click → 組合 (Group) |
| Remove a background | Menu at the bottom right → 工具 (Tools) → 圖片去背 (Background removal) |
| Export a character pack | Menu at the bottom right → 匯出 (Export) |
| Quit the App | The red power button at the bottom right |

## Uninstall

In Windows Settings → Apps, find **CharacterDesktop** → Uninstall; or in the App: menu at the bottom right → 還原 (Reset) → 解除安裝 (Uninstall).

The desktop shortcut, the entry in the Apps list and the App's folder are removed. To keep your characters, tick 保留 Data 資料夾 (keep the Data folder), or export them as a character pack first.

## Extensions

The App supports extensions. Put an extension's folder in `Extensions/<name>/` next to the App (or unzip its zip into the App's folder), then choose 重啟 (Restart) in the menu at the bottom right. To remove one, delete its folder and restart; its characters are hidden, not lost.

The background-removal tool is itself an extension and comes preinstalled. The extension API is in `dev/app/extensions.cjs`.

## Build from source

Requires Windows, Python 3.8 or later, and Node.js (used to download Electron on the first build).

```bat
git clone https://github.com/ibcyc/CharacterDesktop.git
cd CharacterDesktop
build.bat
```

Or run `python dev/build.py`. The build creates `CharacterDesktop.exe` and the release `CharacterDesktop.zip`, and runs all tests (unit tests and the App's self-tests in hidden windows).

## License

CharacterDesktop is released under the [MIT License](LICENSE).

Third-party components come with their own licenses. Electron and Chromium: `LICENSE.electron` and `LICENSES.chromium.html`. Where each component's source code is: [`THIRD-PARTY-SOURCES.txt`](THIRD-PARTY-SOURCES.txt). The background-removal tool's components (ONNX Runtime, rembg, the BiRefNet model): `dev/extensions/cutout/licenses/`.
