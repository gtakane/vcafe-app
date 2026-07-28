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
q "SELECT channel, COUNT(*) AS row_count, ROUND(SUM(amount)) AS yen FROM \`${PROJECT_ID}.${DS}.payments_current\` GROUP BY channel"

echo
echo "== 4b) 課金ソース別×年別（userPayments が全時代をカバーしているかの検証） =="
q "SELECT COALESCE(source, '(旧)') AS source, channel,
          FORMAT_DATE('%Y', DATE(\`at\`, 'Asia/Tokyo')) AS year,
          COUNT(*) AS row_count, ROUND(SUM(amount)) AS yen
   FROM (
     SELECT * EXCEPT(rn) FROM (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY syncedAt DESC) AS rn
       FROM \`${PROJECT_ID}.${DS}.payments_raw\`
     ) WHERE rn = 1
   )
   GROUP BY source, channel, year ORDER BY year, source, channel"

echo
echo "== 5) customers_current ビューが新列を返せるか（ビューが古いと新項目が全て空になる） =="
bq --project_id="${PROJECT_ID}" show --format=prettyjson "${PROJECT_ID}:${DS}.customers_current" 2>/dev/null \
  | python3 -c "
import sys,json
f=[x['name'] for x in json.load(sys.stdin)['schema']['fields']]
need=['gender','lastVisitAt','lastPaymentAt','purchasedItemCoin','presentAmount','coin','rewardPoint','totalVisitAmount','maxConsecutiveVisitDays']
missing=[c for c in need if c not in f]
print('列:', ', '.join(f))
print('→ 不足:', missing if missing else 'なし（ビューは最新）')
if missing: print('   ★ ビューが古いです。apply-schema.sh を実行し直してください（CREATE OR REPLACE VIEW で解消）')
" 2>/dev/null || echo "customers_current を取得できませんでした"

echo
echo "== 6) customers_raw に実データが入っているか =="
q "SELECT COUNT(*) AS row_count, COUNT(DISTINCT id) AS users, COUNTIF(gender IS NOT NULL) AS with_gender, COUNTIF(lastPaymentAt IS NOT NULL) AS with_last_payment, MIN(DATE(registeredAt)) AS oldest_registration FROM \`${PROJECT_ID}.${DS}.customers_raw\`"

echo
echo "※ 1)で明細列が「なし」→ apply-schema.sh を実行してから再バックフィル"
echo "※ 2)の with_ticket が 0 → 再バックフィル(BACKFILL_FROM)が未実行、または DRY_RUN=true のまま"
echo "※ 3)が 0 → userRecordPresents のインデックス作成前にバックフィルした可能性（作成後に再実行）"
echo "※ 5)で不足あり → apply-schema.sh を実行し直す（ビュー再作成）だけで直る。再バックフィル不要"
echo "※ 6)の with_gender が 0 → SYNC_ALL_USERS=true でのバックフィルが未完了。再実行が必要"
echo "※ 4b)の見方: userPayments の webstore が 2024〜2026 にも十分な件数・金額であれば"
echo "   旧 payments(Stripe) の写しも台帳に入っており、二重計上なしで全時代をカバーできている。"
echo "   逆に 2024 以降の webstore が (旧) にしか無い場合は、ビューの調整が必要なので報告してください。"
