#!/usr/bin/env bash
# トラフィックを直前の正常リビジョンへ戻す。
#
#   bash rollback-revision-tokyo.sh vcafe-dashboard-xxxxxxx
#   bash rollback-revision-tokyo.sh            # リビジョン一覧を表示して終了
#
# リビジョンは削除しない。トラフィックの向き先を変えるだけ。
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-vcafe-admin-analytics}"
REGION="${REGION:-asia-northeast1}"
SERVICE_NAME="${SERVICE_NAME:-vcafe-dashboard}"
TARGET="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "${TARGET}" ]]; then
  echo "戻し先のリビジョンを指定してください。候補:"
  gcloud run revisions list --service="${SERVICE_NAME}" \
    --region="${REGION}" --project="${PROJECT_ID}" \
    --format='table(metadata.name, status.conditions[0].status, metadata.creationTimestamp)' \
    --limit=10
  exit 2
fi

echo "トラフィックを ${TARGET} へ戻します。"
gcloud run services update-traffic "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --to-revisions="${TARGET}=100" \
  --quiet

# Hosting は pinTag: true のため、Cloud Run 側だけでは戻らない。
firebase use "${PROJECT_ID}"
firebase deploy --only hosting --project "${PROJECT_ID}"

gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --project="${PROJECT_ID}" \
  --format='table(status.traffic.revisionName, status.traffic.percent, status.traffic.tag)'

SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --project="${PROJECT_ID}" --format='value(status.url)')"
bash "${SCRIPT_DIR}/smoke-test-revision.sh" "${SERVICE_URL}"
