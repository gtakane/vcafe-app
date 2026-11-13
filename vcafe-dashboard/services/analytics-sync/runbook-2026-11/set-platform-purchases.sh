#!/usr/bin/env bash
# 各社の報告による月の購入額を登録する（月の確定売上を経理と一致させるため）。
#   bash set-platform-purchases.sh 2026-11 <Apple> <Google> <Stripe>
#     Apple  … App Store Connect「支払と財務報告」の推定収益（手数料控除後・Appleの会計月）
#     Google … Google Play のお支払いプロファイルの当月分（手数料控除後）
#     Stripe … Stripe の当月の決済額（総額。Stripe手数料は売上から引かない）
# 同じ月を再登録すると上書きする。分析用BigQueryのみに書き込む。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
MONTH=${1:-}; APPLE=${2:-}; GOOGLE=${3:-}; STRIPE=${4:-}
num() { [[ "$1" =~ ^[0-9]+(\.[0-9]+)?$ ]]; }
if [[ ! "${MONTH}" =~ ^20[0-9]{2}-(0[1-9]|1[0-2])$ ]] || ! num "${APPLE//,/}" || ! num "${GOOGLE//,/}" || ! num "${STRIPE//,/}"; then
  echo "使い方: bash set-platform-purchases.sh 2026-11 673183 188615 2605010（カンマは付けても可）"; exit 2
fi
APPLE=${APPLE//,/}; GOOGLE=${GOOGLE//,/}; STRIPE=${STRIPE//,/}
echo "${MONTH}: Apple ${APPLE} / Google ${GOOGLE} / Stripe ${STRIPE}"
confirm "この値を ${MONTH} の購入額として登録します。"
bq query --project_id=$P --use_legacy_sql=false --quiet \
  --parameter="m::${MONTH}" --parameter="a:FLOAT64:${APPLE}" --parameter="g:FLOAT64:${GOOGLE}" --parameter="s:FLOAT64:${STRIPE}" '
MERGE vcafe_analytics.platform_purchases t
USING (SELECT @m AS month) src ON t.month = src.month
WHEN MATCHED THEN UPDATE SET apple = @a, google = @g, stripe = @s, enteredAt = CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT (month, apple, google, stripe, enteredAt) VALUES (@m, @a, @g, @s, CURRENT_TIMESTAMP())'
echo "→ 登録しました。月次指標の画面で「最新にする」を押すと反映されます。"
