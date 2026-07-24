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

## 2. 本番Firestoreの collection group インデックス作成（本番プロジェクト）

同期は `userRecordVisits.enterDateTime` / `userAlbum.date` / `workshifts.openTime` に対する
collectionGroup 範囲クエリを行うため、COLLECTION_GROUP スコープのインデックスが必要。

```bash
firebase deploy --only firestore:indexes \
  --project v-athome-cafe-app \
  --config services/analytics-sync/firestore.indexes.json
```

本番プロジェクトのオーナー権限が必要。**データは変更されない**（インデックス定義のみ）。未作成だと同期は `FAILED_PRECONDITION` で失敗する。

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

---

安全性のまとめ:

- 同期コードに本番Firestoreへの書き込みは無い（`sourceDb` は get/getAll のみ）。
- 本番と分析用プロジェクトIDの同一指定を拒否、`CONFIRM_READ_ONLY_SYNC` が無ければ接続前に停止。
- 1回の取得は最大24時間・各コレクショングループ最大10,000件。
- 既定は `DRY_RUN=true`。実書き込みは手順6の明示変更が必要。
