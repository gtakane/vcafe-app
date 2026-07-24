-- Replace PROJECT_ID and DATASET_ID before applying this file to the analytics project.
CREATE TABLE IF NOT EXISTS `PROJECT_ID.DATASET_ID.customers_raw` (
  id STRING NOT NULL,
  name STRING NOT NULL,
  rank STRING NOT NULL,
  registeredAt TIMESTAMP,
  syncedAt TIMESTAMP NOT NULL,
  sourceUpdatedAt TIMESTAMP
)
PARTITION BY DATE(syncedAt)
CLUSTER BY id;

CREATE TABLE IF NOT EXISTS `PROJECT_ID.DATASET_ID.visits_raw` (
  id STRING NOT NULL,
  `at` TIMESTAMP NOT NULL,
  maidId STRING NOT NULL,
  customerId STRING NOT NULL,
  type STRING NOT NULL,
  revenue INT64 NOT NULL,
  cheki INT64 NOT NULL,
  -- 滞在時間による重み（core.py: max(1, round(initialTime/20))）。ご帰宅数の重み付き集計に使用。
  weight INT64 NOT NULL,
  syncedAt TIMESTAMP NOT NULL,
  sourceUpdatedAt TIMESTAMP
)
PARTITION BY DATE(`at`)
CLUSTER BY maidId, customerId;

CREATE TABLE IF NOT EXISTS `PROJECT_ID.DATASET_ID.cheki_raw` (
  id STRING NOT NULL,
  customerId STRING NOT NULL,
  maidId STRING NOT NULL,
  `at` TIMESTAMP NOT NULL,
  syncedAt TIMESTAMP NOT NULL,
  sourceUpdatedAt TIMESTAMP
)
PARTITION BY DATE(`at`)
CLUSTER BY maidId, customerId;

CREATE TABLE IF NOT EXISTS `PROJECT_ID.DATASET_ID.shifts_raw` (
  id STRING NOT NULL,
  maidId STRING NOT NULL,
  maidName STRING NOT NULL,
  scheduledStart TIMESTAMP NOT NULL,
  scheduledEnd TIMESTAMP NOT NULL,
  actualStart TIMESTAMP,
  actualEnd TIMESTAMP,
  syncedAt TIMESTAMP NOT NULL,
  sourceUpdatedAt TIMESTAMP
)
PARTITION BY DATE(scheduledStart)
CLUSTER BY maidId;

-- maidWorkReport/{maidId} = メイド名簿
CREATE TABLE IF NOT EXISTS `PROJECT_ID.DATASET_ID.maid_profiles_raw` (
  id STRING NOT NULL,
  nickname STRING NOT NULL,
  active BOOL,
  hourlyPay FLOAT64,
  registrationDate TIMESTAMP,
  syncedAt TIMESTAMP NOT NULL
)
CLUSTER BY id;

-- maidWorkReport/{maidId}/monthlyReport/{YYYYMM} = 月次実績（本番フィールド名のまま）
CREATE TABLE IF NOT EXISTS `PROJECT_ID.DATASET_ID.maid_monthly_raw` (
  maidId STRING NOT NULL,
  month STRING NOT NULL,
  attendance FLOAT64,
  attendanceReserve FLOAT64,
  days FLOAT64,
  late FLOAT64,
  latetime FLOAT64,
  lateReservation FLOAT64,
  latetimeReservation FLOAT64,
  totalReservation FLOAT64,
  totalWorkTimes FLOAT64,
  totalWorkTimesReserve FLOAT64,
  presumeTotalWorkTimeReserve FLOAT64,
  totalVisits FLOAT64,
  totalOtameshi FLOAT64,
  totalPresents FLOAT64,
  totalPresentsPrice FLOAT64,
  totalPhoto FLOAT64,
  totalBirthdayPhotos FLOAT64,
  syncedAt TIMESTAMP NOT NULL
)
CLUSTER BY maidId, month;

CREATE OR REPLACE VIEW `PROJECT_ID.DATASET_ID.maid_profiles_current` AS
SELECT * EXCEPT(row_number, syncedAt)
FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY syncedAt DESC) AS row_number
  FROM `PROJECT_ID.DATASET_ID.maid_profiles_raw`
)
WHERE row_number = 1;

CREATE OR REPLACE VIEW `PROJECT_ID.DATASET_ID.maid_monthly_current` AS
SELECT * EXCEPT(row_number, syncedAt)
FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY maidId, month ORDER BY syncedAt DESC) AS row_number
  FROM `PROJECT_ID.DATASET_ID.maid_monthly_raw`
)
WHERE row_number = 1;

CREATE OR REPLACE VIEW `PROJECT_ID.DATASET_ID.customers_current` AS
SELECT * EXCEPT(row_number, syncedAt, sourceUpdatedAt)
FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY COALESCE(sourceUpdatedAt, syncedAt) DESC, syncedAt DESC) AS row_number
  FROM `PROJECT_ID.DATASET_ID.customers_raw`
)
WHERE row_number = 1;

CREATE OR REPLACE VIEW `PROJECT_ID.DATASET_ID.shifts_current` AS
SELECT * EXCEPT(row_number, maidName, syncedAt, sourceUpdatedAt)
FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY COALESCE(sourceUpdatedAt, syncedAt) DESC, syncedAt DESC) AS row_number
  FROM `PROJECT_ID.DATASET_ID.shifts_raw`
)
WHERE row_number = 1;

-- メイド一覧は名簿(maid_profiles)を正とし、名簿に無いがシフト/ご帰宅に現れるmaidIdも補完する。
CREATE OR REPLACE VIEW `PROJECT_ID.DATASET_ID.maids_current` AS
WITH from_profiles AS (
  SELECT id, nickname AS name, IF(active, "active", "inactive") AS status
  FROM `PROJECT_ID.DATASET_ID.maid_profiles_current`
), from_shifts AS (
  SELECT maidId AS id, ARRAY_AGG(maidName ORDER BY scheduledStart DESC LIMIT 1)[OFFSET(0)] AS name, "active" AS status
  FROM `PROJECT_ID.DATASET_ID.shifts_raw`
  WHERE maidId NOT IN (SELECT id FROM from_profiles)
  GROUP BY maidId
)
SELECT id, name, SUBSTR(name, 1, 1) AS avatar, status FROM from_profiles
UNION ALL
SELECT id, name, SUBSTR(name, 1, 1) AS avatar, status FROM from_shifts;

CREATE OR REPLACE VIEW `PROJECT_ID.DATASET_ID.visits_current` AS
WITH latest_visits AS (
  SELECT * EXCEPT(row_number, syncedAt, sourceUpdatedAt)
  FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY COALESCE(sourceUpdatedAt, syncedAt) DESC, syncedAt DESC) AS row_number
    FROM `PROJECT_ID.DATASET_ID.visits_raw`
  )
  WHERE row_number = 1
), latest_cheki AS (
  SELECT * EXCEPT(row_number, syncedAt, sourceUpdatedAt)
  FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY COALESCE(sourceUpdatedAt, syncedAt) DESC, syncedAt DESC) AS row_number
    FROM `PROJECT_ID.DATASET_ID.cheki_raw`
  )
  WHERE row_number = 1
), cheki_daily AS (
  -- 営業日（0:00〜1:59を前日扱い）でチェキ枚数を日次集計（core.py _biz_date と一致）。
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
