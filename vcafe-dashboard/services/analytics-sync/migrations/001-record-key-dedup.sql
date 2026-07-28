-- 重複排除キーを document.id から recordKey（Firestoreフルパスの HMAC）へ切り替える。
--
-- ★ このファイルは「全期間の再バックフィルが完了し、recordKey が全行に入った後」にのみ適用する。
--   途中で適用すると、recordKey が NULL の旧行と recordKey を持つ新行が別パーティションになり、
--   同じドキュメントが二重に現れる。適用前チェックは docs/migration-recordkey.md を参照。
--
-- 適用前チェック（0件であること）:
--   SELECT COUNT(*) FROM `PROJECT_ID.DATASET_ID.visits_raw` WHERE recordKey IS NULL;
--
-- 並び順の根拠:
--   sourceUpdatedAt … Firestore の更新時刻。履歴修正を正しく反映するため最優先。
--   syncedAt        … 同期実行時刻。
--   runId           … 同一 syncedAt が並んだときの決定的なタイブレーク。

CREATE OR REPLACE VIEW `PROJECT_ID.DATASET_ID.presents_current` AS
SELECT * EXCEPT(row_number, syncedAt, runId)
FROM (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY recordKey
    ORDER BY COALESCE(sourceUpdatedAt, syncedAt) DESC, syncedAt DESC, runId DESC
  ) AS row_number
  FROM `PROJECT_ID.DATASET_ID.presents_raw`
)
WHERE row_number = 1;

CREATE OR REPLACE VIEW `PROJECT_ID.DATASET_ID.customers_current` AS
SELECT * EXCEPT(row_number, syncedAt, sourceUpdatedAt, runId, recordKey)
FROM (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY recordKey
    ORDER BY COALESCE(sourceUpdatedAt, syncedAt) DESC, syncedAt DESC, runId DESC
  ) AS row_number
  FROM `PROJECT_ID.DATASET_ID.customers_raw`
)
WHERE row_number = 1;

CREATE OR REPLACE VIEW `PROJECT_ID.DATASET_ID.shifts_current` AS
SELECT * EXCEPT(row_number, maidName, syncedAt, sourceUpdatedAt, runId, recordKey)
FROM (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY recordKey
    ORDER BY COALESCE(sourceUpdatedAt, syncedAt) DESC, syncedAt DESC, runId DESC
  ) AS row_number
  FROM `PROJECT_ID.DATASET_ID.shifts_raw`
)
WHERE row_number = 1;

-- 課金は source（userPayments / payments / purchaseLog）も明示的に区別する。
-- 同じ document.id が payments と purchaseLog の双方に存在し得るため。
CREATE OR REPLACE VIEW `PROJECT_ID.DATASET_ID.payments_current` AS
WITH latest AS (
  SELECT * EXCEPT(row_number, syncedAt, runId)
  FROM (
    SELECT *, ROW_NUMBER() OVER (
      PARTITION BY source, recordKey
      ORDER BY COALESCE(sourceUpdatedAt, syncedAt) DESC, syncedAt DESC, runId DESC
    ) AS row_number
    FROM `PROJECT_ID.DATASET_ID.payments_raw`
  )
  WHERE row_number = 1
), succeeded AS (
  SELECT * FROM latest
  WHERE status IS NULL
     OR (
          LOWER(status) NOT LIKE '%fail%'
      AND LOWER(status) NOT LIKE '%cancel%'
      AND LOWER(status) NOT LIKE '%refund%'
     )
), ledger_months AS (
  SELECT DISTINCT FORMAT_DATE('%Y%m', DATE(`at`, 'Asia/Tokyo')) AS ym
  FROM succeeded WHERE source = 'userPayments'
)
SELECT * FROM succeeded WHERE source = 'userPayments'
UNION ALL
SELECT * FROM succeeded
WHERE COALESCE(source, 'legacy') != 'userPayments'
  AND FORMAT_DATE('%Y%m', DATE(`at`, 'Asia/Tokyo')) NOT IN (SELECT ym FROM ledger_months);

CREATE OR REPLACE VIEW `PROJECT_ID.DATASET_ID.visits_current` AS
WITH latest_visits AS (
  SELECT * EXCEPT(row_number, syncedAt, sourceUpdatedAt, runId, recordKey)
  FROM (
    SELECT *, ROW_NUMBER() OVER (
      PARTITION BY recordKey
      ORDER BY COALESCE(sourceUpdatedAt, syncedAt) DESC, syncedAt DESC, runId DESC
    ) AS row_number
    FROM `PROJECT_ID.DATASET_ID.visits_raw`
  )
  WHERE row_number = 1
), latest_cheki AS (
  SELECT * EXCEPT(row_number, syncedAt, sourceUpdatedAt, runId, recordKey)
  FROM (
    SELECT *, ROW_NUMBER() OVER (
      PARTITION BY recordKey
      ORDER BY COALESCE(sourceUpdatedAt, syncedAt) DESC, syncedAt DESC, runId DESC
    ) AS row_number
    FROM `PROJECT_ID.DATASET_ID.cheki_raw`
  )
  WHERE row_number = 1
), cheki_daily AS (
  SELECT customerId, maidId, DATE(TIMESTAMP_SUB(`at`, INTERVAL 2 HOUR), "Asia/Tokyo") AS business_date, COUNT(*) AS cheki_count
  FROM latest_cheki GROUP BY customerId, maidId, business_date
), numbered_visits AS (
  SELECT v.*, ROW_NUMBER() OVER (PARTITION BY customerId, maidId, DATE(TIMESTAMP_SUB(`at`, INTERVAL 2 HOUR), "Asia/Tokyo") ORDER BY `at`) AS daily_row
  FROM latest_visits v
)
SELECT v.* EXCEPT(cheki, daily_row), IF(v.daily_row = 1, COALESCE(c.cheki_count, 0), 0) AS cheki
FROM numbered_visits v
LEFT JOIN cheki_daily c
  ON c.customerId = v.customerId AND c.maidId = v.maidId AND c.business_date = DATE(TIMESTAMP_SUB(v.`at`, INTERVAL 2 HOUR), "Asia/Tokyo");
