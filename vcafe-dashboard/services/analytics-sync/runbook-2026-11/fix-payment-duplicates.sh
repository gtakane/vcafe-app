#!/usr/bin/env bash
# 課金の二重計上を直す（分析用BigQueryのみ。本番Firestoreには触れない）
#   7/28 に古い版で取り込んだ行（識別番号29文字・recordKey なし）と、取り込み直した行（本番の番号20文字・recordKey あり）が
#   同じ課金として両方残っていた。新しい行と「同じ人・同じ時刻・同じ金額・同じ経路」で対になる古い行だけを削除する。
#   削除する行は先に控えのテーブルへ写すので、必要なら戻せる。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
T="vcafe-admin-analytics.vcafe_analytics"
BACKUP="payments_raw_dup_backup_20261112"
# 書き込み中の期間（直近）には触れない。重複は2026年7月までに限られることを確認済み。
LIMIT_DATE="2026-08-01"
TARGET="
  FROM \`$T.payments_raw\` o
  WHERE DATE(o.\`at\`) < DATE '${LIMIT_DATE}'
    AND o.source = 'userPayments' AND o.recordKey IS NULL
    AND EXISTS (
      SELECT 1 FROM \`$T.payments_raw\` n
      WHERE DATE(n.\`at\`) < DATE '${LIMIT_DATE}'
        AND n.source = 'userPayments' AND n.recordKey IS NOT NULL
        AND n.customerId = o.customerId AND n.\`at\` = o.\`at\` AND n.amount = o.amount AND n.channel = o.channel)"

echo "=== 削除の対象（古い形式で、新しい行と対になっているもの） ==="
bq query --project_id=$P --use_legacy_sql=false --format=pretty "
  SELECT FORMAT_DATE('%Y', DATE(o.\`at\`, 'Asia/Tokyo')) AS year, COUNT(*) AS row_count, COUNT(DISTINCT o.id) AS payments, ROUND(SUM(o.amount)) AS yen
  ${TARGET} GROUP BY year ORDER BY year"

confirm "上の行を控えのテーブル ${BACKUP} に写したうえで、分析用データから削除します。"

echo "# 控えを作成します"
bq query --project_id=$P --use_legacy_sql=false --quiet "CREATE TABLE IF NOT EXISTS \`$T.${BACKUP}\` AS SELECT o.* ${TARGET}"
echo "# 削除します"
bq query --project_id=$P --use_legacy_sql=false --quiet "DELETE $(echo "${TARGET}" | sed '1s/^ *FROM/FROM/')"

echo
echo "=== 削除後の確認（月ごとの重複件数。0件なら解消） ==="
bq query --project_id=$P --use_legacy_sql=false --format=pretty --max_rows=100 '
SELECT FORMAT_DATE("%Y-%m", DATE(`at`, "Asia/Tokyo")) AS month, COUNT(*) AS payments, ROUND(SUM(amount)) AS yen,
  COUNT(*) - COUNT(DISTINCT FORMAT("%s|%t|%f", customerId, `at`, amount)) AS still_duplicated
FROM vcafe_analytics.payments_current_range(DATE "2025-06-01", CURRENT_DATE("Asia/Tokyo"))
WHERE DATE(`at`, "Asia/Tokyo") >= DATE "2025-06-01"
GROUP BY month ORDER BY month'
echo
echo "→ 戻す必要がある場合: bq query --use_legacy_sql=false 'INSERT INTO \`$T.payments_raw\` SELECT * FROM \`$T.${BACKUP}\`'"
