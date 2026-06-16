# 開発環境セットアップ手順

バーチャルあっとほぉーむカフェ管理アプリを別のPCで使えるようにするための手順書です。

開発環境の作り方は **2通り** あります。

| 方法 | 向いている場面 |
|------|--------------|
| **A. GitHub Codespaces（推奨）** | どのPCでもブラウザだけで開発したい |
| **B. Windowsローカル** | インターネットが使えない環境、または自分のPCに慣れたい |

---

## 共通の前提

- **GitHub アカウント** を持っていること（無料プランでOK）
- リポジトリ `https://github.com/gtakane/vcafe-app` へのアクセス権があること

---

## 方法 A：GitHub Codespaces（推奨）

ブラウザだけで完結します。Python のインストールや venv の作成は自動で行われます。

### ステップ 1：Codespaces シークレットを登録する（初回1回だけ）

アプリが Discord・Firebase に接続するための「鍵」を GitHub に預けます。

1. GitHub にログインし、右上のアイコン →「**Settings**」を開く
2. 左メニューの「**Codespaces**」をクリック
3. 「**Secrets**」セクションの「**New secret**」から、以下の3つを順番に追加する

| シークレット名 | 値 | 備考 |
|---|---|---|
| `DISCORD_BOT_TOKEN` | Discord Bot のトークン | Discord Developer Portal で確認 |
| `DISCORD_CHANNEL_ID` | 送信先チャンネルのID | `1489926976239304734` など |
| `FIREBASE_KEY_JSON` | `serviceAccountKey.json` の**中身をそのまま全部**コピペ | `{` から始まる長い JSON テキスト |

4. 各シークレットを追加するとき、「**Repository access**」で `vcafe-app` リポジトリを選択する

> **Firebase キーの確認方法**  
> 現在のPCの `C:\Users\Owner\Desktop\vcafe_app\serviceAccountKey.json` をメモ帳で開き、全文をコピーしてください。

---

### ステップ 2：Codespace を起動する

1. ブラウザで `https://github.com/gtakane/vcafe-app` を開く
2. 緑の「**Code**」ボタンをクリック
3. 「**Codespaces**」タブを選ぶ
4. 「**New codespace on main**」をクリック

ブラウザ上で VS Code が開き、自動セットアップが始まります（初回は 2〜3 分かかります）。

> 画面下部のターミナルに「**セットアップ完了！**」と表示されたら準備完了です。

---

### ステップ 3：アプリを起動する

ターミナル（画面下部）に以下を入力して Enter：

```bash
streamlit run app.py
```

右下に「**Open in Browser**」というポップアップが出るのでクリックすると、別タブでアプリが開きます。

> ポップアップが出ない場合：画面左のサイドバー「**PORTS**」タブを開き、ポート `8501` の地球儀アイコンをクリックしてください。

---

### ステップ 4：Claude Code を使う（オプション）

ターミナルで以下を実行：

```bash
claude
```

初回のみ認証画面が表示されます。指示に従って Anthropic アカウントでログインしてください。

---

### 2回目以降の起動

1. `https://github.com/gtakane/vcafe-app` を開く
2. 「**Code**」→「**Codespaces**」→ 前回作った Codespace の名前をクリック
3. 自動で前回の状態が復元されます

> Codespace は **一定時間操作がないと自動停止**しますが、データは保持されます。再度クリックで再開できます。

---

## 方法 B：Windows ローカル環境

自分のPCに直接環境を作る方法です。

### ステップ 1：必要なソフトをインストールする

以下を順番にインストールしてください。

#### Python 3.11 以上

1. `https://www.python.org/downloads/` を開く
2. 「**Download Python 3.x.x**」をクリック
3. インストーラを起動し、**「Add python.exe to PATH」に必ずチェックを入れてから** Install Now をクリック

> インストール後、コマンドプロンプトで `python --version` と打って `Python 3.11.x` と表示されれば成功です。

#### Git

1. `https://git-scm.com/download/win` を開く
2. インストーラをダウンロードして実行
3. すべてデフォルトのままで「Next」を押し続けて完了

#### WezTerm（ターミナル、任意）

1. `https://wezfurlong.org/wezterm/` を開く
2. 「Download」から Windows 版インストーラをダウンロードして実行

---

### ステップ 2：リポジトリをクローンする

WezTerm（または PowerShell）を開き、以下を実行：

```powershell
cd C:\Users\あなたのユーザー名\Desktop
git clone https://github.com/gtakane/vcafe-app.git
cd vcafe-app
```

---

### ステップ 3：Python 仮想環境を作ってパッケージを入れる

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

> `(.venv)` が行頭に表示されれば仮想環境が有効です。

---

### ステップ 4：シークレットファイルを作る

```powershell
copy secrets_local.example.json secrets_local.json
```

作成された `secrets_local.json` をメモ帳で開き、以下の値を書き換えてください：

```json
{
  "discord_bot_token":  "（Discordボットトークンを貼る）",
  "discord_channel_id": "（チャンネルIDを貼る）",
  "firebase_key_path":  "serviceAccountKey.json"
}
```

Firebase のサービスアカウントキーファイル（`serviceAccountKey.json`）を、`vcafe-app` フォルダ直下に配置してください。

---

### ステップ 5：アプリを起動する

```powershell
.venv\Scripts\activate
streamlit run app.py
```

ブラウザが自動で開きます。

> 2回目以降は `.venv\Scripts\activate` → `streamlit run app.py` の2行だけで起動できます。

---

## セキュリティの注意

- `secrets_local.json` と `serviceAccountKey.json` は **絶対に他人に見せない・Git にコミットしない**（`.gitignore` で除外済み）
- 鍵が漏洩した可能性がある場合は、**すぐに Discord Developer Portal / Firebase Console で再発行**する

---

## トラブルシューティング

| 症状 | 対処 |
|------|------|
| `streamlit: command not found` | `.venv\Scripts\activate` を先に実行しているか確認 |
| `ModuleNotFoundError: No module named 'core'` | `vcafe-app` フォルダ内でコマンドを実行しているか確認 |
| Firebase エラーが出る | `serviceAccountKey.json` の配置場所と `firebase_key_path` の値を確認 |
| Codespace でシークレットが反映されない | GitHub Settings → Codespaces → Secrets でリポジトリへのアクセスが許可されているか確認 |
| ポート 8501 が開かない（Codespaces） | ターミナルで `streamlit run app.py --server.headless=true` を実行 |
