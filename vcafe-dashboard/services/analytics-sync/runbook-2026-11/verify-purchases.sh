#!/usr/bin/env bash
# 課金台帳の購入額を、各プラットフォームの報告と比べる（読み取りのみ）
#   bash verify-purchases.sh 2026-10
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
MONTH=${1:-2026-10}
START="${MONTH}-01"; END=$(date -d "${START} +1 month -1 day" +%F)
bq query --project_id=$P --use_legacy_sql=false --format=pretty --parameter="s:DATE:${START}" --parameter="e:DATE:${END}" '
SELECT "日本時間の月" AS basis,
  ROUND(SUM(IF(vendor = "apple", amount, 0)) * 0.85) AS apple_net, ROUND(SUM(IF(vendor = "google", amount, 0)) * 0.85) AS google_net,
  SUM(IF(channel = "webstore", amount, 0)) AS stripe, COUNTIF(channel = "webstore") AS stripe_n, SUM(IF(channel = "inapp" AND vendor IS NULL, amount, 0)) AS inapp_unknown
FROM vcafe_analytics.payments_current_range(DATE_SUB(@s, INTERVAL 1 DAY), DATE_ADD(@e, INTERVAL 1 DAY))
WHERE DATE(`at`, "Asia/Tokyo") BETWEEN @s AND @e
UNION ALL
SELECT "UTCの月",
  ROUND(SUM(IF(vendor = "apple", amount, 0)) * 0.85), ROUND(SUM(IF(vendor = "google", amount, 0)) * 0.85),
  SUM(IF(channel = "webstore", amount, 0)), COUNTIF(channel = "webstore"), SUM(IF(channel = "inapp" AND vendor IS NULL, amount, 0))
FROM vcafe_analytics.payments_current_range(DATE_SUB(@s, INTERVAL 1 DAY), DATE_ADD(@e, INTERVAL 1 DAY))
WHERE DATE(`at`) BETWEEN @s AND @e'
# Appleは App Store の会計月で集計する（例: 2026年10月 = 9/27〜10/31）
read -r AS AE < <(python3 - "${MONTH}" <<'PY'
import sys, datetime as dt
y, m = map(int, sys.argv[1].split("-"))
fy = y if m >= 10 else y - 1
def last_sat(year):
    d = dt.date(year, 9, 30)
    while d.weekday() != 5: d -= dt.timedelta(days=1)
    return d
start = last_sat(fy) + dt.timedelta(days=1)
weeks = [5, 4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4]
i = (m + 2) % 12
s = start + dt.timedelta(weeks=sum(weeks[:i]))
e = last_sat(fy + 1) if i == 11 else s + dt.timedelta(weeks=weeks[i], days=-1)
print(s, e)
PY
)
echo "Appleの会計月: ${AS} 〜 ${AE}"
bq query --project_id=$P --use_legacy_sql=false --format=pretty --parameter="s:DATE:${AS}" --parameter="e:DATE:${AE}" '
SELECT "Appleの会計月" AS basis, ROUND(SUM(IF(vendor = "apple", amount, 0)) * 0.85) AS apple_net, SUM(IF(channel = "inapp" AND vendor IS NULL, amount, 0)) AS inapp_unknown
FROM vcafe_analytics.payments_current_range(DATE_SUB(@s, INTERVAL 1 DAY), DATE_ADD(@e, INTERVAL 1 DAY))
WHERE DATE(`at`, "Asia/Tokyo") BETWEEN @s AND @e'
if [[ "${MONTH}" == "2026-10" ]]; then
  echo "各社の報告（2026年10月）: Apple 673,183（手数料控除後） / Google 188,615（手数料控除後） / Stripe 964件 2,605,010"
fi
