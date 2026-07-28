#!/usr/bin/env bash
# バックフィルの結果を確認する（読み取りのみ）。
#   bash verify-backfill.sh
# 新しい列やテーブルにデータが入っているかを一覧で表示する。
set -uo pipefail

PROJECT_ID="${PROJECT_ID:-vcafe-admin-analytics}"
DS="${BIGQUERY_DATASET:-}"

if [[ -z "${DS}" ]]; then
  # データセットを自動検出（複数ある場合は最初のもの。BIGQUERY_DATASET で明示指定も可）。
  DS="$(bq --project_id="${PROJECT_ID}" ls --format=json 2>/dev/null \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[0]['datasetReference']['datasetId'] if d else '')")"
fi
if [[ -z "${DS}" ]]; then
  echo "データセットを特定できませんでした。BIGQUERY_DATASET=... を指定して再実行してください。" >&2
  exit 1
fi
echo "# project=${PROJECT_ID} dataset=${DS}"

q() { bq --project_id="${PROJECT_ID}" query --use_legacy_sql=false --format=prettyjson "$1" 2>&1 | tail -n +1; }

echo
echo "== 1) visits_raw に明細列があるか（ticketId/minutes/billedCoin/billedRewardPoint） =="
bq --project_id="${PROJECT_ID}" show --format=prettyjson "${PROJECT_ID}:${DS}.visits_raw" 2>/dev/null \
  | python3 -c "import sys,json;f=[x['name'] for x in json.load(sys.stdin)['schema']['fields']];print(', '.join(f));print('→ 明細列:', [c for c in ['ticketId','minutes','billedCoin','billedRewardPoint'] if c in f] or 'なし(apply-schema.sh 未実行)')" 2>/dev/null \
  || echo "visits_raw を取得できませんでした"

echo
echo "== 2) ご帰宅明細に値が入っているか =="
q "SELECT COUNT(*) AS visits, COUNTIF(ticketId IS NOT NULL) AS with_ticket, COUNTIF(minutes IS NOT NULL) AS with_minutes, COUNTIF(billedCoin IS NOT NULL) AS with_coin FROM \`${PROJECT_ID}.${DS}.visits_current\`"

echo
echo "== 3) アイテム使用(プレゼント) =="
q "SELECT COUNT(*) AS presents FROM \`${PROJECT_ID}.${DS}.presents_current\`"

echo
echo "== 4) 課金ログ（Webstore/アプリ内課金） =="
q "SELECT channel, COUNT(*) AS rows, ROUND(SUM(amount)) AS yen FROM \`${PROJECT_ID}.${DS}.payments_current\` GROUP BY channel"

echo
echo "== 5) ユーザー（全会員同期と付加項目） =="
q "SELECT COUNT(*) AS customers, COUNTIF(gender IS NOT NULL) AS with_gender, COUNTIF(lastPaymentAt IS NOT NULL) AS with_last_payment, MIN(DATE(registeredAt)) AS oldest_registration FROM \`${PROJECT_ID}.${DS}.customers_current\`"

echo
echo "※ 1)で明細列が「なし」→ apply-schema.sh を実行してから再バックフィル"
echo "※ 2)の with_ticket が 0 → 再バックフィル(BACKFILL_FROM)が未実行、または DRY_RUN=true のまま"
echo "※ 3)が 0 → userRecordPresents のインデックス作成前にバックフィルした可能性（作成後に再実行）"
echo "※ 5)の customers が少ない → SYNC_ALL_USERS=true での実行が未完了"
