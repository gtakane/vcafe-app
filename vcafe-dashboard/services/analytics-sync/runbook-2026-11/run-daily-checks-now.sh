#!/usr/bin/env bash
# 毎朝5時の処理（未使用残高の記録＋取りこぼしの検知と自動の取り込み直し）を、今すぐ1回だけ実行する
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
confirm "同期ジョブを1回だけ、毎朝5時の処理つきで実行します（数分かかります）。"
cleanup() { gcloud run jobs update $JOB --region=$R --project=$P --remove-env-vars=BALANCES >/dev/null || echo "!!! 設定を外せませんでした。restore-sync.sh を実行してください"; }
trap cleanup EXIT
gcloud run jobs update $JOB --region=$R --project=$P --update-env-vars=BALANCES=always >/dev/null
gcloud run jobs execute $JOB --region=$R --project=$P --wait
echo
echo "=== 取りこぼしの判定結果（直近7営業日） ==="
bq query --project_id=$P --use_legacy_sql=false --format=pretty '
SELECT REPLACE(checkName, "visits_daily_completeness:", "") AS day, status,
  JSON_VALUE(details, "$.production") AS production, JSON_VALUE(details, "$.dashboard") AS dashboard, JSON_VALUE(details, "$.repaired") AS repaired,
  JSON_VALUE(details, "$.expected") AS expected_excl_test, JSON_VALUE(details, "$.testUsers") AS test_users,
  JSON_VALUE(details, "$.testMaids") AS test_maids, JSON_VALUE(details, "$.unresolvedMaid") AS unresolved_maid
FROM vcafe_analytics.dq_results
WHERE STARTS_WITH(checkName, "visits_daily_completeness:")
  AND checkedAt = (SELECT MAX(checkedAt) FROM vcafe_analytics.dq_results WHERE STARTS_WITH(checkName, "visits_daily_completeness:"))
ORDER BY day'
echo "※ production は本番の全件（テストユーザー・テスト用メイドを含む）。取り込み直した日は"
echo "   expected_excl_test（テストの分を除いた件数）と dashboard を比べて判定します。"
echo "   unresolved_maid はメイドを特定できず取り込めなかった件数（実データの欠け）です。"
