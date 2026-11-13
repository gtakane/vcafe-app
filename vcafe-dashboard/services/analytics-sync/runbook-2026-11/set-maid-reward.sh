#!/usr/bin/env bash
# メイド報酬（月の合計）を登録する。同じ月を再登録すると上書きする（最新の値を使う）。
# 先に step12-kpi-manual-input.sh を実行しておくこと。ダッシュボードの月次指標の表からも入力できる。
#   bash set-maid-reward.sh 2026-11 1983558   （カンマは付けても可）
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
MONTH=${1:-}; AMOUNT=${2:-}; AMOUNT=${AMOUNT//,/}
if [[ ! "${MONTH}" =~ ^20[0-9]{2}-[01][0-9]$ ]] || [[ ! "${AMOUNT}" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
  echo "使い方: bash set-maid-reward.sh 2026-11 1983558"; exit 2
fi
echo "${MONTH}: メイド報酬 ${AMOUNT} 円"
confirm "この値を登録します。"
bq query --project_id=$P --use_legacy_sql=false --quiet --parameter="m::${MONTH}" --parameter="a:FLOAT64:${AMOUNT}" "
INSERT INTO \`${P}.${DS}.monthly_kpi_overrides\` (month, field, numberValue, cleared, enteredAt, enteredBy)
VALUES (@m, 'maidReward', @a, FALSE, CURRENT_TIMESTAMP(), 'set-maid-reward.sh')"
echo "→ 登録しました。（ダッシュボードの月次指標の表からも入力できます）"
