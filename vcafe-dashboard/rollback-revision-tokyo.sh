#!/usr/bin/env bash
# トラフィックを直前の正常リビジョンへ戻す。
#
#   bash rollback-revision-tokyo.sh vcafe-dashboard-xxxxxxx
#   bash rollback-revision-tokyo.sh            # リビジョン一覧を表示して終了
#
# リビジョンは削除しない。トラフィックの向き先を変えるだけ。
#
# firebase.json の Hosting rewrite からは pinTag を外しており、Hosting は
# Cloud Run のトラフィック分割をそのまま参照する。そのため本スクリプトは
# firebase deploy を実行しない（以前は実行していたが、pinTag: true の下では
# 「現在100%トラフィックのリビジョン」ではなく「最後に作成されたリビジョン」に
# ピン留めされる恐れがあり、ロールバック直後に新しい不具合カナリアが作られていた
# 場合に、戻したはずの旧リビジョンではなくその不具合カナリアへ再ピン留めしてしまう
# バグがあった。pinTag を外すことでこの問題自体を無くしている）。
# pinTag 解除の firebase.json への反映が未実施の場合は以下で停止する。
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-vcafe-admin-analytics}"
REGION="${REGION:-asia-northeast1}"
SERVICE_NAME="${SERVICE_NAME:-vcafe-dashboard}"
TARGET="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SMOKE_TEST_SCRIPT="${SMOKE_TEST_SCRIPT:-${SCRIPT_DIR}/smoke-test-revision.sh}"
FIREBASE_CONFIG_PATH="${FIREBASE_CONFIG_PATH:-${SCRIPT_DIR}/firebase.json}"
STATE_DIR="${DEPLOY_STATE_DIR:-${SCRIPT_DIR}/.deploy-state}"

DESCRIBE=(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --project="${PROJECT_ID}")

if [[ -z "${TARGET}" ]]; then
  echo "戻し先のリビジョンを指定してください。候補:"
  gcloud run revisions list --service="${SERVICE_NAME}" \
    --region="${REGION}" --project="${PROJECT_ID}" \
    --format='table(metadata.name, status.conditions[0].status, metadata.creationTimestamp)' \
    --limit=10
  exit 2
fi

if grep -qE '"pinTag"\s*:\s*true' "${FIREBASE_CONFIG_PATH}" 2>/dev/null; then
  echo "★ ${FIREBASE_CONFIG_PATH} に pinTag: true が残っています。" >&2
  echo "  pinTag が有効な間は、Cloud Run のトラフィック切替だけでは Hosting 経由の配信が" >&2
  echo "  戻りません。この場合は Cloud Run の切替後に firebase deploy --only hosting を" >&2
  echo "  手動で実行する必要があります（本スクリプトはそれを自動実行しません）。" >&2
  exit 1
fi

CURRENT_REVISION="$("${DESCRIBE[@]}" --format='json' | python3 -c "
import json,sys
data=json.load(sys.stdin)
for t in data.get('status',{}).get('traffic',[]):
    if t.get('percent') == 100 and not t.get('tag'):
        print(t.get('revisionName',''))
        break
")"

mkdir -p "${STATE_DIR}"
STATE_FILE="${STATE_DIR}/rollback-$(date -u +%Y%m%dT%H%M%SZ).json"
cat > "${STATE_FILE}" <<EOF
{"action":"rollback","service":"${SERVICE_NAME}","region":"${REGION}","project":"${PROJECT_ID}","from_revision":"${CURRENT_REVISION}","to_revision":"${TARGET}"}
EOF

echo "トラフィックを ${TARGET} へ戻します（切替前: ${CURRENT_REVISION:-不明}、状態保存: ${STATE_FILE}）。"
gcloud run services update-traffic "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --to-revisions="${TARGET}=100" \
  --quiet

gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --project="${PROJECT_ID}" \
  --format='table(status.traffic.revisionName, status.traffic.percent, status.traffic.tag)'

SERVICE_URL="$("${DESCRIBE[@]}" --format='value(status.url)')"

SMOKE=0
bash "${SMOKE_TEST_SCRIPT}" "${SERVICE_URL}" || SMOKE=$?

if (( SMOKE != 0 )); then
  echo
  echo "★ ロールバック後のスモークテストも失敗しました。${TARGET} 自体に問題がある可能性があります。" >&2
  echo "  切替前は ${CURRENT_REVISION:-不明} でした。手動で状態を確認してください。" >&2
  exit 1
fi

echo
echo "完了: ${TARGET} が100%を受けています。"
