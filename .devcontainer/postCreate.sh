#!/bin/bash
set -e

echo "=== Vあっと運営アプリ セットアップ ==="

# Python パッケージ
echo "[1/3] Python パッケージをインストール中..."
pip install --quiet -r requirements.txt
echo "      完了"

# Claude Code CLI
echo "[2/3] Claude Code CLI をインストール中..."
npm install -g @anthropic-ai/claude-code --silent
echo "      完了"

# data ディレクトリ
mkdir -p data

# secrets_local.json を Codespaces シークレット（環境変数）から自動生成
echo "[3/3] シークレット設定を確認中..."
python3 - << 'PYEOF'
import os, json

secrets = {}

if os.environ.get("DISCORD_BOT_TOKEN"):
    secrets["discord_bot_token"] = os.environ["DISCORD_BOT_TOKEN"]

if os.environ.get("DISCORD_CHANNEL_ID"):
    secrets["discord_channel_id"] = os.environ["DISCORD_CHANNEL_ID"]

# FIREBASE_KEY_JSON（JSON文字列）→ serviceAccountKey.json に書き出し
firebase_str = os.environ.get("FIREBASE_KEY_JSON", "")
if firebase_str:
    try:
        key = json.loads(firebase_str)
        with open("serviceAccountKey.json", "w", encoding="utf-8") as f:
            json.dump(key, f, indent=2)
        secrets["firebase_key_path"] = "serviceAccountKey.json"
        print("      serviceAccountKey.json を生成しました")
    except Exception as e:
        print(f"      Firebase キー生成エラー: {e}")

if secrets:
    with open("secrets_local.json", "w", encoding="utf-8") as f:
        json.dump(secrets, f, ensure_ascii=False, indent=2)
    print("      secrets_local.json を生成しました")
else:
    print("      Codespaces シークレットが未設定です")
    print("      → GitHub の Codespaces シークレットに設定するか、")
    print("        secrets_local.json を手動で作成してください")
PYEOF

echo ""
echo "=================================="
echo " セットアップ完了！"
echo " 起動: streamlit run app.py"
echo " Claude Code: claude"
echo "=================================="
