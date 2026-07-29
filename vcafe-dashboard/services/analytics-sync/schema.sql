-- 分析用データセットのスキーマ。PROJECT_ID / DATASET_ID を置換して適用する。
--
-- 適用順序が重要:
--   1) CREATE TABLE  … 実体
--   2) ALTER TABLE   … 後から追加した列（既存環境にも安全に足せる）
--   3) CREATE VIEW   … 上記の列に依存するため必ず最後
-- ビューを列追加より前に定義すると、未作成の列を参照して失敗する。
--
-- recordKey への切り替え（重複排除キーの変更）は再バックフィル完了後に
-- migrations/001-record-key-dedup.sql を適用する。順序は docs/migration-recordkey.md を参照。

-- ==========================================================================
-- 1) テーブル
-- ==========================================================================

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

-- 課金ログ: payments(Stripe/Webstore, amount=円) と purchaseLog(アプリ内課金, coin=コイン数) を統合。
CREATE TABLE IF NOT EXISTS `PROJECT_ID.DATASET_ID.payments_raw` (
  id STRING NOT NULL,
  customerId STRING NOT NULL,
  `at` TIMESTAMP NOT NULL,
  amount FLOAT64 NOT NULL,
  coin FLOAT64 NOT NULL,
  channel STRING NOT NULL,
  productId STRING,
  status STRING,
  syncedAt TIMESTAMP NOT NULL
)
PARTITION BY DATE(`at`)
CLUSTER BY customerId;

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

-- users/{id}/userRecordPresents = メイドへのアイテムプレゼント（アイテム使用実績）
CREATE TABLE IF NOT EXISTS `PROJECT_ID.DATASET_ID.presents_raw` (
  id STRING NOT NULL,
  customerId STRING NOT NULL,
  maidId STRING NOT NULL,
  `at` TIMESTAMP NOT NULL,
  itemName STRING,
  category STRING,
  quantity FLOAT64,
  variationName STRING,
  syncedAt TIMESTAMP NOT NULL
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


-- ============================================================================
-- 可観測性: 同期実行の記録。UIの「最終同期」はここの watermark を使う
-- （data-source.ts の generatedAt は API 応答時刻であり同期時刻ではない）。
-- ============================================================================
CREATE TABLE IF NOT EXISTS `PROJECT_ID.DATASET_ID.sync_runs` (
  runId STRING NOT NULL,
  source STRING NOT NULL,
  windowKind STRING,                 -- incremental / rescan / backfill
  windowStart TIMESTAMP,
  windowEnd TIMESTAMP,
  readCount INT64,
  acceptedCount INT64,
  rejectedCount INT64,
  insertedCount INT64,
  maxEventAt TIMESTAMP,              -- 取り込めたイベント時刻の最大値
  maxSourceUpdatedAt TIMESTAMP,      -- 取り込めた更新時刻の最大値（履歴修正の追跡用）
  limitReached BOOL,
  status STRING NOT NULL,            -- ok / degraded / failed
  errorCode STRING,
  startedAt TIMESTAMP NOT NULL,
  completedAt TIMESTAMP
)
PARTITION BY DATE(startedAt)
CLUSTER BY source, status;

-- 変換で落ちた行の記録。生データ・UID・ニックネームは保存しない。
CREATE TABLE IF NOT EXISTS `PROJECT_ID.DATASET_ID.sync_rejects` (
  runId STRING NOT NULL,
  source STRING NOT NULL,
  reasonCode STRING NOT NULL,
  fieldNames STRING,                 -- 欠損・不正だった項目名（値は含めない）
  hashedPath STRING,                 -- recordKey と同じ HMAC。生パスではない
  rejectedAt TIMESTAMP NOT NULL
)
PARTITION BY DATE(rejectedAt)
CLUSTER BY source, reasonCode;

-- データ品質チェックの結果。診断スクリプトをここへ集約していく。
CREATE TABLE IF NOT EXISTS `PROJECT_ID.DATASET_ID.dq_results` (
  runId STRING,
  checkName STRING NOT NULL,
  status STRING NOT NULL,            -- pass / warn / fail
  observedValue FLOAT64,
  threshold FLOAT64,
  details STRING,
  checkedAt TIMESTAMP NOT NULL
)
PARTITION BY DATE(checkedAt)
CLUSTER BY checkName, status;

-- ==========================================================================
-- 2) 追加列
-- ==========================================================================

-- users ドキュメント由来の付加情報（既存テーブルにも後から追加できるよう ADD COLUMN IF NOT EXISTS）。
ALTER TABLE `PROJECT_ID.DATASET_ID.customers_raw`
  ADD COLUMN IF NOT EXISTS gender STRING,
  ADD COLUMN IF NOT EXISTS birthYear INT64,
  ADD COLUMN IF NOT EXISTS active BOOL,
  ADD COLUMN IF NOT EXISTS lastVisitAt TIMESTAMP,
  ADD COLUMN IF NOT EXISTS lastPaymentAt TIMESTAMP,
  ADD COLUMN IF NOT EXISTS lastPurchasedItemAt TIMESTAMP,
  ADD COLUMN IF NOT EXISTS lastPresentAt TIMESTAMP,
  ADD COLUMN IF NOT EXISTS purchasedItemCoin FLOAT64,
  ADD COLUMN IF NOT EXISTS purchasedItemRewardPoint FLOAT64,
  ADD COLUMN IF NOT EXISTS purchasedItemQuantity FLOAT64,
  ADD COLUMN IF NOT EXISTS presentAmount FLOAT64,
  ADD COLUMN IF NOT EXISTS coin FLOAT64,
  ADD COLUMN IF NOT EXISTS rewardPoint FLOAT64,
  ADD COLUMN IF NOT EXISTS totalVisitAmount FLOAT64,
  ADD COLUMN IF NOT EXISTS consecutiveVisitDays FLOAT64,
  ADD COLUMN IF NOT EXISTS maxConsecutiveVisitDays FLOAT64;

-- 取り込み元コレクション（userPayments / payments / purchaseLog）。
-- userPayments が全時代の台帳（WEB版もアプリ版も実払い円額を持つ）で、
-- payments/purchaseLog は同じ課金の別記録のため、両方を集計すると二重計上になる。
ALTER TABLE `PROJECT_ID.DATASET_ID.payments_raw`
  ADD COLUMN IF NOT EXISTS source STRING;

-- メイド個別ログ用の明細列（既存テーブルにも後から追加できるよう ADD COLUMN IF NOT EXISTS）。
ALTER TABLE `PROJECT_ID.DATASET_ID.visits_raw`
  ADD COLUMN IF NOT EXISTS ticketId STRING,
  ADD COLUMN IF NOT EXISTS minutes FLOAT64,
  ADD COLUMN IF NOT EXISTS billedCoin FLOAT64,
  ADD COLUMN IF NOT EXISTS billedRewardPoint FLOAT64;

-- ============================================================================
-- recordKey: 分析側の重複排除キー（Firestoreフルパスの HMAC）。
-- collection group の document.id はグローバル一意ではないため、id を PARTITION キーに
-- していると別ユーザー配下の同名ドキュメントが衝突し片方が消える。
-- runId: 同一 syncedAt の行が複数実行にまたがったときの順序決定に使う。
-- 既存テーブルにも後から追加できるよう ADD COLUMN IF NOT EXISTS で定義する。
-- ============================================================================
ALTER TABLE `PROJECT_ID.DATASET_ID.visits_raw`
  ADD COLUMN IF NOT EXISTS recordKey STRING,
  ADD COLUMN IF NOT EXISTS runId STRING;

ALTER TABLE `PROJECT_ID.DATASET_ID.cheki_raw`
  ADD COLUMN IF NOT EXISTS recordKey STRING,
  ADD COLUMN IF NOT EXISTS runId STRING;

ALTER TABLE `PROJECT_ID.DATASET_ID.shifts_raw`
  ADD COLUMN IF NOT EXISTS recordKey STRING,
  ADD COLUMN IF NOT EXISTS runId STRING;

ALTER TABLE `PROJECT_ID.DATASET_ID.presents_raw`
  ADD COLUMN IF NOT EXISTS recordKey STRING,
  ADD COLUMN IF NOT EXISTS runId STRING,
  ADD COLUMN IF NOT EXISTS sourceUpdatedAt TIMESTAMP;

ALTER TABLE `PROJECT_ID.DATASET_ID.payments_raw`
  ADD COLUMN IF NOT EXISTS recordKey STRING,
  ADD COLUMN IF NOT EXISTS runId STRING,
  ADD COLUMN IF NOT EXISTS sourceUpdatedAt TIMESTAMP;

ALTER TABLE `PROJECT_ID.DATASET_ID.customers_raw`
  ADD COLUMN IF NOT EXISTS recordKey STRING,
  ADD COLUMN IF NOT EXISTS runId STRING;

ALTER TABLE `PROJECT_ID.DATASET_ID.maid_profiles_raw`
  ADD COLUMN IF NOT EXISTS runId STRING;

ALTER TABLE `PROJECT_ID.DATASET_ID.maid_monthly_raw`
  ADD COLUMN IF NOT EXISTS runId STRING;

-- ==========================================================================
-- 3) ビュー
-- ==========================================================================

-- 課金の「正」は userPayments（全時代の台帳）。
--
-- 旧実装は `(SELECT COUNT(*) FROM ledger) = 0` で切り替えていたため、台帳が1件でも入ると
-- 旧ソース(payments/purchaseLog)が**全期間**から除外された。部分バックフィル中や
-- インデックス障害で特定月だけ台帳が欠けていても、旧データが丸ごと消えてしまう。
--
-- そこで「月ごとのカバレッジ」で判定する。台帳がその月をカバーしていれば台帳を使い、
-- カバーしていない月だけ旧ソースで補完する。移行が途中でも欠損しない。
CREATE OR REPLACE VIEW `PROJECT_ID.DATASET_ID.payments_current` AS
WITH latest AS (
  SELECT * EXCEPT(row_number, syncedAt)
  FROM (
    SELECT *, ROW_NUMBER() OVER (
      PARTITION BY id
      ORDER BY COALESCE(sourceUpdatedAt, syncedAt) DESC, syncedAt DESC, runId DESC
    ) AS row_number
    FROM `PROJECT_ID.DATASET_ID.payments_raw`
  )
  WHERE row_number = 1
), succeeded AS (
  -- 失敗・キャンセルした決済は売上に含めない。
  SELECT * FROM latest
  WHERE status IS NULL
     OR (
          LOWER(status) NOT LIKE '%fail%'
      AND LOWER(status) NOT LIKE '%cancel%'
      AND LOWER(status) NOT LIKE '%refund%'
     )
), ledger_months AS (
  -- 台帳が実データを持っている月。
  SELECT DISTINCT FORMAT_DATE('%Y%m', DATE(`at`, 'Asia/Tokyo')) AS ym
  FROM succeeded WHERE source = 'userPayments'
)
SELECT * FROM succeeded WHERE source = 'userPayments'
UNION ALL
SELECT * FROM succeeded
WHERE COALESCE(source, 'legacy') != 'userPayments'
  AND FORMAT_DATE('%Y%m', DATE(`at`, 'Asia/Tokyo')) NOT IN (SELECT ym FROM ledger_months);

-- payments_current を期間で絞ってから重複排除する版（ダッシュボードの期間指定クエリ用）。
-- payments_current は PARTITION BY id を計算するために payments_raw の全期間をスキャンする
-- 必要があり、DATE(at)でパーティション分割されたテーブルなのに期間を絞っても
-- スキャン量が一切減らなかった（2026-07-29に実測: 期間問わず同じバイト数）。
-- ここでは重複排除の前に payments_raw を日付で絞り込むことで、
-- 該当期間のパーティションだけを読めばよいようにする。
-- at（決済日時）は一度書き込まれたら再編集されない前提（同一idの複数版が
-- 別パーティションに分かれることはない）。この前提が崩れる操作を行う場合は要再検討。
CREATE OR REPLACE TABLE FUNCTION `PROJECT_ID.DATASET_ID.payments_current_range`(start_date DATE, end_date DATE) AS
(
  WITH payments_window AS (
    SELECT * FROM `PROJECT_ID.DATASET_ID.payments_raw`
    WHERE DATE(`at`) BETWEEN DATE_SUB(start_date, INTERVAL 1 DAY) AND DATE_ADD(end_date, INTERVAL 1 DAY)
  ), latest AS (
    SELECT * EXCEPT(row_number, syncedAt)
    FROM (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY id
        ORDER BY COALESCE(sourceUpdatedAt, syncedAt) DESC, syncedAt DESC, runId DESC
      ) AS row_number
      FROM payments_window
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
    AND FORMAT_DATE('%Y%m', DATE(`at`, 'Asia/Tokyo')) NOT IN (SELECT ym FROM ledger_months)
);

CREATE OR REPLACE VIEW `PROJECT_ID.DATASET_ID.presents_current` AS
SELECT * EXCEPT(row_number, syncedAt)
FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY syncedAt DESC) AS row_number
  FROM `PROJECT_ID.DATASET_ID.presents_raw`
)
WHERE row_number = 1;

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

-- shifts_current を期間で絞ってから重複排除する版（理由は payments_current_range と同じ）。
CREATE OR REPLACE TABLE FUNCTION `PROJECT_ID.DATASET_ID.shifts_current_range`(start_date DATE, end_date DATE, maid_id STRING) AS
(
  WITH shifts_window AS (
    SELECT * FROM `PROJECT_ID.DATASET_ID.shifts_raw`
    WHERE DATE(scheduledStart) BETWEEN DATE_SUB(start_date, INTERVAL 1 DAY) AND DATE_ADD(end_date, INTERVAL 1 DAY)
      AND (maid_id IS NULL OR maidId = maid_id)
  ), latest AS (
    SELECT * EXCEPT(row_number, maidName, syncedAt, sourceUpdatedAt)
    FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY COALESCE(sourceUpdatedAt, syncedAt) DESC, syncedAt DESC) AS row_number
      FROM shifts_window
    )
    WHERE row_number = 1
  )
  SELECT * FROM latest
  WHERE DATE(TIMESTAMP_SUB(scheduledStart, INTERVAL 2 HOUR), "Asia/Tokyo") BETWEEN start_date AND end_date
);

-- メイド一覧は名簿(maid_profiles)を正とする。
-- 名簿に無い maidId がシフト/ご帰宅に現れた場合も一覧へ補完するが、
-- 同期側(transform.ts)がニックネームを解決できない行を reject するようになったため、
-- ここに `nickname:*` の疑似IDが入ることはない。補完対象は
-- 「名簿から削除されたが過去実績が残っているメイド」に限られ、status で区別できるようにする。
CREATE OR REPLACE VIEW `PROJECT_ID.DATASET_ID.maids_current` AS
WITH from_profiles AS (
  SELECT id, nickname AS name, IF(active, "active", "inactive") AS status
  FROM `PROJECT_ID.DATASET_ID.maid_profiles_current`
), from_shifts AS (
  SELECT maidId AS id, ARRAY_AGG(maidName ORDER BY scheduledStart DESC LIMIT 1)[OFFSET(0)] AS name, "unlisted" AS status
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

-- visits_current を期間で絞ってから重複排除する版（理由は payments_current_range と同じ）。
-- ダッシュボードは常にこの期間指定クエリしか投げないため、visits_raw/cheki_raw の
-- 全期間ではなく該当パーティションだけ読めばよい。
CREATE OR REPLACE TABLE FUNCTION `PROJECT_ID.DATASET_ID.visits_current_range`(start_date DATE, end_date DATE, maid_id STRING) AS
(
  WITH visits_window AS (
    SELECT * FROM `PROJECT_ID.DATASET_ID.visits_raw`
    WHERE DATE(`at`) BETWEEN DATE_SUB(start_date, INTERVAL 1 DAY) AND DATE_ADD(end_date, INTERVAL 1 DAY)
      AND (maid_id IS NULL OR maidId = maid_id)
  ), latest_visits AS (
    SELECT * EXCEPT(row_number, syncedAt, sourceUpdatedAt)
    FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY COALESCE(sourceUpdatedAt, syncedAt) DESC, syncedAt DESC) AS row_number
      FROM visits_window
    )
    WHERE row_number = 1
  ), cheki_window AS (
    SELECT * FROM `PROJECT_ID.DATASET_ID.cheki_raw`
    WHERE DATE(`at`) BETWEEN DATE_SUB(start_date, INTERVAL 1 DAY) AND DATE_ADD(end_date, INTERVAL 1 DAY)
  ), latest_cheki AS (
    SELECT * EXCEPT(row_number, syncedAt, sourceUpdatedAt)
    FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY COALESCE(sourceUpdatedAt, syncedAt) DESC, syncedAt DESC) AS row_number
      FROM cheki_window
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
    ON c.customerId = v.customerId AND c.maidId = v.maidId AND c.business_date = DATE(TIMESTAMP_SUB(v.`at`, INTERVAL 2 HOUR), "Asia/Tokyo")
  WHERE DATE(TIMESTAMP_SUB(v.`at`, INTERVAL 2 HOUR), "Asia/Tokyo") BETWEEN start_date AND end_date
);

-- 同期の鮮度。UIの「最終同期」表示に使う。
CREATE OR REPLACE VIEW `PROJECT_ID.DATASET_ID.sync_watermark` AS
SELECT
  MAX(completedAt) AS lastSyncedAt,
  MAX(maxEventAt) AS lastEventAt,
  MAX(maxSourceUpdatedAt) AS lastSourceUpdatedAt,
  -- 直近の実行が失敗/劣化していれば画面にも出せるようにする。
  ARRAY_AGG(status ORDER BY startedAt DESC LIMIT 1)[OFFSET(0)] AS lastStatus,
  TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(completedAt), MINUTE) AS freshnessLagMinutes
FROM `PROJECT_ID.DATASET_ID.sync_runs`
WHERE status != 'failed';
