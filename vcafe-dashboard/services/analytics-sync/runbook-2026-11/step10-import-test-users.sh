#!/usr/bin/env bash
# テストユーザーの過去分（ご帰宅・撮影・プレゼント・課金・会員）と、予約・招待、未使用残高を取り込む。
# 本番は読み取りのみ。分析側は追記のみで、何度実行しても二重にはならない。
# 先に step9-test-user-columns.sh と step3-update-job-image.sh を済ませておくこと。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
confirm "同期ジョブを1回だけ、テストユーザーの過去分の取り込みつきで実行します（数分かかります）。"
cleanup() {
  gcloud run jobs update $JOB --region=$R --project=$P --remove-env-vars=SYNC_TEST_USERS,BOOKINGS,BALANCES >/dev/null \
    || echo "!!! 設定を外せませんでした。restore-sync.sh を実行してください"
}
trap cleanup EXIT
gcloud run jobs update $JOB --region=$R --project=$P --update-env-vars=SYNC_TEST_USERS=true,BOOKINGS=always,BALANCES=always >/dev/null
gcloud run jobs execute $JOB --region=$R --project=$P --wait

echo
echo "=== 取り込んだテストユーザーの記録（テストユーザー分／全体） ==="
bq query --project_id=$P --use_legacy_sql=false --format=pretty "
SELECT 'ご帰宅' AS kind, COUNTIF(isTestUser) AS test_rows, COUNT(*) AS all_rows FROM \`${P}.${DS}.visits_current\`
UNION ALL SELECT '会員', COUNTIF(isTestUser), COUNT(*) FROM \`${P}.${DS}.customers_current\`
UNION ALL SELECT '予約・招待', COUNTIF(isTestUser), COUNT(*) FROM \`${P}.${DS}.bookings_current\`
UNION ALL SELECT '残高の記録（直近）', COUNTIF(includesTestUsers), COUNT(*) FROM \`${P}.${DS}.balance_snapshots\` WHERE snapshotAt > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)"
echo "→ test_rows が0でなければ取り込めています。残高の記録は、含めた合計と除いた合計の2行が増えます。"
