import { CHEKI_PRICE } from "./metrics.ts";

/**
 * 概要KPIをBigQuery側で集計するSQL。
 *
 * **`lib/analytics.ts` の `summarize()` と同じ定義でなければならない。**
 * クライアント集計とSQL集計で数字がずれると、同じ画面の同じ指標が
 * 経路によって別の値になる（指摘9で実際に起きた事故と同じ構図）。
 * `tests/summary-sql.test.ts` が両者の定義の対応を固定している。
 *
 * 対応関係:
 *   visits        = SUM(weight)                       … weightedVisitCount
 *   paid          = SUM(IF(type != 'trial', weight, 0)) … weightedPaidCount（予約も有料）
 *   revenue       = SUM(revenue + cheki * CHEKI_PRICE)
 *   customerCount = COUNT(DISTINCT customerId)
 *   cheki         = SUM(cheki)
 *   workHours     = SUM(実働時間)  … 打刻が無ければ予定で補完（shiftActualHours）
 *   lateMinutes   = SUM(遅刻分)    … 打刻が無ければ0（shiftLateMinutes）
 *
 * 営業日は JST から2時間引いた日付（0:00〜1:59 は前日扱い）。
 */
export function buildSummarySql(projectId: string, dataset: string, maidId?: string): string {
  const businessDate = (column: string) => `DATE(TIMESTAMP_SUB(${column}, INTERVAL 2 HOUR), "Asia/Tokyo")`;
  const visitMaidFilter = maidId ? "AND maidId = @maidId" : "";
  const shiftMaidFilter = maidId ? "AND maidId = @maidId" : "";

  return `
    WITH v AS (
      SELECT * FROM \`${projectId}.${dataset}.visits_current\`
      WHERE ${businessDate("`at`")} BETWEEN DATE(@startDate) AND DATE(@endDate) ${visitMaidFilter}
    ), s AS (
      SELECT * FROM \`${projectId}.${dataset}.shifts_current\`
      WHERE ${businessDate("scheduledStart")} BETWEEN DATE(@startDate) AND DATE(@endDate) ${shiftMaidFilter}
    )
    SELECT
      COALESCE((SELECT SUM(weight) FROM v), 0) AS visits,
      COALESCE((SELECT SUM(IF(type != 'trial', weight, 0)) FROM v), 0) AS paid,
      COALESCE((SELECT SUM(revenue + cheki * ${CHEKI_PRICE}) FROM v), 0) AS revenue,
      (SELECT COUNT(DISTINCT customerId) FROM v) AS customerCount,
      COALESCE((SELECT SUM(cheki) FROM v), 0) AS cheki,
      -- 打刻が無ければ予定時刻で補完する（core.py の fillna・shiftActualHours と同じ）
      COALESCE((SELECT SUM(TIMESTAMP_DIFF(COALESCE(actualEnd, scheduledEnd), COALESCE(actualStart, scheduledStart), SECOND)) / 3600 FROM s), 0) AS workHours,
      -- 遅刻は実打刻がある場合のみ。未打刻は0（予定で補完した時刻を遅刻扱いにしない）
      COALESCE((SELECT SUM(GREATEST(TIMESTAMP_DIFF(COALESCE(actualStart, scheduledStart), scheduledStart, SECOND), 0)) / 60 FROM s), 0) AS lateMinutes
  `;
}

/**
 * ご帰宅数の推移（バケット済み）。クライアントの `buildTrend` と同じ定義。
 * 営業日基準で、時間別だけは実時刻を使う。
 */
export function buildTrendSql(projectId: string, dataset: string, granularity: "hour" | "day" | "week" | "month", maidId?: string): string {
  const businessDate = 'DATE(TIMESTAMP_SUB(`at`, INTERVAL 2 HOUR), "Asia/Tokyo")';
  const maidFilter = maidId ? "AND maidId = @maidId" : "";
  const bucket = {
    hour: 'FORMAT_TIMESTAMP("%m/%d %H:00", `at`, "Asia/Tokyo")',
    day: `FORMAT_DATE("%m/%d", ${businessDate})`,
    week: `FORMAT_DATE("%m/%d週", DATE_TRUNC(${businessDate}, WEEK(MONDAY)))`,
    month: `FORMAT_DATE("%Y/%m", ${businessDate})`,
  }[granularity];

  return `
    SELECT
      ${bucket} AS label,
      SUM(weight) AS visits,
      SUM(revenue + cheki * ${CHEKI_PRICE}) AS revenue,
      MIN(\`at\`) AS sortAt
    FROM \`${projectId}.${dataset}.visits_current\`
    WHERE ${businessDate} BETWEEN DATE(@startDate) AND DATE(@endDate) ${maidFilter}
    GROUP BY label
    ORDER BY sortAt
  `;
}
