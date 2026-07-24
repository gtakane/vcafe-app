# Discord勤怠取り込みBot

指定チャンネルのシフトテンプレートを解析し、**管理用Firebaseプロジェクト**の`discordShiftSubmissions`へ保存します。本番Firestoreへの接続・書き込みコードはありません。

必要な環境変数：

- `DISCORD_BOT_TOKEN`
- `DISCORD_CHANNEL_ID`
- `DISCORD_GUILD_ID`（推奨）
- `MANAGEMENT_PROJECT_ID`
- `PRODUCTION_PROJECT_ID`（安全確認用、推奨）

`MANAGEMENT_PROJECT_ID`と`PRODUCTION_PROJECT_ID`が同じ場合は起動しません。Discord Developer PortalでMessage Content Intentを有効化し、対象チャンネルの閲覧、メッセージ履歴、リアクション権限だけをBotへ付与してください。

App Hostingの実行サービスアカウントには、管理用プロジェクトの`discordShiftSubmissions`を読むための最小権限だけを付与します。本番プロジェクト側のFirestore権限は付与しません。

実運用テンプレートの「欠勤／シフト変更／シフト追加／遅刻／早退」に対応しています。年が省略された日付はDiscord投稿日時の日本時間から最も近い年を補完し、終了時刻が開始時刻以前なら翌日として扱います。シフト変更は削除範囲と追加範囲を分けて保存しますが、本番シフトへ反映する処理はありません。
