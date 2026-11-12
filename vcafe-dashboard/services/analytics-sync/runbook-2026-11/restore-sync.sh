#!/usr/bin/env bash
# 再取り込みが途中で中断された（Cloud Shell が切れた等）ときの復旧。
# 再取り込み用の設定を外し、毎時の定期同期を再開する。何度実行しても安全。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
gcloud run jobs update $JOB --region=$R --project=$P --remove-env-vars=BACKFILL_FROM,BACKFILL_TO,BOOKINGS >/dev/null
gcloud scheduler jobs resume $SCHEDULER --project=$P --location=$R >/dev/null
echo "定期同期: $(gcloud scheduler jobs describe $SCHEDULER --project=$P --location=$R --format='value(state)')"
echo "再取り込み用の設定の残り: $(gcloud run jobs describe $JOB --region=$R --project=$P --format=yaml | grep -c 'BACKFILL_\|name: BOOKINGS' || true) 件"
