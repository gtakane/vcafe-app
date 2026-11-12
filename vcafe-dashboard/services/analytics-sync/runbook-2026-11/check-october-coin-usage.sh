#!/usr/bin/env bash
# 10月にご帰宅以外で使われたコイン（予約・招待）と、無料チェキの枚数を数える（読み取りのみ・数分かかる）
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[[ -d "${SYNC_DIR}/node_modules/firebase-admin" ]] || (cd "${SYNC_DIR}" && npm install --no-audit --no-fund >/dev/null 2>&1)
node "${HERE}/october-coin-usage.mjs"
