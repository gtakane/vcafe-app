#!/usr/bin/env bash
# 同期ジョブのプログラムだけを差し替える（環境変数・スケジュールは変えない）。
# 差し替え後は、次の毎時の同期から新しいプログラムで動く。取り込み直し（step4）は行わない。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
cd "${DASHBOARD_DIR}"

if ! SCHEMA_OUT=$(bash "${SYNC_DIR}/check-bigquery-schema.sh" 2>&1); then
  echo "${SCHEMA_OUT}" | grep -E "★|BigQuery に" || echo "${SCHEMA_OUT}" | tail -5
  echo
  echo "BigQuery の表・列がそろっていないため、差し替えを中止しました（何も変更していません）。"
  echo "手順書の付録の初回設定（step9・step11・step12）が済んでいるか確認してください。"
  exit 1
fi

PREV=$(current_job_image)
IMG=$R-docker.pkg.dev/$P/cloud-run-source-deploy/$JOB:$(git rev-parse --short HEAD)
[[ -n "${PREV}" ]] || { echo "現在のプログラム名を読み取れませんでした。この出力を貼ってください。"; exit 1; }
echo "現在のプログラム: ${PREV}"
echo "新しいプログラム: ${IMG}"
confirm "同期ジョブのプログラムを差し替えます（ビルドに数分かかります）。"

echo "${PREV}" > "${PREV_IMAGE_FILE}"
echo "# 戻し先を ${PREV_IMAGE_FILE} に保存しました"
gcloud builds submit --project=$P --region=$R --config=services/analytics-sync/cloudbuild.yaml --substitutions=_IMAGE=${IMG} .
gcloud run jobs update $JOB --region=$R --project=$P --image=${IMG}

echo
echo "→ 差し替え完了。次の毎時の同期から新しいプログラムで動きます。"
echo "  問題があったときの戻し方:  bash ${HERE}/rollback-job-image.sh"
