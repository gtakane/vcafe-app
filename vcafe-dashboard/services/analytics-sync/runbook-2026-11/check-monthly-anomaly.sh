#!/usr/bin/env bash
# 月ごとの課金額・利用額が膨らんでいないかを、要素ごとに切り分ける（読み取りのみ）
#   未完了の決済 / テストユーザーの混入 / 重複 / 要素別の内訳
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
FROM=${1:-2025-12-01}; TO=${2:-2026-11-30}

echo "=== 課金額（課金台帳） 月×決済の状態 ==="
echo "    succeeded=支払日あり / amount-only=支払日なし（決済の依頼のみで未完了の可能性） / 会員外=テストユーザー等の混入"
bq query --project_id=$P --use_legacy_sql=false --format=pretty --max_rows=100 --parameter="f:DATE:${FROM}" --parameter="t:DATE:${TO}" '
WITH p AS (SELECT * FROM vcafe_analytics.payments_current_range(@f, @t) WHERE DATE(`at`, "Asia/Tokyo") BETWEEN @f AND @t),
c AS (SELECT DISTINCT id FROM vcafe_analytics.customers_current)
SELECT FORMAT_DATE("%Y-%m", DATE(`at`, "Asia/Tokyo")) AS month,
  COUNTIF(status = "succeeded") AS ok_n, ROUND(SUM(IF(status = "succeeded", amount, 0))) AS ok_yen,
  COUNTIF(status = "amount-only") AS pending_n, ROUND(SUM(IF(status = "amount-only", amount, 0))) AS pending_yen,
  COUNTIF(status NOT IN ("succeeded", "amount-only")) AS other_n,
  COUNTIF(customerId NOT IN (SELECT id FROM c)) AS outsider_n, ROUND(SUM(IF(customerId NOT IN (SELECT id FROM c), amount, 0))) AS outsider_yen,
  COUNTIF(COALESCE(source, "") != "userPayments") AS legacy_n
FROM p GROUP BY month ORDER BY month'

echo
echo "=== 課金の重複（同じ人・同じ時刻・同じ金額が2行以上） ==="
bq query --project_id=$P --use_legacy_sql=false --format=pretty --max_rows=100 --parameter="f:DATE:${FROM}" --parameter="t:DATE:${TO}" '
SELECT FORMAT_DATE("%Y-%m", DATE(`at`, "Asia/Tokyo")) AS month, SUM(n - 1) AS extra_rows, ROUND(SUM((n - 1) * amount)) AS extra_yen
FROM (SELECT customerId, `at`, amount, COUNT(*) AS n FROM vcafe_analytics.payments_current_range(@f, @t)
      WHERE DATE(`at`, "Asia/Tokyo") BETWEEN @f AND @t GROUP BY 1, 2, 3 HAVING n > 1)
GROUP BY month ORDER BY month'

echo
echo "=== 利用額（ご帰宅の消費） 月×要素 ==="
bq query --project_id=$P --use_legacy_sql=false --format=pretty --max_rows=100 --parameter="f:DATE:${FROM}" --parameter="t:DATE:${TO}" '
WITH v AS (
  SELECT *, ROUND(COALESCE(billedCoin, 0) * 1.19) AS coin_yen, ROUND(COALESCE(billedRewardPoint, 0) * 1.1) AS rp_yen,
    CASE ticketId WHEN "gokitaku30minutes" THEN 850 WHEN "premiumGokitaku1" THEN 960 WHEN "luckyGokitaku" THEN 650 ELSE 0 END * COALESCE(usedTicketCount, 1) AS ticket_yen
  FROM vcafe_analytics.visits_current_range(@f, @t, NULL) WHERE type NOT IN ("free", "trial", "reservation") AND ticketId IS NOT NULL
), c AS (SELECT DISTINCT id FROM vcafe_analytics.customers_current)
SELECT FORMAT_DATE("%Y-%m", DATE(TIMESTAMP_SUB(`at`, INTERVAL 2 HOUR), "Asia/Tokyo")) AS month,
  COUNT(*) AS visits, SUM(coin_yen) AS coin_yen, SUM(rp_yen) AS rp_yen, SUM(ticket_yen) AS ticket_yen,
  SUM(coin_yen + rp_yen + ticket_yen) AS total_yen,
  COUNTIF(customerId NOT IN (SELECT id FROM c)) AS outsider_visits, SUM(IF(customerId NOT IN (SELECT id FROM c), coin_yen + rp_yen + ticket_yen, 0)) AS outsider_yen,
  ROUND(MAX(billedRewardPoint)) AS max_rp_one_visit, ROUND(APPROX_QUANTILES(billedRewardPoint, 100)[OFFSET(99)]) AS rp_p99
FROM v GROUP BY month ORDER BY month'

echo
echo "=== ご帰宅の重複（同じ人・同じメイド・同じ入室時刻が2行以上） ==="
bq query --project_id=$P --use_legacy_sql=false --format=pretty --max_rows=100 --parameter="f:DATE:${FROM}" --parameter="t:DATE:${TO}" '
SELECT FORMAT_DATE("%Y-%m", DATE(TIMESTAMP_SUB(`at`, INTERVAL 2 HOUR), "Asia/Tokyo")) AS month, SUM(n - 1) AS extra_rows
FROM (SELECT customerId, maidId, `at`, COUNT(*) AS n FROM vcafe_analytics.visits_current_range(@f, @t, NULL) GROUP BY 1, 2, 3 HAVING n > 1)
GROUP BY month ORDER BY month'
