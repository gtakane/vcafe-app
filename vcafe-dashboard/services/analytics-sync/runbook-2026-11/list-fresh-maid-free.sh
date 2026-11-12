#!/usr/bin/env bash
# 新人メイド無料のご帰宅の明細を表示する（読み取りのみ）
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[[ -d "${SYNC_DIR}/node_modules/firebase-admin" ]] || (cd "${SYNC_DIR}" && npm install --no-audit --no-fund >/dev/null 2>&1)
node "${HERE}/list-fresh-maid-free.mjs"
