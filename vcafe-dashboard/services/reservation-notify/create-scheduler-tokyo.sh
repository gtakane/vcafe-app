#!/usr/bin/env bash
# 予約通知 Cloud Run Job を毎日00:00 JSTに実行する Cloud Scheduler を作成する。
# 予約締切が23:59のため、00:00にその営業日の予約お給仕を各メイドへ通知する運用を想定。
# ジョブの env（DRY_RUN）はここでは変更しない。DRY_RUN=true の間はログのみで送信しない。
set -euo pipefail

PROJECT_ID="vcafe-admin-analytics"
REGION="asia-northeast1"
JOB_NAME="vcafe-reservation-notify"
SCHEDULER_NAME="vcafe-reservation-notify-schedule"
SCHEDULE="${NOTIFY_SCHEDULE:-0 0 * * *}"   # 毎日 00:00
TIME_ZONE="Asia/Tokyo"
SCHEDULER_SA="vcafe-reservation-notify-scheduler"
SCHEDULER_SA_EMAIL="${SCHEDULER_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

if [[ "$(gcloud config get-value project 2>/dev/null)" != "${PROJECT_ID}" ]]; then
  gcloud config set project "${PROJECT_ID}"
fi

gcloud services enable cloudscheduler.googleapis.com run.googleapis.com --project="${PROJECT_ID}"

if ! gcloud iam service-accounts describe "${SCHEDULER_SA_EMAIL}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${SCHEDULER_SA}" --display-name="VCAFE reservation notify scheduler"
fi

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
echo "ジョブの env が DRY_RUN=true の間は本番を読むだけでDMは送りません。"
