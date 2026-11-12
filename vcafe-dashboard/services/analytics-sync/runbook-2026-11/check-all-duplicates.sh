#!/usr/bin/env bash
# 課金以外の取り込みデータにも、全期間で同じ二重計上が無いかを確認する（読み取りのみ）
#   画面が使う *_current ビュー（重複除去後）で、同じ中身の行が2行以上あるかを年ごとに数える
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
bq query --project_id=$P --use_legacy_sql=false --format=pretty --max_rows=100 '
WITH v AS (SELECT "ご帰宅" AS kind, FORMAT_DATE("%Y", DATE(`at`, "Asia/Tokyo")) AS year, COUNT(*) - 1 AS extra
           FROM vcafe_analytics.visits_current GROUP BY customerId, maidId, `at`, year HAVING COUNT(*) > 1),
c AS (SELECT "チェキ", FORMAT_DATE("%Y", DATE(`at`, "Asia/Tokyo")), COUNT(*) - 1
      FROM (SELECT * EXCEPT(rn) FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY syncedAt DESC) AS rn FROM vcafe_analytics.cheki_raw) WHERE rn = 1)
      GROUP BY customerId, maidId, `at`, 2 HAVING COUNT(*) > 1),
p AS (SELECT "プレゼント", FORMAT_DATE("%Y", DATE(`at`, "Asia/Tokyo")), COUNT(*) - 1
      FROM vcafe_analytics.presents_current GROUP BY customerId, maidId, `at`, itemName, 2 HAVING COUNT(*) > 1),
s AS (SELECT "シフト", FORMAT_DATE("%Y", DATE(scheduledStart, "Asia/Tokyo")), COUNT(*) - 1
      FROM vcafe_analytics.shifts_current GROUP BY maidId, scheduledStart, 2 HAVING COUNT(*) > 1)
SELECT kind, year, SUM(extra) AS duplicated_rows FROM (SELECT * FROM v UNION ALL SELECT * FROM c UNION ALL SELECT * FROM p UNION ALL SELECT * FROM s)
GROUP BY kind, year ORDER BY kind, year'
echo "（何も表示されなければ、どのデータにも重複はありません）"
