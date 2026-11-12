#!/usr/bin/env bash
# 毎月手作業で作っている月次指標CSVと、分析用BigQueryから出せる値を並べて、各指標の定義を確かめる（読み取りのみ）。
#   bash compare-monthly-kpi.sh
# 「CSV」の行が手元のCSVの値。その下の候補のうち、CSVと一致する行がその指標の定義。
# 対象は 2026年4月〜10月（営業日＝JST 2:00〜翌1:59 で月を区切る）。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

bq query --project_id=$P --use_legacy_sql=false --format=pretty --max_rows=200 '
WITH months AS (
  SELECT FORMAT_DATE("%Y-%m", d) AS ym FROM UNNEST(GENERATE_DATE_ARRAY("2026-04-01", "2026-10-01", INTERVAL 1 MONTH)) d
),
v AS (
  SELECT customerId, type, COALESCE(weight, 1) AS weight, COALESCE(cheki, 0) AS cheki, revenue,
    FORMAT_DATE("%Y-%m", DATE(TIMESTAMP_SUB(`at`, INTERVAL 2 HOUR), "Asia/Tokyo")) AS ym
  FROM `'$P'.'$DS'.visits_current_range`("2026-04-01", "2026-10-31", NULL)
),
visit_month AS (
  SELECT ym,
    COUNT(*) AS cnt_all, COUNTIF(type != "trial") AS cnt_nontrial,
    SUM(weight) AS w_all, SUM(IF(type != "trial", weight, 0)) AS w_nontrial,
    COUNTIF(type = "trial") AS trial_visits, COUNTIF(type = "reservation") AS reservation_visits,
    COUNT(DISTINCT customerId) AS uu_all,
    COUNT(DISTINCT IF(type != "trial", customerId, NULL)) AS uu_nontrial,
    COUNT(DISTINCT IF(type = "trial", customerId, NULL)) AS uu_trial,
    SUM(cheki) AS cheki, SUM(revenue) AS revenue
  FROM v GROUP BY ym
),
per_user AS (
  SELECT ym, customerId, COUNTIF(type != "trial") AS n, SUM(IF(type != "trial", weight, 0)) AS wn
  FROM v GROUP BY ym, customerId HAVING n > 0
),
buckets AS (
  SELECT ym,
    COUNTIF(n = 1) AS c_b1u,
    COUNTIF(n BETWEEN 2 AND 4) AS c_b2u, SUM(IF(n BETWEEN 2 AND 4, n, 0)) AS c_b2v,
    COUNTIF(n BETWEEN 5 AND 19) AS c_b3u, SUM(IF(n BETWEEN 5 AND 19, n, 0)) AS c_b3v,
    COUNTIF(n BETWEEN 20 AND 49) AS c_b4u, SUM(IF(n BETWEEN 20 AND 49, n, 0)) AS c_b4v,
    COUNTIF(n >= 50) AS c_b5u, SUM(IF(n >= 50, n, 0)) AS c_b5v,
    COUNTIF(wn = 1) AS w_b1u,
    COUNTIF(wn BETWEEN 2 AND 4) AS w_b2u, SUM(IF(wn BETWEEN 2 AND 4, wn, 0)) AS w_b2v,
    COUNTIF(wn BETWEEN 5 AND 19) AS w_b3u, SUM(IF(wn BETWEEN 5 AND 19, wn, 0)) AS w_b3v,
    COUNTIF(wn BETWEEN 20 AND 49) AS w_b4u, SUM(IF(wn BETWEEN 20 AND 49, wn, 0)) AS w_b4v,
    COUNTIF(wn >= 50) AS w_b5u, SUM(IF(wn >= 50, wn, 0)) AS w_b5v
  FROM per_user GROUP BY ym
),
maid_report AS (
  SELECT CONCAT(SUBSTR(REGEXP_REPLACE(month, r"[^0-9]", ""), 1, 4), "-", SUBSTR(REGEXP_REPLACE(month, r"[^0-9]", ""), 5, 2)) AS ym,
    SUM(totalVisits) AS r_visits, SUM(totalOtameshi) AS r_otameshi, SUM(totalPhoto) AS r_photo,
    SUM(totalBirthdayPhotos) AS r_bday_photo, SUM(totalPresents) AS r_presents, SUM(totalPresentsPrice) AS r_presents_yen,
    SUM(totalWorkTimes) AS r_work, SUM(totalWorkTimesReserve) AS r_work_reserve, SUM(totalReservation) AS r_reservation
  FROM `'$P'.'$DS'.maid_monthly_current` GROUP BY ym
),
members AS (
  SELECT m.ym,
    COUNTIF(c.registeredAt < TIMESTAMP(DATE_ADD(PARSE_DATE("%Y-%m", m.ym), INTERVAL 1 MONTH), "Asia/Tokyo")) AS members,
    COUNTIF(FORMAT_TIMESTAMP("%Y-%m", c.registeredAt, "Asia/Tokyo") = m.ym) AS new_members,
    COUNTIF(c.registeredAt IS NULL) AS members_no_date
  FROM months m CROSS JOIN `'$P'.'$DS'.customers_current` c GROUP BY m.ym
),
shifts AS (
  SELECT FORMAT_DATE("%Y-%m", DATE(TIMESTAMP_SUB(scheduledStart, INTERVAL 2 HOUR), "Asia/Tokyo")) AS ym,
    SUM(TIMESTAMP_DIFF(scheduledEnd, scheduledStart, MINUTE)) / 60 AS sched_h,
    SUM(IF(actualStart IS NOT NULL AND actualEnd IS NOT NULL, TIMESTAMP_DIFF(actualEnd, actualStart, MINUTE), 0)) / 60 AS actual_h
  FROM `'$P'.'$DS'.shifts_current_range`("2026-04-01", "2026-10-31", NULL) GROUP BY ym
),
ours AS (
  SELECT m.ym,
    CAST(vm.cnt_all AS FLOAT64) AS a1, CAST(vm.cnt_nontrial AS FLOAT64) AS a2, CAST(vm.w_all AS FLOAT64) AS a3, CAST(vm.w_nontrial AS FLOAT64) AS a4, CAST(r.r_visits AS FLOAT64) AS a5,
    CAST(vm.cheki AS FLOAT64) AS f1, CAST(r.r_photo AS FLOAT64) AS f2, CAST(r.r_bday_photo AS FLOAT64) AS f3,
    CAST(r.r_presents_yen AS FLOAT64) AS p1, CAST(r.r_presents AS FLOAT64) AS p2,
    CAST(vm.uu_all AS FLOAT64) AS u1, CAST(vm.uu_nontrial AS FLOAT64) AS u2,
    CAST(mb.members AS FLOAT64) AS k1, CAST(mb.new_members AS FLOAT64) AS k2, CAST(mb.members_no_date AS FLOAT64) AS k3,
    CAST(vm.trial_visits AS FLOAT64) AS t1, CAST(vm.uu_trial AS FLOAT64) AS t2, CAST(r.r_otameshi AS FLOAT64) AS t3,
    CAST(b.c_b1u AS FLOAT64) AS c1, CAST(b.c_b2u AS FLOAT64) AS c2, CAST(b.c_b2v AS FLOAT64) AS c3, CAST(b.c_b3u AS FLOAT64) AS c4, CAST(b.c_b3v AS FLOAT64) AS c5,
    CAST(b.c_b4u AS FLOAT64) AS c6, CAST(b.c_b4v AS FLOAT64) AS c7, CAST(b.c_b5u AS FLOAT64) AS c8, CAST(b.c_b5v AS FLOAT64) AS c9,
    CAST(b.w_b1u AS FLOAT64) AS w1, CAST(b.w_b2u AS FLOAT64) AS w2, CAST(b.w_b2v AS FLOAT64) AS w3, CAST(b.w_b3u AS FLOAT64) AS w4, CAST(b.w_b3v AS FLOAT64) AS w5,
    CAST(b.w_b4u AS FLOAT64) AS w6, CAST(b.w_b4v AS FLOAT64) AS w7, CAST(b.w_b5u AS FLOAT64) AS w8, CAST(b.w_b5v AS FLOAT64) AS w9,
    ROUND(s.sched_h, 1) AS h1, ROUND(s.actual_h, 1) AS h2, CAST(r.r_work AS FLOAT64) AS h3, CAST(r.r_work_reserve AS FLOAT64) AS h4,
    ROUND(vm.revenue) AS s1
  FROM months m
  LEFT JOIN visit_month vm USING (ym) LEFT JOIN buckets b USING (ym) LEFT JOIN maid_report r USING (ym)
  LEFT JOIN members mb USING (ym) LEFT JOIN shifts s USING (ym)
),
-- 手元のCSV（2026年4月〜10月）の値
csv AS (
  SELECT * FROM UNNEST([
    STRUCT("2026-04" AS ym, 3774.0 AS a0, 862.0 AS f0, 36900.0 AS p0, 224.0 AS u0, 5561.0 AS k0, 38.0 AS k9, 10.0 AS t0, 53.0 AS c1, 54.0 AS c2, 156.0 AS c3, 66.0 AS c4, 630.0 AS c5, 32.0 AS c6, 1032.0 AS c7, 19.0 AS c8, 1463.0 AS c9, 1434.0 AS h0, 3256979.0 AS s0),
    STRUCT("2026-05", 3996.0, 820.0, 30650.0, 250.0, 5607.0, 46.0, 18.0, 65.0, 64.0, 176.0, 72.0, 802.0, 29.0, 976.0, 20.0, 1547.0, 1413.0, 3186969.0),
    STRUCT("2026-06", 3673.0, 723.0, 22150.0, 231.0, 5607.0, NULL, 14.0, 53.0, 59.0, 56.0, 68.0, 717.0, 38.0, 1272.0, 20.0, 1547.0, 1400.0, 2973924.0),
    STRUCT("2026-07", 3967.0, 938.0, 40800.0, 232.0, NULL, NULL, 20.0, 59.0, 55.0, 146.0, 63.0, 663.0, 39.0, 1238.0, 16.0, 1344.0, 1353.0, 3591234.0),
    STRUCT("2026-08", 4001.0, 780.0, 30800.0, 214.0, NULL, NULL, 7.0, 52.0, 52.0, 136.0, 56.0, 575.0, 31.0, 1069.0, 23.0, 1832.0, 1334.0, 3366295.0),
    STRUCT("2026-09", 3719.0, 773.0, 21350.0, 218.0, NULL, NULL, 11.0, 58.0, 45.0, 120.0, 65.0, 582.0, 28.0, 931.0, 21.0, 1768.0, 1333.0, 2874447.0),
    STRUCT("2026-10", 3536.0, 807.0, 21300.0, NULL, NULL, NULL, 15.0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
  ])
),
long AS (
  SELECT ym, metric, value FROM ours UNPIVOT INCLUDE NULLS (value FOR metric IN (
    a1 AS "01b 延べ客数? 件数（全部）", a2 AS "01c 延べ客数? 件数（お試し除く）", a3 AS "01d 延べ客数? 20分換算（全部）",
    a4 AS "01e 延べ客数? 20分換算（お試し除く）", a5 AS "01f 延べ客数? メイド月報 totalVisits 合計",
    f1 AS "02b フォト? 記念撮影（全部）", f2 AS "02c フォト? メイド月報 totalPhoto", f3 AS "02d   (参考)月報 誕生日フォト",
    p1 AS "03b プレゼント? 月報 totalPresentsPrice(円)", p2 AS "03c   (参考)月報 プレゼント個数",
    u1 AS "04b UU? ご帰宅した人（全部）", u2 AS "04c UU? ご帰宅した人（お試し除く）",
    k1 AS "05b 会員数? 月末までの登録者（テスト除く）", k2 AS "06b 増分? その月の登録者", k3 AS "05c   (参考)登録日の無い会員",
    t1 AS "07b お試し? お試しの件数", t2 AS "07c お試し? お試しをした人数", t3 AS "07d お試し? 月報 totalOtameshi",
    c1 AS "08b 1回? 人数（件数・お試し除く）", w1 AS "08c 1回? 人数（20分換算）",
    c2 AS "09b 2〜4回? 人数（件数）", w2 AS "09c 2〜4回? 人数（20分換算）",
    c3 AS "10b 2〜4回総数? 件数", w3 AS "10c 2〜4回総数? 20分換算",
    c4 AS "11b 5〜19回? 人数（件数）", w4 AS "11c 5〜19回? 人数（20分換算）",
    c5 AS "12b 5〜19回総数? 件数", w5 AS "12c 5〜19回総数? 20分換算",
    c6 AS "13b 20〜49回? 人数（件数）", w6 AS "13c 20〜49回? 人数（20分換算）",
    c7 AS "14b 20〜49回総数? 件数", w7 AS "14c 20〜49回総数? 20分換算",
    c8 AS "15b 50回〜? 人数（件数）", w8 AS "15c 50回〜? 人数（20分換算）",
    c9 AS "16b 50回〜総数? 件数", w9 AS "16c 50回〜総数? 20分換算",
    h1 AS "17b お給仕時間? シフト予定(h)", h2 AS "17c お給仕時間? 出退勤の実績(h)", h3 AS "17d お給仕時間? 月報 totalWorkTimes", h4 AS "17e   (参考)月報 totalWorkTimesReserve",
    s1 AS "18b 売上? ダッシュボードのご帰宅売上(参考)"
  ))
  UNION ALL
  SELECT ym, metric, value FROM csv UNPIVOT INCLUDE NULLS (value FOR metric IN (
    a0 AS "01a 延べ客数【CSV】", f0 AS "02a フォト【CSV】", p0 AS "03a プレゼント【CSV】", u0 AS "04a UU【CSV】",
    k0 AS "05a 会員数【CSV】", k9 AS "06a 増分【CSV】", t0 AS "07a お試し【CSV】",
    c1 AS "08a 1回【CSV】", c2 AS "09a 2〜4回【CSV】", c3 AS "10a 2〜4回総数【CSV】", c4 AS "11a 5〜19回【CSV】", c5 AS "12a 5〜19回総数【CSV】",
    c6 AS "13a 20〜49回【CSV】", c7 AS "14a 20〜49回総数【CSV】", c8 AS "15a 50回〜【CSV】", c9 AS "16a 50回〜総数【CSV】",
    h0 AS "17a お給仕時間【CSV】", s0 AS "18a 売上【CSV】"
  ))
)
SELECT * FROM long
PIVOT (ANY_VALUE(value) FOR ym IN ("2026-04" AS apr, "2026-05" AS may, "2026-06" AS jun, "2026-07" AS jul, "2026-08" AS aug, "2026-09" AS sep, "2026-10" AS oct))
ORDER BY metric'
