#!/usr/bin/env bash
# 未使用残高（前受金）と月の確定売上の準備（分析用BigQueryのみ。既存データは変わらない）
#   customers_raw.coinApple / coinGoogle … 会員ごとのApple/Googleコイン残高（ユーザーDBに表示）
#   payments_raw.vendor                  … 課金の購入元（apple/google）
#   balance_snapshots                    … 未使用残高の記録（毎日朝5時に全会員の合計を1行）
# あわせて、経理が書き出した11/1時点の残高を「基準値」として1行入れる（11月の確定売上の期首）。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
T="vcafe-admin-analytics.vcafe_analytics"

echo "# 列を追加します（既にあれば何もしません）"
bq query --project_id=$P --use_legacy_sql=false --quiet "ALTER TABLE \`$T.customers_raw\` ADD COLUMN IF NOT EXISTS coinApple FLOAT64, ADD COLUMN IF NOT EXISTS coinGoogle FLOAT64"
bq query --project_id=$P --use_legacy_sql=false --quiet "ALTER TABLE \`$T.payments_raw\` ADD COLUMN IF NOT EXISTS vendor STRING"

echo "# balance_snapshots テーブルを作成します（既にあれば何もしません）"
python3 - "${SYNC_DIR}/schema.sql" "$P" <<'PY'
import re, subprocess, sys
sql = open(sys.argv[1], encoding="utf-8").read().replace("PROJECT_ID", "vcafe-admin-analytics").replace("DATASET_ID", "vcafe_analytics")
stmt = next(s for s in sql.split(";") if re.search(r"`vcafe-admin-analytics\.vcafe_analytics\.balance_snapshots`\s*\(", s))
body = "\n".join(l for l in stmt.strip().splitlines() if not l.strip().startswith("--"))
subprocess.run(["bq", f"--project_id={sys.argv[2]}", "query", "--use_legacy_sql=false", "--quiet"], input=body, text=True, check=True)
PY

echo "# 経理の書き出し（2026/11/1時点・テストユーザー/運営関係者除く）を基準値として登録します"
EXISTS=$(bq query --project_id=$P --use_legacy_sql=false --format=csv "SELECT COUNT(*) FROM \`$T.balance_snapshots\` WHERE source = 'accounting-export-20261101'" | tail -1)
if [[ "${EXISTS}" == "0" ]]; then
  bq query --project_id=$P --use_legacy_sql=false --quiet "
    INSERT INTO \`$T.balance_snapshots\` (snapshotAt, source, appleCoin, googleCoin, legacyCoin, rewardPoint, ticketGokitaku, ticketPremium, ticketRandom, ticketCheki, ticketChekiFree, ticketOther, syncedAt)
    VALUES (TIMESTAMP '2026-10-31 20:00:00+00', 'accounting-export-20261101', 381465, 197210, 0, 1255799, 455, 138, 64, 553, 86, 0, CURRENT_TIMESTAMP())"
  echo "  登録しました"
else
  echo "  登録済みです"
fi

echo
echo "=== 全テーブルの列の照合 ==="
if bash "${SYNC_DIR}/check-bigquery-schema.sh"; then
  echo
  echo "→ OK。次へ進めます:  bash ${HERE}/step3-update-job-image.sh"
else
  echo
  echo "→ 不足している列があります。次へ進まず、この出力を貼ってください。"
  exit 1
fi
