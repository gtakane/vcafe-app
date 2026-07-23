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
  at TIMESTAMP NOT NULL,
  maidId STRING NOT NULL,
  customerId STRING NOT NULL,
  type STRING NOT NULL,
  revenue INT64 NOT NULL,
  cheki INT64 NOT NULL,
  syncedAt TIMESTAMP NOT NULL,
  sourceUpdatedAt TIMESTAMP
)
PARTITION BY DATE(at, "Asia/Tokyo")
CLUSTER BY maidId, customerId;

CREATE TABLE IF NOT EXISTS `PROJECT_ID.DATASET_ID.cheki_raw` (
  id STRING NOT NULL,
  customerId STRING NOT NULL,
  maidId STRING NOT NULL,
  at TIMESTAMP NOT NULL,
  syncedAt TIMESTAMP NOT NULL,
  sourceUpdatedAt TIMESTAMP
)
PARTITION BY DATE(at, "Asia/Tokyo")
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
PARTITION BY DATE(scheduledStart, "Asia/Tokyo")
CLUSTER BY maidId;

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

CREATE OR REPLACE VIEW `PROJECT_ID.DATASET_ID.maids_current` AS
SELECT maidId AS id, ARRAY_AGG(maidName ORDER BY scheduledStart DESC LIMIT 1)[OFFSET(0)] AS name,
       SUBSTR(ARRAY_AGG(maidName ORDER BY scheduledStart DESC LIMIT 1)[OFFSET(0)], 1, 1) AS avatar,
       "active" AS status
FROM `PROJECT_ID.DATASET_ID.shifts_raw`
GROUP BY maidId;

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
  SELECT customerId, maidId, DATE(at, "Asia/Tokyo") AS business_date, COUNT(*) AS cheki_count
  FROM latest_cheki GROUP BY customerId, maidId, business_date
), numbered_visits AS (
  SELECT v.*, ROW_NUMBER() OVER (PARTITION BY customerId, maidId, DATE(at, "Asia/Tokyo") ORDER BY at) AS daily_row
  FROM latest_visits v
)
SELECT v.* EXCEPT(cheki, daily_row), IF(v.daily_row = 1, COALESCE(c.cheki_count, 0), 0) AS cheki
FROM numbered_visits v
LEFT JOIN cheki_daily c
  ON c.customerId = v.customerId AND c.maidId = v.maidId AND c.business_date = DATE(v.at, "Asia/Tokyo");
