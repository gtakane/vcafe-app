#!/usr/bin/env bash
# 手順4: 10/15〜現在を再取り込みする（欠落日の埋め戻し＋11/6以降の無料判定のやり直し）
# 本番Firestoreは読み取りのみ。BigQuery は追記のみで、新しい行が採用されるため二重計上にはならない。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
FROM=2026-10-15
TO=$(date -u -d tomorrow +%F)

# 同期ジョブのプログラムが、無料判定の変更（cc8f291）を含むコミットから作られているか確認する。
CURRENT=$(current_job_image)
TAG="${CURRENT##*:}"
if [[ -z "${CURRENT}" ]] || ! git -C "${DASHBOARD_DIR}" merge-base --is-ancestor cc8f291 "${TAG}" 2>/dev/null; then
  echo "同期ジョブがまだ新しいプログラムになっていません（現在: ${CURRENT:-読み取れず}）。先に手順3を実行してください。"; exit 1
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
    gcloud run jobs update $JOB --region=$R --project=$P --remove-env-vars=BACKFILL_FROM,BACKFILL_TO \
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
gcloud run jobs update $JOB --region=$R --project=$P --update-env-vars=BACKFILL_FROM=${FROM},BACKFILL_TO=${TO}; UPDATED=1
gcloud run jobs execute $JOB --region=$R --project=$P --wait
