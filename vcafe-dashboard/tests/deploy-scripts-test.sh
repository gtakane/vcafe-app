#!/usr/bin/env bash
# promote-revision-tokyo.sh / rollback-revision-tokyo.sh を gcloud のモックで検証する。
# 実際の GCP / Firebase には一切アクセスしない。
#
#   bash tests/deploy-scripts-test.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

MOCK_BIN="${TMP}/bin"
mkdir -p "${MOCK_BIN}"
cp tests/fixtures/deploy-mocks/gcloud "${MOCK_BIN}/gcloud"
cp tests/fixtures/deploy-mocks/smoke-mock "${MOCK_BIN}/smoke-mock"
chmod +x "${MOCK_BIN}/gcloud" "${MOCK_BIN}/smoke-mock"

# real gcloud/firebase を絶対に拾わない最小構成のPATH。
export PATH="${MOCK_BIN}:/usr/bin:/bin"

export MOCK_GCLOUD_STATE_DIR="${TMP}/gcloud-state"
mkdir -p "${MOCK_GCLOUD_STATE_DIR}"
STATE_FILE="${MOCK_GCLOUD_STATE_DIR}/current_revision.txt"
CALL_LOG="${MOCK_GCLOUD_STATE_DIR}/gcloud_calls.log"

export PROJECT_ID="test-project"
export REGION="test-region"
export SERVICE_NAME="test-service"
export DEPLOY_STATE_DIR="${TMP}/deploy-state"
export SMOKE_TEST_SCRIPT="${MOCK_BIN}/smoke-mock"
export SMOKE_RESULT_FILE="${TMP}/smoke_result"
export FIREBASE_CONFIG_PATH="${REPO_ROOT}/firebase.json"

FAILED=0
pass() { printf '  \033[32mOK\033[0m   %s\n' "$1"; }
fail() { printf '  \033[31mNG\033[0m   %s\n' "$1"; FAILED=$((FAILED + 1)); }

update_traffic_calls() { grep -c "run services update-traffic" "${CALL_LOG}" 2>/dev/null || echo 0; }

echo "=========================================================="
echo " T1: 正常系のpromoteは1回だけtraffic更新し、新リビジョンに切り替わる"
echo "=========================================================="
echo "old-rev-1" > "${STATE_FILE}"
echo "pass" > "${SMOKE_RESULT_FILE}"
: > "${CALL_LOG}"
CONFIRM_MANUAL_UI_CHECK=yes bash promote-revision-tokyo.sh new-rev-1 >"${TMP}/t1.out" 2>&1
rc=$?
if [[ ${rc} -eq 0 ]]; then pass "終了コード0"; else fail "終了コード${rc}（0を期待）: $(cat "${TMP}/t1.out")"; fi
if [[ "$(cat "${STATE_FILE}")" == "new-rev-1" ]]; then pass "トラフィックがnew-rev-1に切り替わった"; else fail "トラフィックが期待通りでない: $(cat "${STATE_FILE}")"; fi
if [[ "$(update_traffic_calls)" == "1" ]]; then pass "update-trafficは1回のみ呼ばれた"; else fail "update-traffic呼び出し回数が不正: $(update_traffic_calls)"; fi

echo
echo "=========================================================="
echo " T2: 切替後スモークテスト失敗で自動ロールバックされる（set -eで握りつぶされない）"
echo "=========================================================="
echo "old-rev-2" > "${STATE_FILE}"
echo "fail" > "${SMOKE_RESULT_FILE}"
: > "${CALL_LOG}"
CONFIRM_MANUAL_UI_CHECK=yes bash promote-revision-tokyo.sh new-rev-2-bad >"${TMP}/t2.out" 2>&1
rc=$?
if [[ ${rc} -ne 0 ]]; then pass "終了コード非0（失敗を検知）"; else fail "終了コード0（失敗を検知できていない）"; fi
if [[ "$(cat "${STATE_FILE}")" == "old-rev-2" ]]; then pass "トラフィックがold-rev-2へ自動的に戻った"; else fail "自動ロールバックされていない: $(cat "${STATE_FILE}")"; fi
if [[ "$(update_traffic_calls)" == "2" ]]; then pass "update-trafficが2回（切替＋自動ロールバック）呼ばれた"; else fail "update-traffic呼び出し回数が不正: $(update_traffic_calls)"; fi
if grep -q "自動ロールバック完了" "${TMP}/t2.out"; then pass "自動ロールバック完了メッセージが出力された"; else fail "自動ロールバック完了メッセージが無い: $(cat "${TMP}/t2.out")"; fi

echo
echo "=========================================================="
echo " T3: CONFIRM_MANUAL_UI_CHECKが無ければ何もせず停止する"
echo "=========================================================="
echo "old-rev-3" > "${STATE_FILE}"
echo "pass" > "${SMOKE_RESULT_FILE}"
: > "${CALL_LOG}"
CONFIRM_MANUAL_UI_CHECK=no bash promote-revision-tokyo.sh new-rev-3 >"${TMP}/t3.out" 2>&1
rc=$?
if [[ ${rc} -ne 0 ]]; then pass "終了コード非0"; else fail "終了コード0（ゲートが機能していない）"; fi
if [[ ! -s "${CALL_LOG}" ]]; then pass "gcloudが一度も呼ばれていない（ゲートは副作用前に停止）"; else fail "ゲート前にgcloudが呼ばれた: $(cat "${CALL_LOG}")"; fi
if [[ "$(cat "${STATE_FILE}")" == "old-rev-3" ]]; then pass "トラフィックは変更されていない"; else fail "トラフィックが変更されてしまった: $(cat "${STATE_FILE}")"; fi

echo
echo "=========================================================="
echo " T4: firebase.jsonにpinTag: trueが残っていればpromoteは停止する"
echo "=========================================================="
PINNED_CONFIG="${TMP}/firebase-pinned.json"
cat > "${PINNED_CONFIG}" <<'EOF'
{
  "hosting": {
    "rewrites": [
      {"source": "**", "run": {"serviceId": "vcafe-dashboard", "region": "asia-northeast1", "pinTag": true}}
    ]
  }
}
EOF
echo "old-rev-4" > "${STATE_FILE}"
: > "${CALL_LOG}"
FIREBASE_CONFIG_PATH="${PINNED_CONFIG}" CONFIRM_MANUAL_UI_CHECK=yes bash promote-revision-tokyo.sh new-rev-4 >"${TMP}/t4.out" 2>&1
rc=$?
if [[ ${rc} -ne 0 ]]; then pass "終了コード非0"; else fail "終了コード0（pinTagガードが機能していない）"; fi
if [[ ! -s "${CALL_LOG}" ]]; then pass "gcloudが一度も呼ばれていない"; else fail "ガード前にgcloudが呼ばれた: $(cat "${CALL_LOG}")"; fi

echo
echo "=========================================================="
echo " T5: rollbackはfirebaseを一切呼ばずにtrafficだけ戻す"
echo "=========================================================="
echo "buggy-rev" > "${STATE_FILE}"
echo "pass" > "${SMOKE_RESULT_FILE}"
: > "${CALL_LOG}"
bash rollback-revision-tokyo.sh good-old-rev >"${TMP}/t5.out" 2>&1
rc=$?
if [[ ${rc} -eq 0 ]]; then pass "終了コード0"; else fail "終了コード${rc}（0を期待）: $(cat "${TMP}/t5.out")"; fi
if [[ "$(cat "${STATE_FILE}")" == "good-old-rev" ]]; then pass "トラフィックがgood-old-revへ戻った"; else fail "トラフィックが期待通りでない: $(cat "${STATE_FILE}")"; fi
if [[ "$(update_traffic_calls)" == "1" ]]; then pass "update-trafficは1回のみ呼ばれた"; else fail "update-traffic呼び出し回数が不正: $(update_traffic_calls)"; fi
if command -v firebase >/dev/null 2>&1; then fail "PATH上にfirebaseが見えてしまっている（テスト環境が不完全）"; else pass "PATH上にfirebaseは存在しない（rollbackがfirebaseに依存していないことの裏付け）"; fi

echo
echo "=========================================================="
echo " T6: rollbackもpinTag残存時は停止する"
echo "=========================================================="
echo "buggy-rev-2" > "${STATE_FILE}"
: > "${CALL_LOG}"
FIREBASE_CONFIG_PATH="${PINNED_CONFIG}" bash rollback-revision-tokyo.sh good-old-rev-2 >"${TMP}/t6.out" 2>&1
rc=$?
if [[ ${rc} -ne 0 ]]; then pass "終了コード非0"; else fail "終了コード0（pinTagガードが機能していない）"; fi
if [[ ! -s "${CALL_LOG}" ]]; then pass "gcloudが一度も呼ばれていない"; else fail "ガード前にgcloudが呼ばれた: $(cat "${CALL_LOG}")"; fi

echo
echo "=========================================================="
if (( FAILED == 0 )); then
  echo " すべて成功しました。"
  exit 0
fi
echo " ★ ${FAILED} 件失敗しました。"
exit 1
