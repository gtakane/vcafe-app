#!/usr/bin/env bash
# テストユーザーの記録が分析用BigQueryに入っているかを確認する（読み取りのみ）。
# 「含む」にしても数値が変わらないときに使う。test_rows が0なら、まだ取り込まれていない。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
echo "=== 表ごとのテストユーザーの行数 ==="
bq query --project_id=$P --use_legacy_sql=false --format=pretty "
SELECT '会員' AS kind, COUNTIF(isTestUser) AS test_rows, COUNT(*) AS all_rows FROM \`${P}.${DS}.customers_current\`
UNION ALL SELECT 'ご帰宅（全期間）', COUNTIF(isTestUser), COUNT(*) FROM \`${P}.${DS}.visits_current\`
UNION ALL SELECT '課金（全期間）', COUNTIF(isTestUser), COUNT(*) FROM \`${P}.${DS}.payments_current\`
UNION ALL SELECT '予約・招待', COUNTIF(isTestUser), COUNT(*) FROM \`${P}.${DS}.bookings_current\`
UNION ALL SELECT '残高の記録', COUNTIF(includesTestUsers), COUNT(*) FROM \`${P}.${DS}.balance_snapshots\`"
echo
echo "=== 月ごとのテストユーザーのご帰宅（直近6か月・営業日） ==="
bq query --project_id=$P --use_legacy_sql=false --format=pretty "
SELECT FORMAT_DATE('%Y-%m', DATE(TIMESTAMP_SUB(\`at\`, INTERVAL 2 HOUR), 'Asia/Tokyo')) AS month,
  COUNTIF(isTestUser) AS test_visits, COUNT(DISTINCT IF(isTestUser, customerId, NULL)) AS test_users, COUNT(*) AS all_visits
FROM \`${P}.${DS}.visits_current_range\`(DATE_SUB(CURRENT_DATE('Asia/Tokyo'), INTERVAL 6 MONTH), CURRENT_DATE('Asia/Tokyo'), NULL)
GROUP BY month ORDER BY month"
echo
echo "=== 同期ジョブがテストユーザーを取り込む版か ==="
IMAGE=$(current_job_image)
TAG=${IMAGE##*:}
echo "同期ジョブのプログラム: ${IMAGE}"
if git -C "${DASHBOARD_DIR}" merge-base --is-ancestor 5d88a9c "${TAG}" 2>/dev/null; then
  echo "→ テストユーザーを取り込む版です"
else
  echo "→ テストユーザーを取り込まない古い版です。step3-update-job-image.sh → step10-import-test-users.sh を実行してください"
fi
gcloud run jobs describe $JOB --region=$R --project=$P --format=yaml | grep -c "SYNC_TEST_USERS" >/dev/null && echo "※ SYNC_TEST_USERS が残っています（restore-sync.sh で外してください）" || true
