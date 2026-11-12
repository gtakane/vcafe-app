#!/usr/bin/env bash
# 手順2: BigQuery に列を3つ追加する（分析用プロジェクトのみ。既存データは変わらない）
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

echo "# visits_raw に entryType / billedCoinVendor / usedTicketCount を追加します（既にあれば何もしません）"
bq query --project_id=$P --use_legacy_sql=false --quiet \
  'ALTER TABLE `vcafe-admin-analytics.vcafe_analytics.visits_raw` ADD COLUMN IF NOT EXISTS entryType STRING, ADD COLUMN IF NOT EXISTS billedCoinVendor STRING, ADD COLUMN IF NOT EXISTS usedTicketCount INT64'

echo
echo "=== 全テーブルの列の照合 ==="
if bash "${SYNC_DIR}/check-bigquery-schema.sh"; then
  echo
  echo "→ OK。手順3へ進めます:  bash ${HERE}/step3-update-job-image.sh"
else
  echo
  echo "→ 不足している列があります。手順3へ進まず、この出力を貼ってください。apply-schema.sh は実行しないでください。"
  exit 1
fi
