[English](README.md) | **繁體中文**

# CharacterDesktop（角色桌面）

把任何一張圖片變成桌面上的角色。CharacterDesktop 是一個 Windows 桌面寵物 App：角色會待在桌面上、可以拖曳、戳了會有反應，還內建一個在本機執行的 AI 去背工具，讓照片或 AI 生成的圖一分鐘內就能變成角色。

- 免安裝，解壓縮就能用；所有資料都在 App 自己的資料夾裡。
- App 本身不連網。只有去背工具第一次使用時，會在你同意後下載 AI 模型。
- 開源，MIT 授權。

## 功能

- **自己的圖片當角色**：一張圖就是一個角色；用資料夾還能加入多個表情。支援 PNG、WebP、SVG、GIF。
- **多個角色同時在桌面**：每個角色可以各自調整高度、透明度、位置，也能鎖定位置防止誤拖。
- **戳一下有反應**：角色會彈跳、換表情，還有「自動戳」，隔一段時間自己動一下。
- **圖層與組合**：調整角色前後順序；把幾個角色存成一個「組合」，一鍵叫出整組、一起拖動。
- **角色包**：把角色連同設定匯出成 `.cdpack`，分享給朋友匯入。
- **圖片去背**：拖進照片，自動去背，再用筆刷修邊，最後直接加入成角色或新表情。全部在你的電腦上執行，照片不會上傳。
- **UI 設定**：設定視窗的背景透明度與模糊可以調整，讓它不擋住桌面。
- **系統匣**：左鍵全部隱藏／恢復顯示，右鍵打開設定視窗（右鍵角色也可以）；也可以設定開機自動啟動。

## 下載與使用

需要 Windows 10 或 11（64 位元），不用安裝其他軟體。

1. 到 [Releases](https://github.com/ibcyc/CharacterDesktop/releases/latest) 下載 **`CharacterDesktop.zip`**。同頁的 `ffmpeg-…tar.gz` 與 Source code 是原始碼，一般使用不需要下載。
2. 在 ZIP 上按右鍵 →「解壓縮全部」，放到好找的地方，例如「文件」。請先解壓縮，不要直接在 ZIP 裡開啟程式。
3. 打開資料夾，雙擊 **`CharacterDesktop.exe`**。
4. 如果出現「Windows 已保護您的電腦」，點「其他資訊」→「仍要執行」。這是因為程式沒有付費的數位簽章。
5. 第一次開啟時，App 會詢問要不要建立桌面捷徑。

### 加入第一個角色

1. 點設定視窗左下角的圓形按鈕，選「單張圖片」或「資料夾」。
2. 資料夾裡的檔名規則：`d` 是預設樣子，`e1`、`e2`……是表情（例如 `d.png`、`e1.png`）。
3. 取個名字，按「加入」。
4. 打開畫面下方中間的開關，角色就會出現在桌面上。

### 常用操作

| 想做的事 | 怎麼做 |
|---|---|
| 收起設定視窗 | 右上角的 ✕（角色會留在桌面上） |
| 全部隱藏／恢復顯示 | 左鍵點工作列右下角的 App 圖示 |
| 打開設定視窗 | 右鍵點工作列右下角的 App 圖示（右鍵角色也可以） |
| 建立組合 | 在圖層清單按住 Shift 點選角色，再按右鍵 →「組合」 |
| 去背 | 右下角選單 →「工具」→「圖片去背」 |
| 匯出角色包 | 右下角選單 →「匯出」 |
| 完全關閉 App | 右下角的紅色電源鍵 |

## 解除安裝

到 Windows「設定 › 應用程式」找到 **CharacterDesktop** → 解除安裝；或在 App 裡：右下角選單 →「還原」→「解除安裝」。

桌面捷徑、應用程式清單裡的項目和 App 的資料夾都會刪除。想留下角色的話，可以勾選「保留 Data 資料夾」，或先用「匯出」存成角色包。

## 擴充功能

App 支援擴充功能。把擴充功能的資料夾放進 App 旁的 `Extensions/<名稱>/`（或把它的 ZIP 解壓縮到 App 資料夾），再按右下角選單的「重啟」即可。移除時刪掉資料夾再重啟；擴充功能的角色會先隱藏，資料不會遺失。

去背工具本身就是一個擴充功能，已預先裝在 App 裡。擴充功能的介面在 `dev/app/extensions.cjs`。

## 從原始碼建置

需要 Windows、Python 3.8 以上，以及 Node.js（第一次建置時用來下載 Electron）。

```bat
git clone https://github.com/ibcyc/CharacterDesktop.git
cd CharacterDesktop
build.bat
```

也可以執行 `python dev/build.py`。建置會產生 `CharacterDesktop.exe` 與發行用的 `CharacterDesktop.zip`，並自動跑完所有測試（單元測試，以及在隱藏視窗中進行的 App 自我測試）。

## 授權

CharacterDesktop 以 [MIT 授權](LICENSE) 釋出。

App 使用的第三方元件各有授權：Electron 與 Chromium 見 `LICENSE.electron`、`LICENSES.chromium.html`，各元件的原始碼位置見 [`THIRD-PARTY-SOURCES.txt`](THIRD-PARTY-SOURCES.txt)；去背工具的元件（ONNX Runtime、rembg、BiRefNet 模型）見 `dev/extensions/cutout/licenses/`。
