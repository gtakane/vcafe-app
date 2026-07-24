# Vあっと Analytics

Streamlit版を置き換える、Next.js + Firebase Hosting + Cloud Run向けの管理ダッシュボードです。メイド実績、勤怠、ユーザーデータベース、メイド×ユーザー分析を一つにまとめます。

確定済みのプロジェクトIDと環境分離は`docs/project-config.md`を参照してください。

## 安全境界

- Web画面は本番Firestoreへ接続しません。
- `ANALYTICS_BACKEND=bigquery`では別プロジェクトの分析用BigQueryだけを参照します。
- 本番用設定にはFirestore SDKも書き込み処理も含めません。
- メイド権限ではCustom Claimsの`maidId`をサーバー側で強制し、リクエスト値を信用しません。
- メイド画面へ送るレスポンスはサーバーで本人分だけに絞り、ユーザーIDを一時的な集計用IDへ置換してユーザー名を除去します。
- デモデータは架空であり、実ユーザー情報を含みません。

## KPIの正典（Streamlitと数値一致）

収益・訪問分類・営業日・滞在時間の重み・稼働時間の計算は `lib/metrics.ts` に集約し、既存Streamlit実装 `core.py` と同じ数値になるようにしています。

- 収益定数（840/960/650、予約3920、チェキ500、フォールバック係数1.4）は `core.py` と一致。
- ご帰宅数・有料数は滞在時間の重み（`max(1, round(initialTime/20))`）で集計。
- 日次/週次/月次は営業日（0:00〜1:59を前日扱い）で集計。
- 稼働時間は実打刻が無ければ予定時間で補完。
- 種別は「無料=トライアルのみ、予約はroomType、他は有料」。

定数やロジックを変更する場合は `core.py` 側も必ず合わせてください。

## ローカル確認

```powershell
Copy-Item .env.example .env.local
pnpm install
pnpm dev
```

`.env.local`は`AUTH_MODE=demo`、`ANALYTICS_BACKEND=demo`のまま利用できます。メイド画面は`DEMO_ROLE=maid`で確認できます。

## Firebase Authentication

本番では`AUTH_MODE=firebase`を使用し、対象ユーザーに次のCustom Claimsを設定します。

```json
{ "role": "admin" }
```

または

```json
{ "role": "maid", "maidId": "実際のメイドID" }
```

ログイン時にIDトークンを検証し、8時間のHttpOnlyセッションCookieへ交換します。

## 分析テーブル

BigQueryデータセットには次のビューまたはテーブルを用意します。

- `maids_current`: `id`, `name`, `avatar`, `status`
- `customers_current`: `id`, `name`, `rank`, `registeredAt`
- `visits`: `id`, `at`, `maidId`, `customerId`, `type`, `revenue`, `cheki`
- `shifts`: `id`, `maidId`, `scheduledStart`, `scheduledEnd`, `actualStart`, `actualEnd`

同期処理は別サービスとして実装し、本番Firestoreには読み取り専用IAM、時間帯制限、取得件数制限を設定します。

## Discord勤怠取り込み

`services/discord-attendance`に、指定チャンネルのテンプレート投稿を管理用Firestoreへ自動保存するBotを収録しています。DiscordメッセージIDをドキュメントIDにするため再処理しても重複せず、本番Firebaseプロジェクトと管理用プロジェクトが同一の場合は起動しません。

管理者の勤怠画面は、管理用Firestoreの`discordShiftSubmissions`を最大100件だけ読み取って申請一覧を表示します。理由を含むためメイド権限には返しません。これは確認用一覧であり、本番シフトを書き換える処理はありません。

ユーザー情報の既存Firestoreフィールドを確認する手順は`docs/user-data-mapping.md`に記載しています。本番側のフィールド名は変更せず、分析環境への同期時に共通スキーマへ変換します。

## 分析同期

`services/analytics-sync`に、本番Firestoreを読み取り専用IAMで参照して別プロジェクトのBigQueryへ同期するCloud Run Jobを収録しています。確認フラグ、24時間上限、件数上限、プロジェクト分離、既定ドライラン、ユーザーIDの不可逆変換を実装しています。コードを配置しただけでは本番接続も同期も実行されません。

## 東京リージョンへのデプロイ

Firebase Hostingを公開CDNとして使用し、すべてのアプリケーションリクエストを東京リージョン（`asia-northeast1`）のCloud Runへ転送します。Cloud Runは`min=0`、`max=3`で構成し、管理・分析用プロジェクト`vcafe-admin-analytics`にのみ権限を持つ専用サービスアカウントで実行します。

手順は`docs/deployment-tokyo.md`を参照してください。
