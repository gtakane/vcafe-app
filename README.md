# Vあっと運営アプリ

バーチャルあっとほぉーむカフェの内部管理ツールです。

## 機能

| 機能 | 状態 |
|------|------|
| 勤怠レポート可視化 | ✅ 完成 |
| お給仕実績ダッシュボード（Firestore連携） | ✅ 完成 |
| 予約通知（Firestore → Discord） | 🔧 開発中 |
| シフト反映（xlsx → Firestore） | 🔧 開発中 |

## セットアップ

別のPCや初めての環境でのセットアップ手順は **[SETUP.md](./SETUP.md)** を参照してください。

- **GitHub Codespaces（推奨）**：ブラウザだけで開発環境が整います
- **Windows ローカル**：従来通り自分のPCに構築する方法

## クイックスタート（このPCで再起動する場合）

```powershell
cd C:\Users\Owner\Desktop\vcafe_app
.venv\Scripts\activate
streamlit run app.py
```

## ファイル構成

```
vcafe_app/
├── app.py                   # 画面（Streamlit）
├── core.py                  # データ処理・Firestore・Discord 送信
├── requirements.txt         # Python パッケージ一覧
├── secrets_local.json       # 秘密情報（Gitに上がらない）
├── serviceAccountKey.json   # Firebase 鍵（Gitに上がらない）
├── data/                    # キャッシュファイル置き場
├── .devcontainer/           # GitHub Codespaces 設定
└── .streamlit/              # Streamlit テーマ設定
```

## セキュリティ

- `secrets_local.json` と `serviceAccountKey.json` は `.gitignore` で除外済み
- 鍵が漏洩した場合は Discord Developer Portal / Firebase Console で**即座に再発行**する
