#!/usr/bin/env bash
# recordKey 移行の検証（読み取りのみ）。docs/migration-recordkey.md の④で使う。
#   bash verify-migration.sh
set -uo pipefail

PROJECT_ID="${PROJECT_ID:-vcafe-admin-analytics}"
DS="${BIGQUERY_DATASET:-vcafe_analytics}"
echo "# project=${PROJECT_ID} dataset=${DS}"
q() { bq --project_id="${PROJECT_ID}" query --use_legacy_sql=false --format=pretty "$1"; }

echo
echo "== 1) recordKey が全行に入っているか（★すべて0でなければ切替不可） =="
q "SELECT 'visits' AS t, COUNTIF(recordKey IS NULL) AS missing, COUNT(*) AS rows_total FROM \`${PROJECT_ID}.${DS}.visits_raw\`
   UNION ALL SELECT 'cheki', COUNTIF(recordKey IS NULL), COUNT(*) FROM \`${PROJECT_ID}.${DS}.cheki_raw\`
   UNION ALL SELECT 'shifts', COUNTIF(recordKey IS NULL), COUNT(*) FROM \`${PROJECT_ID}.${DS}.shifts_raw\`
   UNION ALL SELECT 'presents', COUNTIF(recordKey IS NULL), COUNT(*) FROM \`${PROJECT_ID}.${DS}.presents_raw\`
   UNION ALL SELECT 'payments', COUNTIF(recordKey IS NULL), COUNT(*) FROM \`${PROJECT_ID}.${DS}.payments_raw\`
   UNION ALL SELECT 'customers', COUNTIF(recordKey IS NULL), COUNT(*) FROM \`${PROJECT_ID}.${DS}.customers_raw\`
   ORDER BY t"

echo
echo "== 2) ★ document.id の衝突実測（同じidで recordKey が複数＝旧実装なら消えていた行） =="
q "SELECT 'visits' AS t, COUNT(*) AS colliding_ids FROM (
     SELECT id FROM \`${PROJECT_ID}.${DS}.visits_raw\` WHERE recordKey IS NOT NULL
     GROUP BY id HAVING COUNT(DISTINCT recordKey) > 1)
   UNION ALL SELECT 'payments', COUNT(*) FROM (
     SELECT id FROM \`${PROJECT_ID}.${DS}.payments_raw\` WHERE recordKey IS NOT NULL
     GROUP BY id HAVING COUNT(DISTINCT recordKey) > 1)
   UNION ALL SELECT 'presents', COUNT(*) FROM (
     SELECT id FROM \`${PROJECT_ID}.${DS}.presents_raw\` WHERE recordKey IS NOT NULL
     GROUP BY id HAVING COUNT(DISTINCT recordKey) > 1)"

echo
echo "== 3) HMAC 衝突の有無（同じ recordKey で異なる id。0であること） =="
q "SELECT COUNT(*) AS hmac_collisions FROM (
     SELECT recordKey FROM \`${PROJECT_ID}.${DS}.visits_raw\` WHERE recordKey IS NOT NULL
     GROUP BY recordKey HAVING COUNT(DISTINCT id) > 1)"

echo
echo "== 4) 切替後の件数比較（id基準 vs recordKey基準） =="
q "WITH by_id AS (
     SELECT COUNT(*) AS n FROM (SELECT id FROM \`${PROJECT_ID}.${DS}.visits_raw\` GROUP BY id)
   ), by_key AS (
     SELECT COUNT(*) AS n FROM (SELECT recordKey FROM \`${PROJECT_ID}.${DS}.visits_raw\` WHERE recordKey IS NOT NULL GROUP BY recordKey)
   )
   SELECT by_id.n AS distinct_ids, by_key.n AS distinct_record_keys, by_key.n - by_id.n AS recovered_rows
   FROM by_id, by_key"

echo
echo "== 5) 課金: 月別カバレッジ（台帳のある月／旧ソースで補完される月） =="
q "WITH latest AS (
     SELECT * EXCEPT(rn) FROM (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY COALESCE(recordKey, id) ORDER BY syncedAt DESC) AS rn
       FROM \`${PROJECT_ID}.${DS}.payments_raw\`)
     WHERE rn = 1)
   SELECT FORMAT_DATE('%Y%m', DATE(\`at\`, 'Asia/Tokyo')) AS ym,
          COUNTIF(source = 'userPayments') AS ledger_rows,
          COUNTIF(COALESCE(source,'legacy') != 'userPayments') AS legacy_rows,
          IF(COUNTIF(source = 'userPayments') > 0, '台帳を使用', '旧ソースで補完') AS resolution
   FROM latest GROUP BY ym ORDER BY ym"

echo
echo "== 6) 失敗決済の除外による差分 =="
q "SELECT COALESCE(source,'legacy') AS source,
          COUNT(*) AS rows_total,
          COUNTIF(LOWER(status) LIKE '%fail%' OR LOWER(status) LIKE '%cancel%' OR LOWER(status) LIKE '%refund%') AS excluded,
          ROUND(SUM(IF(LOWER(status) LIKE '%fail%' OR LOWER(status) LIKE '%cancel%' OR LOWER(status) LIKE '%refund%', amount, 0))) AS excluded_yen
   FROM \`${PROJECT_ID}.${DS}.payments_raw\` GROUP BY source ORDER BY source"

echo
echo "----"
echo "判定:"
echo "・1) の missing がすべて0 → 切替可能。1件でもあれば再バックフィル未完了"
echo "・2) が0より大 → 旧実装(PARTITION BY id)で実際に消えていた行がある。切替で復活する"
echo "・3) は必ず0（HMAC衝突）。0以外なら実装バグなので報告すること"
echo "・4) の recovered_rows が正の値 → その分だけ件数が増える（正常）"
echo "・5) の resolution が全月「台帳を使用」→ 移行完了。混在は移行途中の正常な状態"
