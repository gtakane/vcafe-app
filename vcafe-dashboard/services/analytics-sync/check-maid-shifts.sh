#!/usr/bin/env bash
# 特定メイドの「お給仕時間が少なすぎる」原因を調べる（BigQueryへの読み取りのみ）。
#
#   bash check-maid-shifts.sh 人形まゆら 2026-07-01 2026-07-28
#
# 稼働率が100%を超える場合、次のどちらかが原因になりやすい:
#   A) 打刻(actualStart/actualEnd)が無いシフトが多い → 予定時刻で補完すべき
#   B) シフトの maidId が "nickname:..." になっており、ご帰宅側のIDと一致しない
set -uo pipefail

PROJECT_ID="${PROJECT_ID:-vcafe-admin-analytics}"
DS="${BIGQUERY_DATASET:-vcafe_analytics}"
NAME="${1:?メイド名を指定してください}"
START="${2:-2026-07-01}"
END="${3:-2026-07-31}"

echo "# project=${PROJECT_ID} dataset=${DS} メイド=${NAME} 期間=${START}〜${END}"
q() { bq --project_id="${PROJECT_ID}" query --use_legacy_sql=false --format=pretty "$1"; }

echo
echo "== 1) このメイドのIDと、ご帰宅／シフトの件数 =="
q "WITH m AS (
     SELECT id, name FROM \`${PROJECT_ID}.${DS}.maids_current\` WHERE name = '${NAME}'
   )
   SELECT m.id, m.name,
     (SELECT COUNT(*) FROM \`${PROJECT_ID}.${DS}.visits_current\` v
      WHERE v.maidId = m.id AND DATE(TIMESTAMP_SUB(v.\`at\`, INTERVAL 2 HOUR), 'Asia/Tokyo') BETWEEN '${START}' AND '${END}') AS visits,
     (SELECT COUNT(*) FROM \`${PROJECT_ID}.${DS}.shifts_current\` s
      WHERE s.maidId = m.id AND DATE(TIMESTAMP_SUB(s.scheduledStart, INTERVAL 2 HOUR), 'Asia/Tokyo') BETWEEN '${START}' AND '${END}') AS shifts
   FROM m"

echo
echo "== 2) ★A: 打刻の有無（actualStart/actualEnd が NULL のシフトは打刻漏れ） =="
q "SELECT COUNT(*) AS shifts,
          COUNTIF(actualStart IS NULL) AS no_start,
          COUNTIF(actualEnd IS NULL) AS no_end,
          COUNTIF(actualStart IS NOT NULL AND actualEnd IS NOT NULL) AS punched,
          ROUND(SUM(TIMESTAMP_DIFF(scheduledEnd, scheduledStart, MINUTE))) AS scheduled_minutes,
          ROUND(SUM(IF(actualStart IS NOT NULL AND actualEnd IS NOT NULL,
                       TIMESTAMP_DIFF(actualEnd, actualStart, MINUTE), 0))) AS punched_minutes
   FROM \`${PROJECT_ID}.${DS}.shifts_current\` s
   JOIN \`${PROJECT_ID}.${DS}.maids_current\` m ON m.id = s.maidId
   WHERE m.name = '${NAME}'
     AND DATE(TIMESTAMP_SUB(s.scheduledStart, INTERVAL 2 HOUR), 'Asia/Tokyo') BETWEEN '${START}' AND '${END}'"

echo
echo "== 3) ★B: 同名で maidId が複数ある（nickname: フォールバック）か =="
q "SELECT id, name, status FROM \`${PROJECT_ID}.${DS}.maids_current\` WHERE name = '${NAME}' OR id = CONCAT('nickname:', '${NAME}')"

echo
echo "== 4) シフト明細（打刻状況の実例・20件） =="
q "SELECT DATETIME(s.scheduledStart, 'Asia/Tokyo') AS sched_start_jst,
          DATETIME(s.scheduledEnd, 'Asia/Tokyo') AS sched_end_jst,
          DATETIME(s.actualStart, 'Asia/Tokyo') AS actual_start_jst,
          DATETIME(s.actualEnd, 'Asia/Tokyo') AS actual_end_jst
   FROM \`${PROJECT_ID}.${DS}.shifts_current\` s
   JOIN \`${PROJECT_ID}.${DS}.maids_current\` m ON m.id = s.maidId
   WHERE m.name = '${NAME}'
     AND DATE(TIMESTAMP_SUB(s.scheduledStart, INTERVAL 2 HOUR), 'Asia/Tokyo') BETWEEN '${START}' AND '${END}'
   ORDER BY s.scheduledStart DESC LIMIT 20"

echo
echo "== 5) ★C: シフト時間の外で発生したご帰宅（種別ごと） =="
echo "   予約ご帰宅は通常シフト(workshifts)の外で行われるため、分母に含まれず稼働率を押し上げます"
q "WITH m AS (SELECT id FROM \`${PROJECT_ID}.${DS}.maids_current\` WHERE name = '${NAME}'),
        v AS (
          SELECT v.\`at\`, v.type, v.minutes
          FROM \`${PROJECT_ID}.${DS}.visits_current\` v JOIN m ON m.id = v.maidId
          WHERE DATE(TIMESTAMP_SUB(v.\`at\`, INTERVAL 2 HOUR), 'Asia/Tokyo') BETWEEN '${START}' AND '${END}'
        ),
        s AS (
          SELECT COALESCE(s.actualStart, s.scheduledStart) AS st,
                 COALESCE(s.actualEnd, s.scheduledEnd) AS en
          FROM \`${PROJECT_ID}.${DS}.shifts_current\` s JOIN m ON m.id = s.maidId
          WHERE DATE(TIMESTAMP_SUB(s.scheduledStart, INTERVAL 2 HOUR), 'Asia/Tokyo') BETWEEN '${START}' AND '${END}'
        )
   SELECT v.type,
          COUNT(*) AS visits,
          ROUND(SUM(v.minutes)) AS total_minutes,
          COUNTIF(NOT EXISTS (SELECT 1 FROM s WHERE v.\`at\` >= s.st AND v.\`at\` < s.en)) AS outside_shift,
          ROUND(SUM(IF(NOT EXISTS (SELECT 1 FROM s WHERE v.\`at\` >= s.st AND v.\`at\` < s.en), v.minutes, 0))) AS outside_minutes
   FROM v GROUP BY v.type ORDER BY visits DESC"

echo
echo "== 6) 参考: 月次実績の お給仕時間 と お給仕時間(予約) =="
q "SELECT r.month, ROUND(r.totalWorkTimes, 2) AS work_hours,
          ROUND(r.totalWorkTimesReserve, 2) AS work_hours_reserve,
          r.totalVisits, r.totalReservation
   FROM \`${PROJECT_ID}.${DS}.maid_monthly_current\` r
   JOIN \`${PROJECT_ID}.${DS}.maid_profiles_current\` p ON p.id = r.maidId
   WHERE p.nickname = '${NAME}' AND r.month >= FORMAT_DATE('%Y%m', DATE('${START}'))
   ORDER BY r.month DESC LIMIT 6"

echo
echo "----"
echo "読み方:"
echo "・2) の no_start / no_end が多い → 打刻漏れ。予定時刻で補完する修正で解決（適用済み）"
echo "・3) に2行出る → シフトとご帰宅で maidId が分かれている。同期側の名寄せが必要"
echo "・1) の shifts が 0 → そのメイドのシフトが同期されていない（別途調査）"
echo "・5) で type=reservation の outside_shift が多い → 予約はシフト外。稼働率の分子から外すのが妥当"
echo "・5) で type=paid の outside_shift が多い → シフトの同期漏れ。1)3)と併せて要調査"
echo "・6) の work_hours_reserve が大きい → 予約稼働が別管理であることの裏付け"
