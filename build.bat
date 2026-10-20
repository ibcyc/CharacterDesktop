@echo off
chcp 65001 >nul
rem 角色桌面一鍵建置：產生 CharacterDesktop.exe、更新 App 並輸出發行 ZIP。
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo 找不到 Python，請先安裝 Python 3：https://www.python.org/downloads/
  pause
  exit /b 1
)
python dev\build.py %*
if errorlevel 1 (
  echo.
  echo 建置失敗，請查看上方訊息。
) else (
  echo.
  echo 完成！CharacterDesktop.exe 與發行 ZIP 已在此資料夾。
)
pause
