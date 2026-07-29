# 分析同期の有効化ランブック

本番Firestore→BigQueryの同期を「初回非接続デプロイ」から「実際に稼働」させるための手順。
各ステップは独立してレビュー可能で、**本番への書き込みは一切発生しない**（読み取りのみ）。

前提のプロジェクト構成:

- 本番: `v-athome-cafe-app`（読み取りのみ）
- 分析用: `vcafe-admin-analytics`（BigQuery書き込み先）

## 0. 初回（非接続）デプロイ

```bash
./services/analytics-sync/deploy-disabled-job-tokyo.sh
```

`CONFIRM_READ_ONLY_SYNC=DISABLED` のため、手動実行しても本番接続前に停止する。ここまでで本番IAMは未付与。

## 1. BigQuery スキーマ適用（分析用プロジェクトのみ）

```bash
./services/analytics-sync/apply-schema.sh
```

テーブルと `*_current` ビューを `vcafe_analytics` に作成する。安全（分析用プロジェクトにのみ書き込み）。

## 2. 本番Firestoreの collection group インデックス（多くの場合は不要）

同期は以下に対する collectionGroup 範囲クエリを行う。

| コレクショングループ | フィールド | 用途 |
| --- | --- | --- |
| `userRecordVisits` | `enterDateTime` | ご帰宅 |
| `userAlbum` | `date` | チェキ |
| `workshifts` | `openTime` | シフト |
| `userRecordPresents` | `presentDateTime` | アイテム使用 |
| `userPayments` | `paymentDate` | 課金台帳（全時代） |

不足している場合は dry-run（手順5）が `FAILED_PRECONDITION` エラーを返し、
**そのメッセージに含まれるURLをクリックすれば必要なインデックスだけが作成される**（追加のみ・安全）。
事前確認は `node check-presents-index.mjs <グループ名> <フィールド名>` でもできる。
必要なインデックス定義は `services/analytics-sync/firestore.indexes.json` に記載。

> ⚠️ `firebase deploy --only firestore:indexes` は**このファイルの内容に本番を合わせる**ため、
> 記載のない複合インデックス12件と除外設定が削除される。**絶対に実行しないこと。**
> 追加は Firebase コンソール > Firestore > インデックス > 「自動」タブ > 除外 > 「除外を追加」から行う。
>
> ⚠️ 除外を追加する際、**コレクション スコープ（昇順/降順/配列に含む）のチェックを外さないこと。**
> 除外はインデックス構成を丸ごと置き換える設定のため、外すと本番アプリの通常クエリが
> `FAILED_PRECONDITION` で壊れる。追加したいのは「コレクショングループ スコープ 昇順」のみ。

## 3. HMAC シークレット作成（分析用プロジェクト）

ユーザーIDの不可逆変換に使う32文字以上の秘密値を Secret Manager に格納する。

```bash
printf '%s' "$(openssl rand -hex 32)" | \
  gcloud secrets create vcafe-customer-id-hmac \
  --project vcafe-admin-analytics --data-file=-
```

## 4. 本番への読み取り専用IAM付与（本番プロジェクト）

同期ジョブのランタイムSAに、本番プロジェクトで **`roles/datastore.viewer` のみ** を付与する。
`datastore.user`（書き込み可）やオーナーは付与しない。

```bash
gcloud projects add-iam-policy-binding v-athome-cafe-app \
  --member="serviceAccount:vcafe-analytics-sync@vcafe-admin-analytics.iam.gserviceaccount.com" \
  --role="roles/datastore.viewer" --condition=None
```

## 5. ジョブを有効設定で更新（まずは DRY_RUN=true のまま）

`enabled.env.yaml.example` をコピーして `enabled.env.yaml` を作り、ジョブを更新する。
`DRY_RUN=true` を維持したまま本番を読み、件数だけを確認する。

```bash
cp services/analytics-sync/enabled.env.yaml.example services/analytics-sync/enabled.env.yaml
gcloud run jobs update vcafe-analytics-sync \
  --project vcafe-admin-analytics --region asia-northeast1 \
  --env-vars-file services/analytics-sync/enabled.env.yaml \
  --set-secrets "CUSTOMER_ID_HMAC_SECRET=vcafe-customer-id-hmac:latest"
gcloud run jobs execute vcafe-analytics-sync --project vcafe-admin-analytics --region asia-northeast1 --wait
```

ログの `counts` を確認し、想定件数に収まっていることを検証する。

## 6. 実書き込みを有効化（別レビュー）

件数確認後、`enabled.env.yaml` の `DRY_RUN` を `"false"` に変更してジョブを更新し、再実行する。
このステップだけがBigQueryへの書き込みを発生させるため、独立してレビューすること。

## 7. 定期実行の作成

```bash
./services/analytics-sync/create-scheduler-tokyo.sh
```

Cloud Scheduler がジョブを定期起動する。スケジューラSAには `roles/run.invoker` のみを付与し、本番IAMは付与しない。

## 8. 過去分のバックフィル（初回のみ）

増分同期は直近の窓しか読まないため、過去データは別途取り込む。
`BACKFILL_FROM`〜`BACKFILL_TO`（UTC・終了日は含まない）で24時間窓を連続実行する。
1回あたり550窓の上限があるため、5年分は区間に分けて実行する。

> ⚠️ **開始前に必ずCloud Schedulerを止める。**
> 2026-07-29、バックフィル作業中（複数区間を順に`--wait`実行）に、ちょうど毎時0分の
> 定期実行がスケジューラから発火した。そのとき環境変数はまだバックフィル設定
> （`BACKFILL_FROM`/`BACKFILL_TO`/`REJECT_RATE_THRESHOLD`緩和など）のままだったため、
> **本来は直近90分の増分同期をするはずだった定期実行が、丸ごと同じ範囲のバックフィルとして
> 実行されてしまった**（手動実行と並行・重複）。`*_raw`は追記のみで`recordKey`により
> 重複排除されるためデータ破損は無かったが、本番Firestoreへの読み取りが同じ期間で
> 二重に発生し、その時間帯の本来の増分同期が欠落した（`RESCAN_DAYS`の日次再走査で
> 後から埋まったため実害は無かったが、偶然である）。
>
> ```bash
> gcloud scheduler jobs pause vcafe-analytics-sync-schedule \
>   --project=vcafe-admin-analytics --location=asia-northeast1
> ```
>
> バックフィル完了後（下記の変数除去のあと）に必ず再開する:
>
> ```bash
> gcloud scheduler jobs resume vcafe-analytics-sync-schedule \
>   --project=vcafe-admin-analytics --location=asia-northeast1
> ```

```bash
JOB=vcafe-analytics-sync; R=asia-northeast1; P=vcafe-admin-analytics
BASE="CONFIRM_READ_ONLY_SYNC=I_UNDERSTAND_THIS_READS_PRODUCTION,DRY_RUN=false,MAX_DOCUMENTS=5000,MAID_REPORTS=never"

for range in "2020-11-01 2022-05-01" "2022-05-01 2023-11-01" "2023-11-01 2025-05-01" "2025-05-01 2027-01-01"; do
  set -- $range
  gcloud run jobs update $JOB --region=$R --project=$P \
    --update-env-vars="$BASE,BACKFILL_FROM=$1,BACKFILL_TO=$2" \
    --set-secrets=CUSTOMER_ID_HMAC_SECRET=vcafe-customer-id-hmac:latest
  gcloud run jobs execute $JOB --region=$R --project=$P --wait
done
```

会員属性（性別・残高など）は時系列ではないため、別途スナップショット同期する。

```bash
gcloud run jobs update $JOB --region=$R --project=$P \
  --update-env-vars="$BASE,SYNC_ALL_USERS=true" --remove-env-vars=BACKFILL_FROM,BACKFILL_TO
gcloud run jobs execute $JOB --region=$R --project=$P --wait
```

**終わったら必ずバックフィル用の変数を外す**（残すと毎時の同期が5年分を繰り返す）。

```bash
gcloud run jobs update $JOB --region=$R --project=$P \
  --remove-env-vars=BACKFILL_FROM,BACKFILL_TO,MAID_REPORTS,SYNC_ALL_USERS
```

検証は `bash services/analytics-sync/verify-backfill.sh`。

> ⚠️ `deploy-disabled-job-tokyo.sh` を実行すると環境変数が `disabled.env.yaml` の内容に
> **置き換わる**（`CONFIRM_READ_ONLY_SYNC=DISABLED` / `DRY_RUN=true`）。
> イメージを再ビルドした後は、上記の `--update-env-vars` を必ず再適用すること。

## 課金データについて

課金は3つのコレクションに分散しているが、**`users/{uid}/userPayments` が全時代の台帳**であり、
これを正とする（`payments_raw.source = 'userPayments'`）。

| コレクション | 期間 | 内容 |
| --- | --- | --- |
| `users/{uid}/userPayments` | 2020-11〜現在 | **台帳（正）**。WEB版・アプリ版とも実払い円額 `amount` を持つ |
| `payments` | 2024-05〜現在 | Stripe/Webstore。台帳と重複 |
| `purchaseLog` | 2023-10〜現在 | アプリ内課金。円額を持たずコイン数のみ（×1.4円で近似） |

`payments_current` ビューは `userPayments` のみを集計対象とし、二重計上を防ぐ。
旧2ソースも `payments_raw` には残すため、`verify-backfill.sh` の 4b) で突き合わせ検証ができる。

---

安全性のまとめ:

- 同期コードに本番Firestoreへの書き込みは無い（`sourceDb` は get/getAll のみ）。
- 本番と分析用プロジェクトIDの同一指定を拒否、`CONFIRM_READ_ONLY_SYNC` が無ければ接続前に停止。
- 1回の取得は最大24時間・各コレクショングループ最大10,000件。
- 既定は `DRY_RUN=true`。実書き込みは手順6の明示変更が必要。
