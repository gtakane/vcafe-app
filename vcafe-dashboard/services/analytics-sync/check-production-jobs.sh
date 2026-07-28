#!/usr/bin/env bash
# 本番プロジェクトで動いている定期実行・関数・サービスを、更新日時つきで一覧する（読み取りのみ）。
#
#   bash check-production-jobs.sh
#
# 目的:
#   1. 5分ごとに約86件の存在しないドキュメントを引いているジョブを特定する
#   2. 2026-07-16 前後に更新されたものがあれば、それが変化点
set -uo pipefail

PROJECT="${PRODUCTION_PROJECT_ID:-v-athome-cafe-app}"
echo "# project=${PROJECT}"
echo "# ★ 2026-07-16 前後に更新されているものを探してください"

echo
echo "=================================================================="
echo "1) Cloud Scheduler（定期実行）"
echo "=================================================================="
LOCATIONS="$(gcloud scheduler locations list --project="${PROJECT}" --format='value(locationId)' 2>/dev/null)"
if [[ -z "${LOCATIONS}" ]]; then
  echo "リージョンを取得できませんでした（Scheduler 未使用の可能性）"
else
  for loc in ${LOCATIONS}; do
    echo "-- ${loc} --"
    gcloud scheduler jobs list --project="${PROJECT}" --location="${loc}" \
      --format="table(name.basename(),schedule,timeZone,state,lastAttemptTime)" 2>/dev/null \
      | sed 's/^/  /'
  done
fi

echo
echo "=================================================================="
echo "2) Cloud Functions（第1世代・第2世代）"
echo "=================================================================="
echo "   ★ updateTime が 2026-07-16 前後のものが変化点の候補です"
gcloud functions list --project="${PROJECT}" \
  --format="table(name.basename(),state,updateTime,environment,eventTrigger.eventType)" 2>&1 \
  | head -80 | sed 's/^/  /'

echo
echo "=================================================================="
echo "3) Cloud Run（サービス／ジョブ）"
echo "=================================================================="
gcloud run services list --project="${PROJECT}" \
  --format="table(metadata.name,status.latestReadyRevisionName,metadata.creationTimestamp)" 2>&1 \
  | head -40 | sed 's/^/  /'
echo
gcloud run jobs list --project="${PROJECT}" \
  --format="table(metadata.name,metadata.creationTimestamp)" 2>&1 \
  | head -40 | sed 's/^/  /'

echo
echo "=================================================================="
echo "4) 5分ごとに動いているものの直近の実行ログ"
echo "=================================================================="
echo "   ★ 5分間隔で約86件の空振りを出しているジョブの正体を探します"
gcloud logging read \
  'resource.type=("cloud_function" OR "cloud_run_revision" OR "cloud_scheduler_job")
   AND timestamp>="'"$(date -u -d '20 minutes ago' +%Y-%m-%dT%H:%M:%SZ)"'"' \
  --project="${PROJECT}" --limit=40 \
  --format="table(timestamp,resource.labels.function_name,resource.labels.service_name,resource.labels.job_id,severity)" 2>&1 \
  | head -50 | sed 's/^/  /'

echo
echo "----"
echo "※ 本番の設定変更・停止はそちらで実施してください。ここでは一覧のみ行っています。"
