#!/usr/bin/env bash
# 検証済みリビジョンへトラフィックを切り替える。
#
#   CONFIRM_MANUAL_UI_CHECK=yes bash promote-revision-tokyo.sh vcafe-dashboard-abc1234-0728-1200
#
# 実行前にスモークテストが成功していること、かつ管理者ログイン後の主要6画面
# （analytics/attendance-submissions/customers/growth/maid-reports/visit-logs）
# をブラウザで手動確認していること。
#
# firebase.json の Hosting rewrite から pinTag を外し、Cloud Run のトラフィック
# 分割だけで配信先が決まる設計にしている（以前は pinTag: true により、Hosting
# 側の再デプロイが「現在100%トラフィックのリビジョン」ではなく「最後に作成された
# リビジョン（カナリアを含む）」にピン留めされる恐れがあった）。
# pinTag 解除の firebase.json への反映（= firebase deploy --only hosting の実行）
# は本スクリプトの対象外。反映済みであることを前提とし、未反映なら以下で停止する。
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-vcafe-admin-analytics}"
REGION="${REGION:-asia-northeast1}"
SERVICE_NAME="${SERVICE_NAME:-vcafe-dashboard}"
NEW_REVISION="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SMOKE_TEST_SCRIPT="${SMOKE_TEST_SCRIPT:-${SCRIPT_DIR}/smoke-test-revision.sh}"
FIREBASE_CONFIG_PATH="${FIREBASE_CONFIG_PATH:-${SCRIPT_DIR}/firebase.json}"
STATE_DIR="${DEPLOY_STATE_DIR:-${SCRIPT_DIR}/.deploy-state}"
cd "${SCRIPT_DIR}"

if [[ -z "${NEW_REVISION}" ]]; then
  echo "usage: CONFIRM_MANUAL_UI_CHECK=yes bash promote-revision-tokyo.sh <リビジョン名>" >&2
  exit 2
fi

echo "=========================================================="
echo " 0. 事前チェック"
echo "=========================================================="

if [[ "${CONFIRM_MANUAL_UI_CHECK:-no}" != "yes" ]]; then
  echo "★ 管理者ログイン後の主要6画面を手動確認してから実行してください:" >&2
  echo "  analytics / attendance-submissions / customers / growth / maid-reports / visit-logs" >&2
  echo "  メイドアカウントがあれば、ユーザー名が非表示になっていることも確認すること。" >&2
  echo "  確認済みなら CONFIRM_MANUAL_UI_CHECK=yes を付けて再実行してください。" >&2
  exit 1
fi
echo "  管理者UI確認: 確認済み（CONFIRM_MANUAL_UI_CHECK=yes）"

if grep -qE '"pinTag"\s*:\s*true' "${FIREBASE_CONFIG_PATH}" 2>/dev/null; then
  echo "★ ${FIREBASE_CONFIG_PATH} に pinTag: true が残っています。" >&2
  echo "  pinTag が有効な間は、Cloud Run のトラフィック切替だけでは Hosting 経由の配信が" >&2
  echo "  切り替わりません（Hosting は別途 firebase deploy --only hosting でしか動かない）。" >&2
  echo "  pinTag 解除を firebase deploy --only hosting で反映してから、このスクリプトを使ってください。" >&2
  exit 1
fi
echo "  pinTag: firebase.json に残っていないことを確認"

DESCRIBE=(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --project="${PROJECT_ID}")

PREVIOUS_REVISION="$("${DESCRIBE[@]}" --format='json' | python3 -c "
import json,sys
data=json.load(sys.stdin)
for t in data.get('status',{}).get('traffic',[]):
    if t.get('percent') == 100:
        print(t.get('revisionName',''))
        break
")"

if [[ -z "${PREVIOUS_REVISION}" ]]; then
  echo "★ 現在100%トラフィックを受けているリビジョンを特定できませんでした。中止します。" >&2
  exit 1
fi

mkdir -p "${STATE_DIR}"
STATE_FILE="${STATE_DIR}/promote-$(date -u +%Y%m%dT%H%M%SZ).json"
cat > "${STATE_FILE}" <<EOF
{"action":"promote","service":"${SERVICE_NAME}","region":"${REGION}","project":"${PROJECT_ID}","previous_revision":"${PREVIOUS_REVISION}","new_revision":"${NEW_REVISION}"}
EOF

echo
echo "=========================================================="
echo " 1. トラフィック切替"
echo "=========================================================="
echo "  切替前: ${PREVIOUS_REVISION}"
echo "  切替後: ${NEW_REVISION}"
echo "  状態保存: ${STATE_FILE}（失敗時の切り戻し先として使用可能）"
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

SERVICE_URL="$("${DESCRIBE[@]}" --format='value(status.url)')"

echo
echo "=========================================================="
echo " 2. 切替後のスモークテスト"
echo "=========================================================="
# `cmd || SMOKE=$?` で受けることで、smoke-test-revision.sh が非0終了しても
# set -e でスクリプトが即終了せず、下の自動ロールバック処理まで必ず到達する。
SMOKE=0
bash "${SMOKE_TEST_SCRIPT}" "${SERVICE_URL}" || SMOKE=$?

if (( SMOKE != 0 )); then
  echo
  echo "★ 切替後のスモークテストが失敗しました。自動的に ${PREVIOUS_REVISION} へ戻します。" >&2
  gcloud run services update-traffic "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --to-revisions="${PREVIOUS_REVISION}=100" \
    --quiet
  echo "★ 自動ロールバック完了: ${PREVIOUS_REVISION} が100%に戻りました。" >&2
  "${DESCRIBE[@]}" --format='table(status.traffic.revisionName, status.traffic.percent, status.traffic.tag)' >&2
  echo
  echo "★ ${NEW_REVISION} は問題があるため、原因調査してから再度カナリアを作り直してください。" >&2
  exit 1
fi

echo
echo "完了: ${NEW_REVISION} が100%を受けています。"
echo
echo "戻す場合: bash rollback-revision-tokyo.sh ${PREVIOUS_REVISION}"
echo "ERRORログの確認:"
echo "  gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.revision_name=${NEW_REVISION} AND severity>=ERROR' \\"
echo "    --project=${PROJECT_ID} --freshness=15m --limit=50"
