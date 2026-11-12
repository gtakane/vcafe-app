#!/usr/bin/env bash
# 月次指標の表を作る（分析用BigQueryのみ。既にあれば何もしない）。
#   monthly_kpi_history … 運営の月次CSV（2026年10月以前）。import-monthly-kpi-csv.sh で入れる
#   monthly_kpi_manual  … メイド報酬（手入力）。set-maid-reward.sh で入れる
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
python3 - "${SYNC_DIR}/schema.sql" "$P" "$DS" <<'PY'
import re, subprocess, sys
sql = open(sys.argv[1], encoding="utf-8").read().replace("PROJECT_ID", sys.argv[2]).replace("DATASET_ID", sys.argv[3])
for name in ["monthly_kpi_history", "monthly_kpi_manual"]:
    stmt = next(s for s in sql.split(";") if re.search(rf"`{re.escape(sys.argv[2])}\.{sys.argv[3]}\.{name}`\s*\(", s))
    body = "\n".join(l for l in stmt.strip().splitlines() if not l.strip().startswith("--"))
    print(f"  - {name}")
    subprocess.run(["bq", f"--project_id={sys.argv[2]}", "query", "--use_legacy_sql=false", "--quiet"], input=body, text=True, check=True)
PY
echo "→ 完了。次は import-monthly-kpi-csv.sh <CSVのパス> で運営のCSVを取り込みます。"
