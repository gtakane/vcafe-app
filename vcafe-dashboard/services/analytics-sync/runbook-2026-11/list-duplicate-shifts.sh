#!/usr/bin/env bash
# 本番データ上で二重に登録されているシフト（同じメイド・同じ開始時刻）を一覧にする（読み取りのみ）
#   bash list-duplicate-shifts.sh 2026
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
YEAR=${1:-2026}
bq query --project_id=$P --use_legacy_sql=false --format=pretty --parameter="y::${YEAR}" '
SELECT FORMAT_TIMESTAMP("%Y-%m-%d %H:%M", s.scheduledStart, "Asia/Tokyo") AS start_jst,
  STRING_AGG(DISTINCT FORMAT_TIMESTAMP("%H:%M", s.scheduledEnd, "Asia/Tokyo"), " / ") AS end_jst,
  ANY_VALUE(m.name) AS maid, COUNT(*) AS registered
FROM vcafe_analytics.shifts_current s
LEFT JOIN vcafe_analytics.maids_current m ON m.id = s.maidId
WHERE FORMAT_TIMESTAMP("%Y", s.scheduledStart, "Asia/Tokyo") = @y
GROUP BY s.maidId, s.scheduledStart HAVING COUNT(*) > 1
ORDER BY start_jst'
