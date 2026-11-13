#!/usr/bin/env bash
# 直前に deploy-revision-tokyo.sh で作った検証用の版を探し、その検証用URLを表示してスモークテストを実行する。
# 検証用URLを手で写さなくてよいようにするための補助（読み取りのみ・本番のトラフィックは変えない）。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
SHA=$(git -C "${DASHBOARD_DIR}" rev-parse --short HEAD)
TRAFFIC_JSON=$(gcloud run services describe vcafe-dashboard --region=$R --project=$P --format=json)
NEWEST=$(gcloud run revisions list --service=vcafe-dashboard --region=$R --project=$P --sort-by=~metadata.creationTimestamp --format='value(metadata.name)' --limit=30)
read -r TAG URL < <(SHA="${SHA}" NEWEST="${NEWEST}" python3 -c '
import json, os, sys
d = json.loads(sys.stdin.read())
entries = {t["revisionName"]: (t["tag"], t.get("url", "")) for t in d["status"].get("traffic", []) if str(t.get("tag", "")).startswith("canary-")}
exact = [r for r, (tag, _) in entries.items() if tag == "canary-" + os.environ["SHA"]]
newest = [r for r in os.environ["NEWEST"].split() if r in entries]
rev = (exact or newest or [None])[0]
print(*(entries[rev] if rev else ("", "")))
' <<<"${TRAFFIC_JSON}")
[[ -n "${URL:-}" ]] || { echo "検証用の版（canary-...）が見つかりません。先に deploy-revision-tokyo.sh を実行してください。"; exit 1; }
echo "検証用の版: ${TAG}"
echo "検証用URL : ${URL}"
echo "（このURLをブラウザで開いて、画面の確認に使ってください）"
echo
bash "${DASHBOARD_DIR}/smoke-test-revision.sh" "${URL}"
