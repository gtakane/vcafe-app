#!/usr/bin/env bash
# 手順3の戻し: 同期ジョブのプログラムを差し替え前に戻す
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[[ -f "${PREV_IMAGE_FILE}" ]] || { echo "戻し先の記録がありません（手順3を実行していない）"; exit 1; }
PREV=$(cat "${PREV_IMAGE_FILE}")
confirm "同期ジョブのプログラムを ${PREV} に戻します。"
gcloud run jobs update $JOB --region=$R --project=$P --image="${PREV}"
echo "→ 戻しました。"
