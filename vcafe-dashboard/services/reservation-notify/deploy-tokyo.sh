#!/usr/bin/env bash
# 予約通知を Cloud Run Job として東京リージョンにデプロイする（1回実行して終了するバッチ）。
# - 本番Firestoreは「読み取り」のみ。書き込みは管理用プロジェクトのFirestore（送信済み記録）だけ。
# - 既定は DRY_RUN=true（cloudrun.env.yaml）なので、実行してもDMは送らずログのみ。
# - 本番への読み取り権限を既に持つ同期用SAを再利用し、本番プロジェクトへの追加IAM付与を避ける。
set -euo pipefail

PROJECT_ID="vcafe-admin-analytics"
REGION="asia-northeast1"
JOB_NAME="vcafe-reservation-notify"
# 本番read権限(roles/datastore.viewer)を既に持つ同期用SAを既定で再利用。
RUNTIME_SA="${RUNTIME_SA:-vcafe-analytics-sync}"
RUNTIME_SA_EMAIL="${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
BOT_TOKEN_SECRET="${BOT_TOKEN_SECRET:-discord-bot-token}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$(gcloud config get-value project 2>/dev/null)" != "${PROJECT_ID}" ]]; then
  gcloud config set project "${PROJECT_ID}"
fi

gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com firestore.googleapis.com

if ! gcloud iam service-accounts describe "${RUNTIME_SA_EMAIL}" >/dev/null 2>&1; then
  echo "SA ${RUNTIME_SA_EMAIL} が見つかりません。RUNTIME_SA を指定するか、先に同期SAを作成してください。" >&2
  exit 1
fi

# 管理用Firestoreへの書き込み（送信済み記録）権限。本番プロジェクトのIAMは付与しない。
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
  --role="roles/datastore.user" --condition=None --quiet

# BotトークンのSecretがあれば読み取り権限を付与して注入する。
# 無ければ DRY_RUN 検証用にトークン無しでデプロイする（実送信前にSecret作成が必要）。
SECRET_FLAGS=()
if gcloud secrets describe "${BOT_TOKEN_SECRET}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud secrets add-iam-policy-binding "${BOT_TOKEN_SECRET}" \
    --project="${PROJECT_ID}" \
    --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" --quiet
  SECRET_FLAGS=(--set-secrets="DISCORD_BOT_TOKEN=${BOT_TOKEN_SECRET}:latest")
else
  echo "注意: Secret '${BOT_TOKEN_SECRET}' が見つかりません。DISCORD_BOT_TOKEN 無しでデプロイします。" >&2
  echo "      DRY_RUN=true の検証は可能ですが、実送信(DRY_RUN=false)前に Secret 作成が必要です。" >&2
fi

gcloud run jobs deploy "${JOB_NAME}" \
  --source "${SCRIPT_DIR}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --service-account="${RUNTIME_SA_EMAIL}" \
  --tasks=1 --parallelism=1 --max-retries=1 \
  --task-timeout=600s --cpu=1 --memory=512Mi \
  --env-vars-file="${SCRIPT_DIR}/cloudrun.env.yaml" \
  "${SECRET_FLAGS[@]}" \
  --quiet

echo "Deployed job ${JOB_NAME} in ${REGION}（既定 DRY_RUN=true）。"
echo "手動実行して動作確認: gcloud run jobs execute ${JOB_NAME} --region ${REGION}"
echo "定期実行(00:00 JST)は create-scheduler-tokyo.sh を実行してください。"
