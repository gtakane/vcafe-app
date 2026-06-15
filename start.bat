@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv\Scripts\activate.bat" (
  echo [エラー] 先に setup.bat をダブルクリックしてください。
  pause
  exit /b
)
call .venv\Scripts\activate.bat
echo アプリを起動します。ブラウザが自動で開きます。
echo 終了するときは、この画面で Ctrl + C を押してください。
streamlit run app.py
pause
