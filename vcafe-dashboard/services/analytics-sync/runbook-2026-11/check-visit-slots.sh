#!/usr/bin/env bash
# メイドお給仕ポータルの「ご帰宅枠数」（2026年11月1〜11日）を本番の記録から数え直して並べる（読み取りのみ）。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[[ -d "${SYNC_DIR}/node_modules/firebase-admin" ]] || (cd "${SYNC_DIR}" && npm install --no-audit --no-fund >/dev/null 2>&1)
(cd "${SYNC_DIR}" && node "${HERE}/visit-slots.mjs")
