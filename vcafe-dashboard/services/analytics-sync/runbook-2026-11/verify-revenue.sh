#!/usr/bin/env bash
# 第2段階の確認: 新しい計算方法での月別売上（税込）を、経理の数字と並べて表示する（読み取りのみ）
#   bash verify-revenue.sh 2026-10   （既定は先月）
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
MONTH=${1:-$(date -d "$(date +%Y-%m-01) -1 month" +%Y-%m)}
START="${MONTH}-01"; END=$(date -d "${START} +1 month -1 day" +%F)

bq query --project_id=$P --use_legacy_sql=false --format=pretty --parameter="s:DATE:${START}" --parameter="e:DATE:${END}" '
WITH fc AS (
  SELECT customerId, maidId, DATE(TIMESTAMP_SUB(`at`, INTERVAL 2 HOUR), "Asia/Tokyo") AS d, COUNT(DISTINCT id) AS n
  FROM vcafe_analytics.cheki_raw
  WHERE DATE(`at`) BETWEEN DATE_SUB(@s, INTERVAL 1 DAY) AND DATE_ADD(@e, INTERVAL 1 DAY) AND chekiType IN ("birthdayGift", "birthdayGiftSigned")
  GROUP BY 1, 2, 3
), v AS (
  SELECT v.*, IF(v.cheki > 0, LEAST(v.cheki, COALESCE(fc.n, 0)), 0) AS freeCheki
  FROM vcafe_analytics.visits_current_range(@s, @e, NULL) v
  LEFT JOIN fc ON fc.customerId = v.customerId AND fc.maidId = v.maidId AND fc.d = DATE(TIMESTAMP_SUB(v.`at`, INTERVAL 2 HOUR), "Asia/Tokyo")
), paid AS (SELECT * FROM v WHERE type NOT IN ("free", "trial", "reservation")),
b AS (
  SELECT * FROM vcafe_analytics.bookings_current
  WHERE NOT COALESCE(canceled, FALSE) AND DATE(TIMESTAMP_SUB(`at`, INTERVAL 2 HOUR), "Asia/Tokyo") BETWEEN @s AND @e
)
SELECT "ご帰宅" AS src,
  ROUND(SUM(IF(billedCoinVendor = "apple", billedCoin, 0)) * 1.19) AS apple,
  ROUND(SUM(IF(billedCoinVendor = "google", billedCoin, 0)) * 1.19) AS google,
  ROUND(SUM(IF(billedCoinVendor IS NULL, billedCoin, 0)) * 1.19) AS coin_unknown,
  ROUND(SUM(billedRewardPoint) * 1.1) AS reward_point,
  SUM(CASE ticketId WHEN "gokitaku30minutes" THEN 850 WHEN "premiumGokitaku1" THEN 960 WHEN "luckyGokitaku" THEN 650 ELSE 0 END * COALESCE(usedTicketCount, 1)) AS ticket,
  (SELECT SUM(cheki - freeCheki) FROM v) * 500 AS paid_cheki,
  COUNTIF(usedTicketCount IS NULL AND ticketId != "ATCOIN") AS ticket_rows_without_count
FROM paid
UNION ALL
SELECT "予約・招待",
  ROUND(SUM(IF(coinVendor = "apple", coin, 0)) * 1.19), ROUND(SUM(IF(coinVendor = "google", coin, 0)) * 1.19),
  ROUND(SUM(IF(coinVendor IS NULL, coin, 0)) * 1.19), ROUND(SUM(rewardPoint) * 1.1), 0, 0, COUNT(*)
FROM b'
if [[ "${MONTH}" == "2026-10" ]]; then
  echo "経理（2026年10月・税込）: Apple 676,818 / Google 192,227 / Stripe 2,420,469 / 合計 3,289,514"
  echo "  比較の目安: Apple+Google+coin_unknown（両行の合計）↔ Apple+Google、reward_point+ticket+paid_cheki ↔ Stripe"
  echo "  ※ Apple/Google は、コインでのアイテム購入・有効期限切れの分だけ経理の方が大きくなる（月初残高の記録で別途合わせる）"
fi
