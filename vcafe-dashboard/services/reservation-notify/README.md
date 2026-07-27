# vcafe-reservation-notify

予約が入っているメイドへ、Discordで**その日の予約お給仕**を通知するバッチ（Cloud Run Job）。
予約締切が23:59のため、**毎日00:00 JST**に実行し、その営業日に予約のある各メイド本人へDMする想定。

## 設計
- **検知**: 分析用プロジェクトから本番Firestoreを1日1回**読み取り**（書き込みはしない）。
- **通知**: 既存のDiscord Bot（`discord-bot-token`）を使って担当メイド本人へ**DM**。
- **メイド↔Discord対応**: `maidDiscordMap`（手動）＋勤怠Botの `discordShiftSubmissions`（ニックネーム→discordUserId）で解決。手動が優先。
- **安全性**: 本番は読み取り専用。書き込みは管理用プロジェクトの `reservationNotifications`（送信済み記録＝二重送信防止）のみ。既定 `DRY_RUN=true`。
- **営業日**: 19:00〜翌02:00。営業日Dは実時刻 `[D 02:00, D+1 02:00) JST`（`lib/metrics.ts` と整合）。

## ロジックの単体テスト
```
npm test
```
`src/core.ts`（対象営業日の算出・集約・DM本文・対応解決・冪等キー）はスキーマ非依存で純粋。

## 予約データ（本番スキーマ・確認済み）
`workshiftGroups/{YYYYMMDD}/reservations/{id}` に予約枠が入る。
- `openTime`（Timestamp）= お給仕開始時刻
- `maidId` / `maidNickname` = 担当メイド
- `rsvStatus`（bool）= **true が「実際に予約が入った」枠**（false は空き枠→通知しない）
- `rsvUserNickname` / `rsvUserId` = 予約したお客様（rsvStatus=true時）

`cloudrun.env.yaml` は上記に合わせて設定済み。スキーマを再確認したい場合は
`npm install && node inspect-reservations.mjs workshiftGroups availableDate` で確認できる。

## 有効化手順（Cloud Shell）
2. **メイド↔Discord対応**を用意（どちらか）:
   - 勤怠Botに各メイドが投稿済みなら `ATTENDANCE_FALLBACK=true` で自動解決。
   - もしくは管理用Firestoreの `maidDiscordMap` に `{ maidId?, nickname?, discordUserId }` を登録。
3. **デプロイ（既定 DRY_RUN=true）**:
   ```
   bash deploy-tokyo.sh
   gcloud run jobs execute vcafe-reservation-notify --region asia-northeast1
   ```
   ログで「送信予定」件数・宛先・本文と「Discord未対応のメイド」を確認する。
4. 問題なければ `cloudrun.env.yaml` の `DRY_RUN` を `"false"` にして再デプロイ→実送信。
5. **定期実行(00:00 JST)**:
   ```
   bash create-scheduler-tokyo.sh
   ```

## 主な環境変数（cloudrun.env.yaml）
| 変数 | 既定 | 説明 |
|---|---|---|
| `DRY_RUN` | `true` | trueはログのみ。実送信は`false` |
| `TARGET_OFFSET_DAYS` | `0` | 0=当日の営業日ぶんを通知 |
| `SHOW_CUSTOMER` | `false` | DMにお客様名を含めるか |
| `RESERVATION_PARENT_COLLECTION` / `RESERVATION_SUBCOLLECTION` | `workshiftGroups` / `reservations` | 予約の格納先（対象日グループ配下を直接読む） |
| `RESERVATION_DATE_FIELD` | `openTime` | お給仕開始時刻フィールド |
| `RESERVATION_MAID_ID_FIELD` / `..._NICKNAME_FIELD` | `maidId` / `maidNickname` | 担当メイド |
| `RESERVATION_CUSTOMER_LABEL_FIELD` | `rsvUserNickname` | お客様名（SHOW_CUSTOMER=true時に表示） |
| `RESERVATION_FILTER_FIELD` / `..._VALUE` | `rsvStatus` / `true` | 実際に予約成立した枠のみ抽出 |
| `MAID_DISCORD_MAP_COLLECTION` | `maidDiscordMap` | 手動対応表 |
| `ATTENDANCE_FALLBACK` | `true` | 勤怠Bot記録で補完 |

> `DISCORD_BOT_TOKEN` は Secret Manager（`discord-bot-token`）からデプロイ時に注入。env.yamlには書かない。
