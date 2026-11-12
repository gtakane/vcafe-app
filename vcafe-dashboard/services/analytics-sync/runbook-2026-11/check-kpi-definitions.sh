#!/usr/bin/env bash
# 月次指標CSVの定義を、本番Firestoreから直接集計して確かめる（読み取りのみ・数分かかる）。
#   bash check-kpi-definitions.sh            … 2026年4月〜10月
#   bash check-kpi-definitions.sh 2026-09 2026-10
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[[ -d "${SYNC_DIR}/node_modules/firebase-admin" ]] || (cd "${SYNC_DIR}" && npm install --no-audit --no-fund >/dev/null 2>&1)
(cd "${SYNC_DIR}" && node "${HERE}/kpi-definitions.mjs" "${1:-2026-04}" "${2:-2026-10}")
