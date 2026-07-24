#!/usr/bin/env bash
# 同期用 Cloud Run Job を定期実行する Cloud Scheduler を作成する（東京リージョン）。
# 前提: 有効化ランブック（docs/enable-sync-runbook.md）の手順で
#       (1) 本番へ roles/datastore.viewer 付与、(2) HMAC Secret 作成、
#       (3) enabled.env.yaml でジョブ更新（まずは DRY_RUN=true）を済ませていること。
# このスクリプト自体は本番IAMを付与しない。ジョブの env（DRY_RUN）も変更しない。
set -euo pipefail

PROJECT_ID="vcafe-admin-analytics"
REGION="asia-northeast1"
JOB_NAME="vcafe-analytics-sync"
SCHEDULER_NAME="vcafe-analytics-sync-schedule"
SCHEDULE="${SYNC_SCHEDULE:-0 3 * * *}"   # 既定: 毎日 03:00 JST 相当（UTC指定は --time-zone で調整）
TIME_ZONE="Asia/Tokyo"
SCHEDULER_SA="vcafe-analytics-sync-scheduler"
SCHEDULER_SA_EMAIL="${SCHEDULER_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

if [[ "$(gcloud config get-value project 2>/dev/null)" != "${PROJECT_ID}" ]]; then
  gcloud config set project "${PROJECT_ID}"
fi

gcloud services enable cloudscheduler.googleapis.com run.googleapis.com --project="${PROJECT_ID}"

if ! gcloud iam service-accounts describe "${SCHEDULER_SA_EMAIL}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${SCHEDULER_SA}" --display-name="VCAFE analytics sync scheduler"
fi

# スケジューラSAにジョブ実行権限のみを付与（本番プロジェクトの権限は付与しない）。
gcloud run jobs add-iam-policy-binding "${JOB_NAME}" \
  --project="${PROJECT_ID}" --region="${REGION}" \
  --member="serviceAccount:${SCHEDULER_SA_EMAIL}" \
  --role="roles/run.invoker" --quiet

JOB_URI="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs/${JOB_NAME}:run"

gcloud scheduler jobs create http "${SCHEDULER_NAME}" \
  --project="${PROJECT_ID}" --location="${REGION}" \
  --schedule="${SCHEDULE}" --time-zone="${TIME_ZONE}" \
  --uri="${JOB_URI}" --http-method=POST \
  --oauth-service-account-email="${SCHEDULER_SA_EMAIL}" \
  --quiet 2>/dev/null || \
gcloud scheduler jobs update http "${SCHEDULER_NAME}" \
  --project="${PROJECT_ID}" --location="${REGION}" \
  --schedule="${SCHEDULE}" --time-zone="${TIME_ZONE}" \
  --uri="${JOB_URI}" --http-method=POST \
  --oauth-service-account-email="${SCHEDULER_SA_EMAIL}" \
  --quiet

echo "Scheduler '${SCHEDULER_NAME}' を作成/更新しました（${SCHEDULE} ${TIME_ZONE}）。"
echo "ジョブの env が DRY_RUN=true の間は本番を読むだけで BigQuery へは書きません。"
