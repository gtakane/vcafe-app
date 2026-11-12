#!/usr/bin/env bash
# 手順4: 10/15〜現在を再取り込みする（欠落日の埋め戻し＋11/6以降の無料判定のやり直し）
# 本番Firestoreは読み取りのみ。BigQuery は追記のみで、新しい行が採用されるため二重計上にはならない。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
# 使い方: bash step4-backfill.sh [開始日 YYYY-MM-DD]（既定 2026-10-15）
#   期間が長い場合は1か月ずつ区切って実行する（1回の実行時間の上限に掛からないようにするため）。
#   あわせて予約・招待（bookings）も1回取り込む。
FROM=${1:-2026-10-15}
TO=$(date -u -d tomorrow +%F)

# 同期ジョブのプログラムが、無料判定の変更（cc8f291）を含むコミットから作られているか確認する。
CURRENT=$(current_job_image)
TAG="${CURRENT##*:}"
if [[ -z "${CURRENT}" ]] || ! git -C "${DASHBOARD_DIR}" merge-base --is-ancestor cc8f291 "${TAG}" 2>/dev/null; then
  echo "同期ジョブがまだ新しいプログラムになっていません（現在: ${CURRENT:-読み取れず}）。先に手順3を実行してください。"; exit 1
fi
if ! git -C "${DASHBOARD_DIR}" grep -q "syncBalances" "${TAG}" -- services/analytics-sync/src/index.ts 2>/dev/null; then
  echo "同期ジョブのプログラムが最新ではありません（現在: ${CURRENT}）。"
  echo "先に手順3をもう一度実行してください:  bash ${HERE}/step3-update-job-image.sh"; exit 1
fi
echo "同期ジョブのプログラム: ${CURRENT}"

echo "取り込み期間: ${FROM} 〜 ${TO}（UTC・終了日は含まない）"
confirm "毎時の定期同期を一時停止し、この期間を再取り込みします（10〜20分ほど）。終わったら自動で元に戻します。"

PAUSED=0; UPDATED=0
cleanup() {
  local code=$?
  echo
  if [[ ${UPDATED} == 1 ]]; then
    echo "# 再取り込み用の設定を外します"
    gcloud run jobs update $JOB --region=$R --project=$P --remove-env-vars=BACKFILL_FROM,BACKFILL_TO,BOOKINGS,BALANCES,SYNC_ALL_USERS \
      || echo "!!! 設定を外せませんでした。この出力を貼ってください（このままだと毎時同じ期間を読み直します）"
  fi
  if [[ ${PAUSED} == 1 ]]; then
    echo "# 毎時の定期同期を再開します"
    gcloud scheduler jobs resume $SCHEDULER --project=$P --location=$R \
      || echo "!!! 定期同期を再開できませんでした。この出力を貼ってください"
  fi
  if [[ ${code} == 0 ]]; then
    echo "→ 再取り込み完了。手順5へ進めます:  bash ${HERE}/step5-verify.sh"
  else
    echo "→ 再取り込みが途中で失敗しました。上のエラーを貼ってください（定期同期は元に戻してあります）。"
  fi
}
trap cleanup EXIT

gcloud scheduler jobs pause $SCHEDULER --project=$P --location=$R; PAUSED=1
# 1か月ずつの区間に分ける（例: 2026-04-01→05-01, 05-01→06-01, …, 最終区間は TO まで）
RANGES=()
cur="${FROM}"
while [[ "${cur}" < "${TO}" ]]; do
  nxt=$(date -u -d "$(date -u -d "${cur}" +%Y-%m-01) +1 month" +%F)
  [[ "${nxt}" > "${TO}" ]] && nxt="${TO}"
  RANGES+=("${cur} ${nxt}")
  cur="${nxt}"
done
i=0
for range in "${RANGES[@]}"; do
  set -- ${range}
  i=$((i + 1))
  echo
  echo "# [${i}/${#RANGES[@]}] ${1} 〜 ${2}"
  EXTRA=""
  # 予約・招待、未使用残高、全会員の属性は全件の読み直しなので、最初の区間で1回だけ行う
  if [[ ${i} == 1 ]]; then EXTRA=",BOOKINGS=always,BALANCES=always,SYNC_ALL_USERS=true"; fi
  gcloud run jobs update $JOB --region=$R --project=$P --update-env-vars="BACKFILL_FROM=${1},BACKFILL_TO=${2}${EXTRA}" >/dev/null; UPDATED=1
  gcloud run jobs execute $JOB --region=$R --project=$P --wait
  if [[ ${i} == 1 ]]; then gcloud run jobs update $JOB --region=$R --project=$P --remove-env-vars=BOOKINGS,BALANCES,SYNC_ALL_USERS >/dev/null; fi
done
