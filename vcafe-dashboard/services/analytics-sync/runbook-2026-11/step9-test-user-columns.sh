#!/usr/bin/env bash
# テストユーザーを区別する列を追加する（分析用BigQueryのみ。既存の行は変わらない）。
#   visits_raw / cheki_raw / payments_raw / presents_raw / bookings_raw / customers_raw … isTestUser
#   balance_snapshots … includesTestUsers（テストユーザーを含めた合計の行に true）
# この後、step3-update-job-image.sh → step10-import-test-users.sh の順に実行する。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
T="${P}.${DS}"
echo "# 列を追加します（既にあれば何もしません）"
for table in customers_raw visits_raw cheki_raw payments_raw presents_raw bookings_raw; do
  echo "  - ${table}.isTestUser"
  bq query --project_id=$P --use_legacy_sql=false --quiet "ALTER TABLE \`${T}.${table}\` ADD COLUMN IF NOT EXISTS isTestUser BOOL"
done
echo "  - balance_snapshots.includesTestUsers"
bq query --project_id=$P --use_legacy_sql=false --quiet "ALTER TABLE \`${T}.balance_snapshots\` ADD COLUMN IF NOT EXISTS includesTestUsers BOOL"
echo "→ 完了。次は step3-update-job-image.sh（同期プログラムの差し替え）です。"
