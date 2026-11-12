#!/usr/bin/env bash
# 第2段階 手順1: 売上の作り直しに必要な列・テーブル・ビューを分析用BigQueryに追加する（既存データは変わらない）
#   cheki_raw.chekiType   … 無料チェキ（誕生日プレゼント等）の判定
#   bookings_raw          … 予約・招待（コインは予約時に消費されるため、ここで売上を計上する）
#   bookings_current      … 予約・招待の最新状態のビュー
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
T="vcafe-admin-analytics.vcafe_analytics"

echo "# cheki_raw に chekiType 列を追加します（既にあれば何もしません）"
bq query --project_id=$P --use_legacy_sql=false --quiet "ALTER TABLE \`$T.cheki_raw\` ADD COLUMN IF NOT EXISTS chekiType STRING"

echo "# bookings_raw テーブルと bookings_current ビューを作成します（既にあれば何もしません）"
# schema.sql から該当の2文だけを取り出して実行する（他のビューは触らない）。
python3 - "${SYNC_DIR}/schema.sql" "$P" <<'PY'
import re, subprocess, sys
sql = open(sys.argv[1], encoding="utf-8").read().replace("PROJECT_ID", "vcafe-admin-analytics").replace("DATASET_ID", "vcafe_analytics")
for name in ["bookings_raw", "bookings_current"]:
    stmt = next(s for s in sql.split(";") if re.search(rf"`vcafe-admin-analytics\.vcafe_analytics\.{name}`\s*(\(|AS)", s))
    body = "\n".join(l for l in stmt.strip().splitlines() if not l.strip().startswith("--"))
    print(f"  - {name}")
    subprocess.run(["bq", f"--project_id={sys.argv[2]}", "query", "--use_legacy_sql=false", "--quiet"], input=body, text=True, check=True)
PY

echo
echo "=== 全テーブルの列の照合 ==="
if bash "${SYNC_DIR}/check-bigquery-schema.sh"; then
  echo
  echo "→ OK。次へ進めます:  bash ${HERE}/step3-update-job-image.sh"
else
  echo
  echo "→ 不足している列があります。次へ進まず、この出力を貼ってください。apply-schema.sh は実行しないでください。"
  exit 1
fi
