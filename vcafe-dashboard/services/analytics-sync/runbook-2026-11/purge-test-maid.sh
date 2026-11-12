#!/usr/bin/env bash
# テスト用メイドを集計から外す。
#   bash purge-test-maid.sh うみのうみ
# 1) 分析用BigQueryから、そのメイドの maidId を名前で特定して表示する
# 2) 同期ジョブに EXCLUDED_MAID_IDS を設定し、以後は取り込まない
# 3) 取り込み済みの行を分析用BigQueryから削除する（本番Firestoreには一切触れない）
# 消した行は、設定を外して再取り込みすれば戻せる（元データは本番に残っている）。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
NAME="${1:-}"
[[ -n "${NAME}" ]] || { echo "使い方: bash purge-test-maid.sh <メイド名>"; exit 2; }

q() { bq query --project_id=$P --use_legacy_sql=false "$@"; }

echo "=== 「${NAME}」の maidId ==="
IDS=$(q --format=csv --parameter="name::${NAME}" \
  "SELECT DISTINCT id FROM ${DS}.maids_current WHERE name = @name UNION DISTINCT SELECT DISTINCT id FROM ${DS}.maid_profiles_current WHERE nickname = @name" \
  | tail -n +2 | tr -d '\r' | grep -v '^$' || true)
[[ -n "${IDS}" ]] || { echo "その名前のメイドが見つかりません。名前を確認してください。"; exit 1; }
echo "${IDS}"
ID_LIST=$(echo "${IDS}" | paste -sd, -)
ID_JSON="[$(echo "${IDS}" | sed 's/.*/"&"/' | paste -sd, -)]"

# テーブル名:メイドIDの列:パーティション列（空=分割なし）
TABLES="visits_raw:maidId:at cheki_raw:maidId:at presents_raw:maidId:at shifts_raw:maidId:scheduledStart maid_monthly_raw:maidId: maid_profiles_raw:id:"
count_rows() {
  for spec in ${TABLES}; do
    IFS=: read -r t col part <<< "${spec}"
    n=$(q --format=csv --parameter="ids:ARRAY<STRING>:${ID_JSON}" "SELECT COUNT(*) FROM ${DS}.${t} WHERE ${col} IN UNNEST(@ids)" | tail -1)
    printf '  %-18s %s 行\n' "${t}" "${n}"
  done
}
echo
echo "=== 取り込み済みの行数 ==="
count_rows

CURRENT=$(current_job_image); TAG="${CURRENT##*:}"
if ! git -C "${DASHBOARD_DIR}" cat-file -e "${TAG}:vcafe-dashboard/services/analytics-sync/src/excluded-maids.ts" 2>/dev/null; then
  echo
  echo "同期ジョブのプログラムが、メイド除外に対応していません（現在: ${CURRENT}）。"
  echo "先に手順3をもう一度実行してください:  bash ${HERE}/step3-update-job-image.sh"
  exit 1
fi

EXISTING=$(gcloud run jobs describe $JOB --region=$R --project=$P --format=yaml \
  | awk '/name: EXCLUDED_MAID_IDS/{getline; sub(/.*value: */,""); gsub(/["'"'"']/,""); print; exit}')
MERGED=$(printf '%s\n%s\n' "${EXISTING//,/$'\n'}" "${IDS}" | grep -v '^$' | sort -u | paste -sd, -)
echo
echo "同期ジョブの除外設定: ${EXISTING:-（なし）} → ${MERGED}"
confirm "上のメイドを以後取り込まないよう設定し、取り込み済みの行を分析用BigQueryから削除します。"

gcloud run jobs update $JOB --region=$R --project=$P --update-env-vars="^@^EXCLUDED_MAID_IDS=${MERGED}" >/dev/null
echo "# 除外設定を同期ジョブに反映しました"

REMAIN=0
for spec in ${TABLES}; do
  IFS=: read -r t col part <<< "${spec}"
  if out=$(q --parameter="ids:ARRAY<STRING>:${ID_JSON}" "DELETE FROM ${DS}.${t} WHERE ${col} IN UNNEST(@ids)" 2>&1); then
    echo "  ${t}: 削除しました"
  elif [[ "${out}" == *"streaming buffer"* && -n "${part}" ]]; then
    # 直近に書き込まれた期間は削除できない。それより古い期間だけ先に消す。
    q --parameter="ids:ARRAY<STRING>:${ID_JSON}" \
      "DELETE FROM ${DS}.${t} WHERE ${col} IN UNNEST(@ids) AND DATE(${part}) < DATE_SUB(CURRENT_DATE(), INTERVAL 5 DAY)" >/dev/null
    echo "  ${t}: 直近5日分は書き込み直後のため削除できず、それ以前を削除しました"
    REMAIN=1
  else
    echo "  ${t}: 失敗しました"; echo "${out}" | tail -3; REMAIN=1
  fi
done

echo
echo "=== 削除後の行数 ==="
count_rows
if [[ ${REMAIN} == 1 ]]; then
  echo
  echo "→ 一部が残っています。数日おいて、同じコマンドをもう一度実行してください（除外設定は済んでいるので、新しく増えることはありません）。"
else
  echo
  echo "→ 完了しました。"
fi
