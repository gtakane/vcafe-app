#!/usr/bin/env bash
# デプロイしたリビジョンのスモークテスト（読み取りのみ・認証なし）。
#
#   bash smoke-test-revision.sh https://canary-xxxx---vcafe-dashboard-xxx.a.run.app
#
# 目的は「認証なしで機密データが取れないこと」の確認。
# 期待するステータスは tests/api-auth-contract.test.ts が
# app/api 以下の実装と突き合わせており、経路の追加漏れを検出する。
set -uo pipefail

URL="${1:-}"
if [[ -z "${URL}" ]]; then
  echo "usage: bash smoke-test-revision.sh <URL>" >&2
  exit 2
fi
URL="${URL%/}"

FAILED=0
pass() { printf '  \033[32mOK\033[0m   %s\n' "$1"; }
fail() { printf '  \033[31mNG\033[0m   %s\n' "$1"; FAILED=$((FAILED + 1)); }

# 認証なしで叩いたときに 401 を返さなければならない経路。
# 新しい API を足したらここにも足すこと（テストが強制する）。
UNAUTH_401=(
  "/api/analytics"
  "/api/attendance-submissions"
  "/api/customers"
  "/api/growth"
  "/api/maid-reports"
  "/api/visit-logs"
)

status_of() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$1"
}

echo "=========================================================="
echo " スモークテスト: ${URL}"
echo "=========================================================="

echo
echo "[1] 起動確認"
ROOT_STATUS="$(status_of "${URL}/")"
# 未認証のトップは 200（ログイン画面を出す）か /login へのリダイレクトを許容する。
if [[ "${ROOT_STATUS}" =~ ^(200|302|307)$ ]]; then
  pass "GET / → ${ROOT_STATUS}"
else
  fail "GET / → ${ROOT_STATUS}（起動していない、または5xx）"
fi

LOGIN_STATUS="$(status_of "${URL}/login")"
if [[ "${LOGIN_STATUS}" == "200" ]]; then
  pass "GET /login → 200"
else
  fail "GET /login → ${LOGIN_STATUS}"
fi

echo
echo "[2] 認証なしで機密データを取得できないこと"
for path in "${UNAUTH_401[@]}"; do
  code="$(status_of "${URL}${path}")"
  if [[ "${code}" == "401" ]]; then
    pass "GET ${path} → 401"
  elif [[ "${code}" == "200" ]]; then
    fail "GET ${path} → 200（★認証なしで応答している）"
  else
    fail "GET ${path} → ${code}（401 を期待）"
  fi
done

echo
echo "[3] 応答本文に機密データが含まれないこと"
for path in "/api/customers" "/api/visit-logs"; do
  body="$(curl -s --max-time 30 "${URL}${path}")"
  if echo "${body}" | grep -qE '"(rows|customers|visits)"\s*:\s*\['; then
    fail "GET ${path} が未認証でデータ配列を返している"
  elif ! echo "${body}" | grep -q '"error"'; then
    # 応答が空でも「データ配列が無い」は成立してしまう。
    # 認証エラーの本文that返っていることまで確認する。
    fail "GET ${path} が認証エラー本文を返していない: $(echo "${body}" | head -c 80)"
  else
    pass "GET ${path} → 認証エラー本文のみ"
  fi
done

echo
echo "[4] 不正な入力を弾くこと"
# 期間バリデーション（366日以内）。未認証なので401が先に返るのが正しい。
code="$(status_of "${URL}/api/analytics?start=1900-01-01&end=2999-12-31")"
if [[ "${code}" == "401" ]]; then
  pass "不正な期間 + 未認証 → 401（認可がバリデーションより先）"
else
  fail "不正な期間 + 未認証 → ${code}（401 を期待）"
fi

echo
echo "=========================================================="
if (( FAILED == 0 )); then
  echo " すべて成功しました。"
  echo "=========================================================="
  echo
  echo "※ 管理者ログイン後の6画面表示は、ブラウザで手動確認してください。"
  echo "※ Cloud Logging の ERROR は次で確認します:"
  echo "   gcloud logging read 'resource.type=cloud_run_revision AND severity>=ERROR' \\"
  echo "     --project=vcafe-admin-analytics --freshness=15m --limit=50"
  exit 0
fi
echo " ★ ${FAILED} 件失敗しました。トラフィックを切り替えないでください。"
echo "=========================================================="
exit 1
