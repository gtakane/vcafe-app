#!/usr/bin/env bash
# 初回設定がすべて済んでいるか、同期が正常に動いているかを確かめる（読み取りのみ・何も変更しない）。
# 「OK」だけなら問題なし。「NG」があれば、その行に書いてある対処をする。
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
NG=0
ok() { printf '  OK   %s\n' "$1"; }
ng() { printf '  NG   %s\n       → %s\n' "$1" "$2"; NG=$((NG + 1)); }

echo "=== 1. BigQuery の表と列（step9・step11・step12） ==="
if OUT=$(bash "${SYNC_DIR}/check-bigquery-schema.sh" 2>&1); then
  ok "すべての表・列がそろっています"
else
  echo "${OUT}" | grep -E "BigQuery に" | sed 's/^/       /'
  ng "表・列が足りません" "付録の初回設定（step9-test-user-columns.sh・step11-monthly-kpi-tables.sh・step12-kpi-manual-input.sh）を実行する"
fi

echo "=== 2. 運営の月次CSVの取り込み ==="
ROWS=$(bq query --project_id=$P --use_legacy_sql=false --format=csv --quiet "SELECT COUNT(*) FROM \`${P}.${DS}.monthly_kpi_history\`" 2>/dev/null | tail -1)
if [[ "${ROWS}" =~ ^[0-9]+$ && "${ROWS}" -gt 0 ]]; then ok "取り込み済み（${ROWS} か月分）"; else ng "取り込まれていません" "手順書の「運営の月次CSVを取り込み直す」を行う"; fi

echo "=== 3. 月次指標の手入力の権限（step12） ==="
SA=$(gcloud run services describe vcafe-dashboard --region=$R --project=$P --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null)
if [[ -z "${SA}" ]]; then
  ng "ダッシュボードの実行SAを読み取れませんでした" "この出力を貼って相談する"
elif bq get-iam-policy --format=prettyjson "${P}:${DS}.monthly_kpi_overrides" 2>/dev/null | grep -q "serviceAccount:${SA}"; then
  ok "ダッシュボード（${SA}）が手入力の表に書き込めます"
else
  ng "ダッシュボードに手入力の表への書き込み権限がありません" "step12-kpi-manual-input.sh を実行する"
fi

echo "=== 4. 同期ジョブのプログラム ==="
IMAGE=$(current_job_image)
TAG=${IMAGE##*:}
git -C "${DASHBOARD_DIR}" fetch -q origin 2>/dev/null || true
if [[ -n "${TAG}" ]] && git -C "${DASHBOARD_DIR}" merge-base --is-ancestor 5d88a9c "${TAG}" 2>/dev/null; then
  ok "テストユーザーを取り込む版です（${TAG}）"
else
  ng "古い版です（${TAG:-読み取れず}）" "step3-update-job-image.sh を実行する"
fi
LEFT=$(gcloud run jobs describe $JOB --region=$R --project=$P --format=yaml 2>/dev/null | grep -c 'name: BACKFILL_\|name: BOOKINGS\|name: BALANCES\|name: SYNC_ALL_USERS\|name: SYNC_TEST_USERS' || true)
if [[ "${LEFT}" == "0" ]]; then ok "取り込み直し用の一時設定は残っていません"; else ng "取り込み直し用の一時設定が ${LEFT} 件残っています" "restore-sync.sh を実行する"; fi

echo "=== 5. 毎時の同期 ==="
STATE=$(gcloud scheduler jobs describe $SCHEDULER --project=$P --location=$R --format='value(state)' 2>/dev/null)
if [[ "${STATE}" == "ENABLED" ]]; then ok "毎時の同期は動いています（ENABLED）"; else ng "毎時の同期が止まっています（${STATE:-読み取れず}）" "restore-sync.sh を実行する"; fi
# 実行中のものは飛ばし、終わった直近の1回を見る。
LAST=$(gcloud run jobs executions list --job=$JOB --region=$R --project=$P --limit=5 \
  --format='csv[no-heading](status.completionTime,status.succeededCount)' 2>/dev/null | awk -F, '$1 != "" { print; exit }')
LAST_AT=${LAST%%,*}; LAST_OK=${LAST#*,}
if [[ -z "${LAST}" ]]; then
  ng "同期の実行履歴を読み取れませんでした" "この出力を貼って相談する"
elif [[ "${LAST_OK}" == "1" ]]; then
  ok "直近の同期は成功しています（終了 ${LAST_AT}、UTC）"
else
  ng "直近の同期が失敗しています（終了 ${LAST_AT}、UTC）" "この出力を貼って相談する"
fi

echo
if (( NG == 0 )); then echo "→ すべてOKです。"; else echo "→ NG が ${NG} 件あります。各行の「→」の対処をしてください。"; fi
