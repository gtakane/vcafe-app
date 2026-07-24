#!/usr/bin/env bash
# Discord勤怠取り込みBotを東京リージョンのCloud Runサービスとしてデプロイする。
# Botは常時WebSocket接続を保持するため min=1 / CPU常時割り当てで常駐させる。
# 書き込み先は管理用プロジェクトのFirestoreのみ。本番プロジェクトへのIAMは付与しない。
set -euo pipefail

PROJECT_ID="vcafe-admin-analytics"
REGION="asia-northeast1"
SERVICE_NAME="vcafe-discord-attendance"
RUNTIME_SA="vcafe-discord-attendance"
RUNTIME_SA_EMAIL="${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
# DISCORD_BOT_TOKEN を格納した Secret Manager のシークレット名。
BOT_TOKEN_SECRET="${BOT_TOKEN_SECRET:-discord-bot-token}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$(gcloud config get-value project 2>/dev/null)" != "${PROJECT_ID}" ]]; then
  gcloud config set project "${PROJECT_ID}"
fi

gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com firestore.googleapis.com

if ! gcloud iam service-accounts describe "${RUNTIME_SA_EMAIL}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${RUNTIME_SA}" --display-name="VCAFE discord attendance bot"
fi

# 管理用Firestoreへの書き込み権限のみ。本番プロジェクトの権限は一切付与しない。
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
  --role="roles/datastore.user" --condition=None --quiet

# ランタイムSAがトークンのSecretを読めるようにする。
gcloud secrets add-iam-policy-binding "${BOT_TOKEN_SECRET}" \
  --project="${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor" --quiet

gcloud run deploy "${SERVICE_NAME}" \
  --source "${SCRIPT_DIR}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --service-account="${RUNTIME_SA_EMAIL}" \
  --no-allow-unauthenticated \
  --min=1 --max=1 \
  --no-cpu-throttling \
  --cpu=1 --memory=512Mi \
  --env-vars-file="${SCRIPT_DIR}/cloudrun.env.yaml" \
  --set-secrets="DISCORD_BOT_TOKEN=${BOT_TOKEN_SECRET}:latest" \
  --quiet

echo "Deployed ${SERVICE_NAME} (min=1, 常時起動) を ${REGION} に配置しました。"
echo "本番プロジェクトへのIAMは付与していません。書き込み先は ${PROJECT_ID} のFirestoreのみです。"
