#!/usr/bin/env bash
# 差し替え前のプログラム名を、同期ジョブの実行履歴から探して戻し先として記録する（読み取りのみ）。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

CURRENT=$(current_job_image)
echo "現在のプログラム: ${CURRENT:-（読み取れず）}"
echo
echo "=== 直近の実行と、そのとき使われたプログラム ==="
FOUND=""
for name in $(gcloud run jobs executions list --job=$JOB --region=$R --project=$P --limit=8 --format='value(metadata.name)'); do
  img=$(gcloud run jobs executions describe "$name" --region=$R --project=$P --format=yaml \
    | awk '$1 == "image:" || $1 == "-" && $2 == "image:" { print $NF; exit }')
  created=$(gcloud run jobs executions describe "$name" --region=$R --project=$P --format='value(metadata.creationTimestamp)')
  echo "${created}  ${name}  ${img}"
  if [[ -z "${FOUND}" && -n "${img}" && "${img}" != "${CURRENT}" ]]; then FOUND="${img}"; fi
done
echo
if [[ -n "${FOUND}" ]]; then
  echo "${FOUND}" > "${PREV_IMAGE_FILE}"
  echo "→ 差し替え前のプログラムは ${FOUND} です。戻し先として記録しました。"
else
  echo "→ 差し替え前のプログラムを特定できませんでした。この出力を貼ってください。"
  exit 1
fi
