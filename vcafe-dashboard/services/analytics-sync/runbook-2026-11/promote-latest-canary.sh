#!/usr/bin/env bash
# 直前に deploy-revision-tokyo.sh で作った検証用の版（canary-<コミット>）を本番に切り替える。
# 版の名前を手で写さなくてよいようにするための補助。切替・自動切り戻しの処理は promote-revision-tokyo.sh が行う。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
SHA=$(git -C "${DASHBOARD_DIR}" rev-parse --short HEAD)
REV=$(gcloud run services describe vcafe-dashboard --region=$R --project=$P --format=json \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(next((t['revisionName'] for t in d['status'].get('traffic',[]) if t.get('tag')=='canary-${SHA}'), ''))")
[[ -n "${REV}" ]] || { echo "検証用の版（canary-${SHA}）が見つかりません。先に deploy-revision-tokyo.sh を実行してください。"; exit 1; }
echo "切り替える版: ${REV}"
confirm "検証用URLで画面を確認済みであれば、この版を本番に切り替えます。"
CONFIRM_MANUAL_UI_CHECK=yes bash "${DASHBOARD_DIR}/promote-revision-tokyo.sh" "${REV}"
