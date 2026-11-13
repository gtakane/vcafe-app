#!/usr/bin/env bash
# 毎朝5時の取りこぼし判定の、最新の結果を表示する（読み取りのみ・何も変更しない）。
#   status: pass … 問題なし / warn … 少し足りない / fail … 大きく足りない（丸ごと欠け、または2割以上）
#   足りない日は毎朝5時に自動で取り込み直す。取り込み直した日は repaired に件数が入る。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
bq query --project_id=$P --use_legacy_sql=false --format=pretty '
SELECT FORMAT_TIMESTAMP("%Y-%m-%d %H:%M", checkedAt, "Asia/Tokyo") AS checked_jst,
  REPLACE(checkName, "visits_daily_completeness:", "") AS day, status,
  JSON_VALUE(details, "$.production") AS production, JSON_VALUE(details, "$.dashboard") AS dashboard, JSON_VALUE(details, "$.repaired") AS repaired,
  JSON_VALUE(details, "$.expected") AS expected_excl_test, JSON_VALUE(details, "$.testMaids") AS test_maids, JSON_VALUE(details, "$.unresolvedMaid") AS unresolved_maid
FROM vcafe_analytics.dq_results
WHERE STARTS_WITH(checkName, "visits_daily_completeness:")
  AND checkedAt = (SELECT MAX(checkedAt) FROM vcafe_analytics.dq_results WHERE STARTS_WITH(checkName, "visits_daily_completeness:"))
ORDER BY day'
echo "※ status がすべて pass なら問題ありません。warn・fail があれば、この出力を貼ってください。"
echo "※ checked_jst が2日以上前なら、毎朝の処理が動いていません。check-setup.sh を実行してください。"
