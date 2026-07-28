#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="vcafe-admin-analytics"
REGION="asia-northeast1"
JOB_NAME="vcafe-analytics-sync"
RUNTIME_SERVICE_ACCOUNT="vcafe-analytics-sync"
RUNTIME_SERVICE_ACCOUNT_EMAIL="${RUNTIME_SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/${JOB_NAME}:disabled"

if [[ "$(gcloud config get-value project 2>/dev/null)" != "${PROJECT_ID}" ]]; then
  gcloud config set project "${PROJECT_ID}"
fi

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com

if ! gcloud iam service-accounts describe "${RUNTIME_SERVICE_ACCOUNT_EMAIL}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${RUNTIME_SERVICE_ACCOUNT}" \
    --display-name="VCAFE analytics sync (disabled)"
fi

gcloud builds submit \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --config="services/analytics-sync/cloudbuild.yaml" \
  --substitutions="_IMAGE=${IMAGE}" \
  .

gcloud run jobs deploy "${JOB_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --image="${IMAGE}" \
  --service-account="${RUNTIME_SERVICE_ACCOUNT_EMAIL}" \
  --tasks=1 \
  --parallelism=1 \
  --max-retries=0 \
  --task-timeout=3600s \
  --cpu=1 \
  --memory=512Mi \
  --env-vars-file="services/analytics-sync/disabled.env.yaml" \
  --quiet

echo "Deployed ${JOB_NAME} in ${REGION} with production reads disabled."
echo "No production IAM role was granted and the job was not executed."

