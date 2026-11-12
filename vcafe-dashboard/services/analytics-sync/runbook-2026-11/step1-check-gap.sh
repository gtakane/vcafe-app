#!/usr/bin/env bash
# 手順1: 欠落日の確認（読み取りのみ。何も変更しない）
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

if [[ ! -d "${SYNC_DIR}/node_modules/firebase-admin" ]]; then
  echo "# 部品をインストールします（初回のみ・1分ほど）"
  (cd "${SYNC_DIR}" && npm install --no-audit --no-fund >/dev/null 2>&1)
fi

echo "=== 本番Firestoreの件数 ==="
node "${HERE}/count-days.mjs" 2026-10-18 2026-10-28

echo
echo "=== ダッシュボード側(BigQuery)の件数 ==="
bq query --project_id=$P --use_legacy_sql=false --format=pretty \
  'SELECT DATE(TIMESTAMP_SUB(`at`, INTERVAL 2 HOUR),"Asia/Tokyo") AS d, COUNT(*) AS n FROM vcafe_analytics.visits_current_range("2026-10-18","2026-10-28",NULL) GROUP BY d ORDER BY d'

echo
echo "→ 上下を見比べて、Firestoreの方が明らかに多い日が取りこぼしです（テストユーザー分の数件差は問題ありません）。"
