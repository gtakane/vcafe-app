#!/usr/bin/env bash
# 手順3: 同期ジョブのプログラムだけを差し替える（環境変数・スケジュールは変えない）
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
cd "${DASHBOARD_DIR}"

if ! bash "${SYNC_DIR}/check-bigquery-schema.sh" >/dev/null 2>&1; then
  echo "BigQuery の列がそろっていません。先に手順2を実行してください。"; exit 1
fi

PREV=$(gcloud run jobs describe $JOB --region=$R --project=$P --format='value(spec.template.template.containers[0].image)')
IMG=$R-docker.pkg.dev/$P/cloud-run-source-deploy/$JOB:$(git rev-parse --short HEAD)
echo "現在のプログラム: ${PREV}"
echo "新しいプログラム: ${IMG}"
confirm "同期ジョブのプログラムを差し替えます（ビルドに数分かかります）。"

echo "${PREV}" > "${PREV_IMAGE_FILE}"
echo "# 戻し先を ${PREV_IMAGE_FILE} に保存しました"
gcloud builds submit --project=$P --region=$R --config=services/analytics-sync/cloudbuild.yaml --substitutions=_IMAGE=${IMG} .
gcloud run jobs update $JOB --region=$R --project=$P --image=${IMG}

echo
echo "→ 差し替え完了。手順4へ進めます:  bash ${HERE}/step4-backfill.sh"
echo "  （問題があったときの戻し方:  bash ${HERE}/rollback-job-image.sh ）"
