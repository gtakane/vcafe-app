#!/usr/bin/env bash
# 新しいリビジョンを「トラフィック0」でデプロイする（カナリア）。
#
#   bash deploy-revision-tokyo.sh
#
# deploy-tokyo.sh との違い:
#   - IAM を一切変更しない（deploy-tokyo.sh は毎回4つのロールを付与し直す）
#   - --allow-unauthenticated を渡さない（現在のIAMポリシーを保持する）
#   - 環境変数を全置換しない（--update-env-vars で追加・更新のみ）
#   - --no-traffic + --tag で、本番トラフィックを移さずに検証用URLだけを作る
#   - Firebase Hosting を触らない（切替は promote-revision-tokyo.sh）
#
# サービスアカウント・CPU・メモリ・同時実行数・Secret参照・VPC などは
# 明示的に渡さないことで、現行サービスの設定がそのまま引き継がれる。
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-vcafe-admin-analytics}"
REGION="${REGION:-asia-northeast1}"
SERVICE_NAME="${SERVICE_NAME:-vcafe-dashboard}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

DESCRIBE=(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --project="${PROJECT_ID}")

echo "=========================================================="
echo " 1. 現行サービスの確認（読み取りのみ）"
echo "=========================================================="
if ! "${DESCRIBE[@]}" >/dev/null 2>&1; then
  echo "★ サービス ${SERVICE_NAME} (${REGION}/${PROJECT_ID}) が見つかりません。" >&2
  echo "  新規作成は本スクリプトの対象外です。サービス名・リージョンを確認してください。" >&2
  exit 1
fi

CURRENT_REVISION="$("${DESCRIBE[@]}" --format='value(status.latestReadyRevisionName)')"
SERVICE_URL="$("${DESCRIBE[@]}" --format='value(status.url)')"
SERVICE_ACCOUNT="$("${DESCRIBE[@]}" --format='value(spec.template.spec.serviceAccountName)')"
echo "  サービス      : ${SERVICE_NAME}"
echo "  リージョン    : ${REGION}"
echo "  現行リビジョン: ${CURRENT_REVISION}"
echo "  URL           : ${SERVICE_URL}"
echo "  実行SA        : ${SERVICE_ACCOUNT}"
echo "  現在のトラフィック:"
"${DESCRIBE[@]}" --format='table(status.traffic.revisionName, status.traffic.percent, status.traffic.tag)'

echo
echo "=========================================================="
echo " 2. 環境変数の差分（削除が起きないことの確認）"
echo "=========================================================="
# 現行の環境変数名（値は出力しない）と cloudrun.env.yaml を突き合わせる。
LIVE_ENV="$("${DESCRIBE[@]}" --format='value(spec.template.spec.containers[0].env[].name)' | tr ';,' '\n\n' | sed '/^$/d' | sort -u)"
FILE_ENV="$(grep -oE '^[A-Za-z_][A-Za-z0-9_]*:' cloudrun.env.yaml | tr -d ':' | sort -u)"

REMOVED="$(comm -23 <(echo "${LIVE_ENV}") <(echo "${FILE_ENV}"))"
ADDED="$(comm -13 <(echo "${LIVE_ENV}") <(echo "${FILE_ENV}"))"

echo "  現行の環境変数名: $(echo "${LIVE_ENV}" | tr '\n' ' ')"
[[ -n "${ADDED}" ]] && echo "  追加/更新される  : $(echo "${ADDED}" | tr '\n' ' ')"

if [[ -n "${REMOVED}" ]]; then
  echo
  echo "★ cloudrun.env.yaml に無い既存の環境変数があります:" >&2
  echo "  $(echo "${REMOVED}" | tr '\n' ' ')" >&2
  echo "  --update-env-vars を使うため**削除はされません**が、意図した状態か確認してください。" >&2
  echo "  Secret 参照（--set-secrets）で注入されている変数はここに現れることがあります。" >&2
  if [[ "${CONFIRM_ENV_DRIFT:-no}" != "yes" ]]; then
    echo "  確認済みなら CONFIRM_ENV_DRIFT=yes を付けて再実行してください。" >&2
    exit 1
  fi
fi

# AUTH_MODE が firebase であることは fail-closed 設計の前提。欠けると起動時に停止する。
if ! grep -qE '^AUTH_MODE:\s*firebase\s*$' cloudrun.env.yaml; then
  echo "★ cloudrun.env.yaml に AUTH_MODE: firebase がありません。起動時に停止します。" >&2
  exit 1
fi

echo
echo "=========================================================="
echo " 3. デプロイ内容"
echo "=========================================================="
SHORT_SHA="$(git rev-parse --short HEAD)"
STAMP="$(date -u +%m%d-%H%M)"
REVISION_SUFFIX="${SHORT_SHA}-${STAMP}"
TAG="canary-${SHORT_SHA}"
echo "  コミット      : $(git rev-parse HEAD)"
echo "  ブランチ      : $(git branch --show-current)"
echo "  新リビジョン  : ${SERVICE_NAME}-${REVISION_SUFFIX}"
echo "  検証用タグ    : ${TAG}"
echo "  トラフィック  : 0%（--no-traffic）"
echo "  IAM           : 変更しない"
echo "  Hosting       : 触らない"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "★ 未コミットの変更があります。リビジョンとコミットが対応しなくなります。" >&2
  git status --short >&2
  exit 1
fi

echo
echo "=========================================================="
echo " 4. デプロイ（トラフィック0）"
echo "=========================================================="
# --allow-unauthenticated / --service-account / --cpu / --memory / --concurrency /
# --min / --max / --set-secrets は**渡さない**。現行サービスの設定が保持される。
gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --revision-suffix="${REVISION_SUFFIX}" \
  --tag="${TAG}" \
  --no-traffic \
  --update-env-vars="$(grep -oE '^[A-Za-z_][A-Za-z0-9_]*:.*' cloudrun.env.yaml | sed 's/:[[:space:]]*/=/' | sed 's/"//g' | paste -sd, -)" \
  --quiet

NEW_REVISION="${SERVICE_NAME}-${REVISION_SUFFIX}"
TAG_URL="$("${DESCRIBE[@]}" --format="value(status.traffic.filter(\"tag='${TAG}'\").extract(url))" | tr -d '[]')"
[[ -z "${TAG_URL}" ]] && TAG_URL="$("${DESCRIBE[@]}" --format='json' | python3 -c "
import json,sys
data=json.load(sys.stdin)
for t in data.get('status',{}).get('traffic',[]):
    if t.get('tag')=='${TAG}':
        print(t.get('url',''))
        break
")"

echo
echo "=========================================================="
echo " 完了: トラフィック0でデプロイしました"
echo "=========================================================="
echo "  旧リビジョン: ${CURRENT_REVISION}（引き続き100%）"
echo "  新リビジョン: ${NEW_REVISION}（0%）"
echo "  検証用URL   : ${TAG_URL}"
echo
echo "次: スモークテストを実行してください"
echo "  bash smoke-test-revision.sh \"${TAG_URL}\""
echo
echo "その後、承認のうえ切替:"
echo "  bash promote-revision-tokyo.sh ${NEW_REVISION}"
