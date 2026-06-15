@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  V-Cafe 管理アプリ  初回セットアップ
echo ============================================
echo.
echo Pythonの専用環境を作り、必要な部品を入れます。
echo 数分かかります。終わるまでお待ちください...
echo.
python -m venv .venv
if errorlevel 1 (
  echo.
  echo [エラー] Python が見つかりません。
  echo python.org から Python を入れ、インストール画面の
  echo 「Add python.exe to PATH」にチェックを入れてください。
  pause
  exit /b
)
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
echo.
echo ============================================
echo  完了！ 次からは start.bat をダブルクリックするだけです。
echo ============================================
pause
