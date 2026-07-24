# Discord勤怠取り込みBot

指定チャンネルのシフトテンプレートを解析し、**管理用Firebaseプロジェクト**の`discordShiftSubmissions`へ保存します。本番Firestoreへの接続・書き込みコードはありません。

必要な環境変数：

- `DISCORD_BOT_TOKEN`（Secret Managerから注入）
- `DISCORD_CHANNEL_ID`
- `DISCORD_GUILD_ID`（推奨）
- `MANAGEMENT_PROJECT_ID`
- `PRODUCTION_PROJECT_ID`（**必須**。安全確認のため）

## 本番書き込みの多層防御（`src/safety.ts`）

起動時に `resolveManagementProjectId()` が次を強制し、いずれかに反すると**Firestore接続前に停止**します。

1. `MANAGEMENT_PROJECT_ID` 必須。
2. `PRODUCTION_PROJECT_ID` **必須**（従来は任意で、未設定だとガードを素通りできた）。
3. 管理用と本番が同一ならエラー。
4. 管理用が既知の本番プロジェクトID（`v-athome-cafe-app`）ならエラー（設定漏れに依存せず停止）。

Discord Developer PortalでMessage Content Intentを有効化し、対象チャンネルの閲覧、メッセージ履歴、リアクション権限だけをBotへ付与してください。

## デプロイ（東京・常駐）

BotはWebSocket常時接続のため、`min=1`・CPU常時割り当ての Cloud Run サービスとして常駐させます。実行サービスアカウントには**管理用プロジェクトの`discordShiftSubmissions`への書き込み（`roles/datastore.user`）だけ**を付与し、本番プロジェクトのFirestore権限は付与しません。

```bash
# 事前に Secret Manager にトークンを格納:
#   printf '%s' "<BOT_TOKEN>" | gcloud secrets create discord-bot-token --data-file=- --project vcafe-admin-analytics
# cloudrun.env.yaml の CHANNEL/GUILD ID を実値へ置換してから:
./services/discord-attendance/deploy-tokyo.sh
```

実運用テンプレートの「欠勤／シフト変更／シフト追加／遅刻／早退」に対応しています。年が省略された日付はDiscord投稿日時の日本時間から最も近い年を補完し、終了時刻が開始時刻以前なら翌日として扱います。シフト変更は削除範囲と追加範囲を分けて保存しますが、本番シフトへ反映する処理はありません。
