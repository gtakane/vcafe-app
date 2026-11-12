#!/usr/bin/env bash
# 再取り込み後の確認（読み取りのみ）:
#   (1) 定期同期が再開し、再取り込み用の設定が外れているか
#   (2) 無料ご帰宅の件数が本番と揃っているか（テストユーザー分を除いて比較）
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

echo "=== (1) 定期同期の状態 ==="
STATE=$(gcloud scheduler jobs describe $SCHEDULER --project=$P --location=$R --format='value(state)')
LEFT=$(gcloud run jobs describe $JOB --region=$R --project=$P --format=yaml | grep -c 'BACKFILL_' || true)
echo "  定期同期: ${STATE}（ENABLED なら正常）"
echo "  再取り込み用の設定の残り: ${LEFT} 件（0 なら正常）"
echo "  同期ジョブのプログラム: $(current_job_image)"

echo
echo "=== (2) 本番Firestoreの無料ご帰宅（営業日11/6以降） ==="
[[ -d "${SYNC_DIR}/node_modules/firebase-admin" ]] || (cd "${SYNC_DIR}" && npm install --no-audit --no-fund >/dev/null 2>&1)
node "${HERE}/free-diff.mjs"

echo
echo "=== (2) ダッシュボード側(BigQuery) ==="
bq query --project_id=$P --use_legacy_sql=false --format=pretty \
  'SELECT COALESCE(entryType, IF(type="trial","trial",type)) AS kind, COUNT(*) AS n FROM vcafe_analytics.visits_current_range("2026-11-06","2026-11-30",NULL) WHERE type IN ("free","trial") GROUP BY kind ORDER BY kind'

echo
echo "=== 取り込みで弾かれたご帰宅（11/6以降・理由別） ==="
bq query --project_id=$P --use_legacy_sql=false --format=pretty \
  'SELECT reasonCode, fieldNames, COUNT(*) AS n FROM vcafe_analytics.sync_rejects WHERE source = "userRecordVisits" AND rejectedAt > TIMESTAMP("2026-11-05T17:00:00Z") GROUP BY 1,2 ORDER BY n DESC'
