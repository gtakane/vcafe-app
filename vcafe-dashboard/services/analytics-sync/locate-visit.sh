#!/usr/bin/env bash
# 「滞在(分) 9,776」のご帰宅行がどのデータセットから来ているかを特定する（読み取りのみ）。
#
#   bash locate-visit.sh "2026-07-21 23:50"
#
# 1. プロジェクト内の全データセットの visits_current から該当時刻±10分の行を全列表示
# 2. Cloud Run(Webアプリ)が実際に使っている BIGQUERY_DATASET 環境変数を表示
# → 私が検査したデータセットとアプリが読むデータセットのズレを見つける。
set -uo pipefail

PROJECT_ID="${PROJECT_ID:-vcafe-admin-analytics}"
WHEN_JST="${1:-2026-07-21 23:50}"

echo "# project=${PROJECT_ID}  対象時刻(JST): ${WHEN_JST} ±10分"

echo
echo "=================================================================="
echo "1) 全データセットの visits_current を横断検索"
echo "=================================================================="
DATASETS="$(bq --project_id="${PROJECT_ID}" ls --format=json 2>/dev/null \
  | python3 -c "import sys,json;print(' '.join(d['datasetReference']['datasetId'] for d in json.load(sys.stdin)))")"
echo "データセット一覧: ${DATASETS}"

for ds in ${DATASETS}; do
  echo
  echo "---- ${ds}.visits_current ----"
  bq --project_id="${PROJECT_ID}" query --use_legacy_sql=false --format=pretty \
    "SELECT DATETIME(\`at\`, 'Asia/Tokyo') AS at_jst, maidId, type, ticketId, minutes,
            billedCoin, billedRewardPoint, revenue, weight
     FROM \`${PROJECT_ID}.${ds}.visits_current\`
     WHERE \`at\` BETWEEN TIMESTAMP_SUB(TIMESTAMP('${WHEN_JST}:00+09:00'), INTERVAL 10 MINUTE)
                      AND TIMESTAMP_ADD(TIMESTAMP('${WHEN_JST}:00+09:00'), INTERVAL 10 MINUTE)
     ORDER BY \`at\`" 2>&1 | grep -v "^Waiting" || true
done

echo
echo "=================================================================="
echo "2) Webアプリ(Cloud Run)が使っている BigQuery 設定"
echo "=================================================================="
for region in asia-northeast1 asia-northeast2 us-central1; do
  SERVICES="$(gcloud run services list --project="${PROJECT_ID}" --region="${region}" --format='value(metadata.name)' 2>/dev/null)"
  [[ -z "${SERVICES}" ]] && continue
  for svc in ${SERVICES}; do
    echo "-- ${region} / ${svc} --"
    gcloud run services describe "${svc}" --project="${PROJECT_ID}" --region="${region}" --format=json 2>/dev/null \
      | python3 -c "
import sys, json
d = json.load(sys.stdin)
envs = d['spec']['template']['spec']['containers'][0].get('env', [])
for e in envs:
    if 'BIGQUERY' in e.get('name','') or 'ANALYTICS' in e.get('name',''):
        print(f\"   {e['name']} = {e.get('value','(secret)')}\")
"
  done
done

echo
echo "----"
echo "読み方:"
echo "・1) で minutes=9776 のような行を持つデータセットが見つかれば、それをアプリが読んでいます"
echo "・2) の BIGQUERY_DATASET が私の検査対象(vcafe_analytics)と違えば、設定ズレが原因です"
echo "・どのデータセットにも 9776 が無ければ、アプリ側のキャッシュ/ビルドを確認します"
