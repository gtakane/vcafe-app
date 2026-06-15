# V-Cafe 管理アプリ（ローカル版・骨組み）

バーチャルあっとほぉーむカフェの各種ツールを1つに束ねるローカルアプリです。
現状は **勤怠レポートの可視化** が動作し、他モジュール（お給仕実績／予約通知／シフト反映）は枠だけ用意しています。

---

## 0. 用語（はじめての方へ）

- **ターミナル**：黒い画面でコマンドを打つ窓。ここでは **WezTerm** を使います。
- **シェル**：コマンドを解釈する中身（Windows標準は PowerShell）。WezTerm の中で動きます。
- **Streamlit**：Python で作るブラウザ画面アプリ。`streamlit run app.py` で自分のPC内に立ち上がります（外部公開はされません）。

---

## 1. 一度だけの準備（Windows）

### (a) WezTerm を入れる
公式サイト wezterm.org から Windows 版インストーラを入れて実行するだけです。

### (b) Python を入れる
python.org から Python 3.11 以上を入れます。インストーラ画面で
**「Add python.exe to PATH」に必ずチェック**を入れてください。

### (c) このフォルダで環境を作る
WezTerm を開き、このフォルダに移動します（例）。

```powershell
cd C:\Users\あなた\vcafe_app
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

> `.venv` はこのアプリ専用の隔離環境です。2回目以降は `.venv\Scripts\activate` だけでOK。

### (d) 秘密情報を置く（**漏れた鍵は必ず先に Reset**）
`secrets_local.example.json` を `secrets_local.json` という名前でコピーし、中身を
**Reset後の新しい** Discordトークン等に書き換えます。このファイルは Git に上がりません。

```powershell
copy secrets_local.example.json secrets_local.json
```

---

## 2. 起動

```powershell
.venv\Scripts\activate
streamlit run app.py
```

ブラウザが自動で開きます。閉じる時は WezTerm で `Ctrl + C`。

---

## 3. 使い方（現状）

- **勤怠レポート**：`kintai_report.py` が出力した `勤怠レポート_YYYY-MM.xlsx` を
  画面から選ぶ（または `data/` に置く）と、KPI・欠勤率ランキング・一覧が出ます。
- **設定**：トークン等の読み込み状況をマスク表示で確認できます。
- **サイドバーのテスト/本番スイッチ**：本番を選ぶと警告が出ます。
  書き込み系（シフト反映など）は本番時に確認入力を要求する設計です。

---

## 4. セキュリティの約束

- 秘密情報（Botトークン／Firebase鍵）は **コードに直書きしない**。
  `secrets_local.json` か環境変数から読み、どちらも `.gitignore` 済み。
- 一度どこかに貼った鍵・トークンは**漏洩扱い**にして Reset/再生成する。
- 本番書き込みは **dry-run と確認入力** を通してから。

---

## 5. これから足すもの

1. お給仕実績ダッシュボード（ご帰宅ログ取込）
2. 予約通知：Firestore `reservations` の `rsvStatus` false→true を検知してメイドへDM
3. シフト反映：`シフト表.xlsx` → 本番Firestore（GAS置き換え、firebase-admin + dry-run）

`core.py` にデータ処理・Discord送信・秘密情報読み込みの中核をまとめてあります。
画面は `app.py`。機能追加は基本この2ファイルに足していきます。
