#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="vcafe-admin-analytics"
REGION="asia-northeast1"
SERVICE_NAME="vcafe-dashboard"
RUNTIME_SERVICE_ACCOUNT="vcafe-dashboard-runtime"
RUNTIME_SERVICE_ACCOUNT_EMAIL="${RUNTIME_SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com"

if [[ "$(gcloud config get-value project 2>/dev/null)" != "${PROJECT_ID}" ]]; then
  gcloud config set project "${PROJECT_ID}"
fi

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firebasehosting.googleapis.com \
  identitytoolkit.googleapis.com \
  firestore.googleapis.com \
  bigquery.googleapis.com

if ! gcloud iam service-accounts describe "${RUNTIME_SERVICE_ACCOUNT_EMAIL}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${RUNTIME_SERVICE_ACCOUNT}" \
    --display-name="VCAFE dashboard runtime"
fi

for role in \
  roles/bigquery.jobUser \
  roles/bigquery.dataViewer \
  roles/datastore.viewer \
  roles/firebaseauth.admin
do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${RUNTIME_SERVICE_ACCOUNT_EMAIL}" \
    --role="${role}" \
    --condition=None \
    --quiet
done

gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --service-account="${RUNTIME_SERVICE_ACCOUNT_EMAIL}" \
  --allow-unauthenticated \
  --min=0 \
  --max=3 \
  --concurrency=40 \
  --cpu=1 \
  --memory=512Mi \
  --env-vars-file=cloudrun.env.yaml \
  --quiet

firebase use "${PROJECT_ID}"
firebase deploy --only hosting --project "${PROJECT_ID}"
