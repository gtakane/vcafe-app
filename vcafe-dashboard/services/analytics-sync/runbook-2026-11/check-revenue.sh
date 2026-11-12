#!/usr/bin/env bash
# 売上の計算式を経理の計上ロジックに合わせたときの10月の数字と、コイン消費の記録場所を調べる（読み取りのみ）。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

echo "=== 10月（営業日）のご帰宅を、経理と同じ単価で計算した場合（税込） ==="
echo "    Appleコイン・Googleコイン=1.19円、リワードポイント=1.1円、ご帰宅850/プレミアム960/ランダム650円、チェキ500円"
bq query --project_id=$P --use_legacy_sql=false --format=pretty '
WITH v AS (SELECT * FROM vcafe_analytics.visits_current_range("2026-10-01","2026-10-31",NULL) WHERE type NOT IN ("free","trial"))
SELECT
  ROUND(SUM(IF(billedCoinVendor = "apple", billedCoin, 0)) * 1.19) AS apple_coin_yen,
  ROUND(SUM(IF(billedCoinVendor = "google", billedCoin, 0)) * 1.19) AS google_coin_yen,
  ROUND(SUM(IF(billedCoinVendor IS NULL, billedCoin, 0)) * 1.19) AS coin_vendor_unknown_yen,
  ROUND(SUM(billedRewardPoint) * 1.1) AS reward_point_yen,
  SUM(CASE ticketId WHEN "gokitaku30minutes" THEN 850 WHEN "premiumGokitaku1" THEN 960 WHEN "luckyGokitaku" THEN 650 ELSE 0 END * COALESCE(usedTicketCount, 1)) AS ticket_yen,
  SUM(cheki) * 500 AS cheki_yen,
  COUNTIF(type = "reservation") AS reservations,
  COUNTIF(usedTicketCount IS NULL AND ticketId NOT IN ("ATCOIN")) AS ticket_rows_without_count
FROM v'
echo
echo "    経理の10月: Apple 676,818 / Google 192,227 / Stripe（チケット・ウェブコイン）2,420,469 / 合計 3,289,514（税込）"
echo "    ※ 10/1〜10/14 は購入元（apple/google）を未取得のため coin_vendor_unknown に入る（どちらも1.19円なので合計は同じ）"

echo
[[ -d "${SYNC_DIR}/node_modules/firebase-admin" ]] || (cd "${SYNC_DIR}" && npm install --no-audit --no-fund >/dev/null 2>&1)
node "${HERE}/discover-coin-records.mjs"
