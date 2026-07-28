#!/usr/bin/env bash
# 検証済みリビジョンへトラフィックを切り替える。
#
#   bash promote-revision-tokyo.sh vcafe-dashboard-abc1234-0728-1200
#
# 実行前にスモークテストが成功していること。
# Firebase Hosting は firebase.json で pinTag: true を使っているため、
# Cloud Run のトラフィック切替だけでは Hosting 経由の配信は切り替わらない。
# 両方を切り替える。
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-vcafe-admin-analytics}"
REGION="${REGION:-asia-northeast1}"
SERVICE_NAME="${SERVICE_NAME:-vcafe-dashboard}"
NEW_REVISION="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

if [[ -z "${NEW_REVISION}" ]]; then
  echo "usage: bash promote-revision-tokyo.sh <リビジョン名>" >&2
  exit 2
fi

DESCRIBE=(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --project="${PROJECT_ID}")

PREVIOUS_REVISION="$("${DESCRIBE[@]}" --format='json' | python3 -c "
import json,sys
data=json.load(sys.stdin)
for t in data.get('status',{}).get('traffic',[]):
    if t.get('percent') == 100 and not t.get('tag'):
        print(t.get('revisionName',''))
        break
")"

echo "=========================================================="
echo " トラフィック切替"
echo "=========================================================="
echo "  切替前: ${PREVIOUS_REVISION}"
echo "  切替後: ${NEW_REVISION}"
echo
echo "  現在のトラフィック:"
"${DESCRIBE[@]}" --format='table(status.traffic.revisionName, status.traffic.percent, status.traffic.tag)'
echo

gcloud run services update-traffic "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --to-revisions="${NEW_REVISION}=100" \
  --quiet

echo
echo "  切替後のトラフィック:"
"${DESCRIBE[@]}" --format='table(status.traffic.revisionName, status.traffic.percent, status.traffic.tag)'

echo
echo "=========================================================="
echo " Firebase Hosting の再ピン留め"
echo "=========================================================="
# firebase.json の rewrites は pinTag: true。Hosting は配備時点のリビジョンに
# ピン留めされるため、Cloud Run 側を切り替えただけでは Hosting 経由が古いままになる。
firebase use "${PROJECT_ID}"
firebase deploy --only hosting --project "${PROJECT_ID}"

SERVICE_URL="$("${DESCRIBE[@]}" --format='value(status.url)')"
echo
echo "=========================================================="
echo " 切替後のスモークテスト"
echo "=========================================================="
bash "${SCRIPT_DIR}/smoke-test-revision.sh" "${SERVICE_URL}"
SMOKE=$?

echo
if (( SMOKE != 0 )); then
  echo "★ 切替後のスモークテストが失敗しました。直ちに戻してください:" >&2
  echo "  bash rollback-revision-tokyo.sh ${PREVIOUS_REVISION}" >&2
  exit 1
fi

echo "完了: ${NEW_REVISION} が100%を受けています。"
echo
echo "戻す場合: bash rollback-revision-tokyo.sh ${PREVIOUS_REVISION}"
echo "ERRORログの確認:"
echo "  gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.revision_name=${NEW_REVISION} AND severity>=ERROR' \\"
echo "    --project=${PROJECT_ID} --freshness=15m --limit=50"
