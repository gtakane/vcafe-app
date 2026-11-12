#!/usr/bin/env bash
# 直前に deploy-revision-tokyo.sh で作った検証用の版（canary-<コミット>）を本番に切り替える。
# 版の名前を手で写さなくてよいようにするための補助。切替・自動切り戻しの処理は promote-revision-tokyo.sh が行う。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
SHA=$(git -C "${DASHBOARD_DIR}" rev-parse --short HEAD)
# 手元のコミットの検証用の版を優先し、無ければ（同期だけを直したコミットを取り込んだ後など）
# 最も新しく作られた検証用の版を選ぶ。どちらの場合も切替前に版の名前とタグを表示して確認を求める。
TRAFFIC_JSON=$(gcloud run services describe vcafe-dashboard --region=$R --project=$P --format=json)
NEWEST=$(gcloud run revisions list --service=vcafe-dashboard --region=$R --project=$P --sort-by=~metadata.creationTimestamp --format='value(metadata.name)' --limit=30)
read -r REV TAG < <(SHA="${SHA}" NEWEST="${NEWEST}" python3 -c '
import json, os, sys
d = json.loads(sys.stdin.read())
tags = {t["revisionName"]: t["tag"] for t in d["status"].get("traffic", []) if str(t.get("tag", "")).startswith("canary-")}
exact = [r for r, t in tags.items() if t == "canary-" + os.environ["SHA"]]
newest = [r for r in os.environ["NEWEST"].split() if r in tags]
rev = (exact or newest or [""])[0]
print(rev, tags.get(rev, ""))
' <<<"${TRAFFIC_JSON}")
[[ -n "${REV:-}" ]] || { echo "検証用の版（canary-...）が見つかりません。先に deploy-revision-tokyo.sh を実行してください。"; exit 1; }
[[ "${TAG}" == "canary-${SHA}" ]] || echo "※ 手元のコミット ${SHA} の検証用の版は無いため、最も新しい検証用の版 ${TAG} を選びました。"
echo "検証用URL: $(python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); print(next((t.get("url","") for t in d["status"].get("traffic",[]) if t.get("revisionName")==sys.argv[1]), ""))' "${REV}" <<<"${TRAFFIC_JSON}")"
echo "切り替える版: ${REV}"
confirm "検証用URLで画面を確認済みであれば、この版を本番に切り替えます。"
CONFIRM_MANUAL_UI_CHECK=yes bash "${DASHBOARD_DIR}/promote-revision-tokyo.sh" "${REV}"
