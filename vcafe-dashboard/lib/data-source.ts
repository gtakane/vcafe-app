import { BigQuery } from "@google-cloud/bigquery";
import { mockAnalyticsData } from "./mock-data";
import { filterData } from "./analytics";
import { FREE_CHEKI_TYPES, visitRevenue } from "./metrics";
import type { AnalyticsData, Booking, Customer, Maid, Shift, SyncFreshness, Visit } from "./types";
import { testUserCondition } from "./test-users.ts";

/**
 * 売上を経理の計上ロジックの単価で計算し直す（lib/metrics.ts visitRevenue）。
 * 保存済みの revenue は同期した時点の定義で計算されているため、表示時に明細項目から出し直して
 * 過去分も同じ定義にそろえる。明細項目を持たない古い行（ticketId 未取得）は保存値のまま使う。
 */
export function normalizeVisit(visit: Visit): Visit {
  if (visit.ticketId == null) return visit;
  return {
    ...visit,
    revenue: visitRevenue(visit.type, visit.ticketId, Number(visit.billedCoin) || 0, Number(visit.billedRewardPoint) || 0, visit.usedTicketCount, visit.billedCoinVendor),
  };
}

const FREE_CHEKI_SQL = [...FREE_CHEKI_TYPES].map((type) => `'${type}'`).join(", ");

export interface DataQuery {
  start: string;
  end: string;
  maidId?: string;
  /** テストユーザーを含めるか（既定は含めない）。lib/test-users.ts */
  includeTestUsers?: boolean;
}

export async function loadAnalyticsData(query: DataQuery): Promise<AnalyticsData> {
  if (process.env.ANALYTICS_BACKEND !== "bigquery") {
    return filterData(mockAnalyticsData, { uid: "server", name: "server", role: "admin" }, { ...query, granularity: "day" });
  }
  const projectId = process.env.BIGQUERY_PROJECT_ID;
  const dataset = process.env.BIGQUERY_DATASET;
  if (!projectId || !dataset) throw new Error("BigQueryの環境変数が設定されていません");
  const bigquery = new BigQuery({ projectId });
  const location = process.env.BIGQUERY_LOCATION || "asia-northeast1";
  const params: Record<string, Date | string | boolean | null> = { startDate: query.start, endDate: query.end, maidId: query.maidId ?? null, includeTestUsers: Boolean(query.includeTestUsers) };
  const [rows] = await bigquery.query({
    location,
    params,
    types: { maidId: "STRING" },
    maximumBytesBilled: process.env.BIGQUERY_MAX_BYTES_BILLED || "1073741824",
    // visits_current / shifts_current / payments_current は id での重複排除に
    // PARTITION BY id を使うため、生テーブル（DATE(at) 等でパーティション分割済み）を
    // 全期間スキャンしないと計算できず、期間を絞っても読み取りバイト数が全く減らなかった
    // （2026-07-29に実測: 直近1日でも全期間でも同じ約306MB）。
    // *_current_range（TABLE FUNCTION）は生テーブルを先に期間で絞ってから重複排除するため、
    // 該当パーティションだけを読む。ロジック自体は schema.sql の *_current と同じで、
    // 二重管理を避けるため直接コピーはせず、この関数だけがダッシュボードから使われる。
    query: `
      WITH free_cheki AS (
        -- 誕生日プレゼント等の無料チェキ。ご帰宅の cheki（営業日・ユーザー・メイド単位で1件目に集約）と同じ単位で数える。
        SELECT customerId, maidId, DATE(TIMESTAMP_SUB(\`at\`, INTERVAL 2 HOUR), "Asia/Tokyo") AS business_date, COUNT(DISTINCT id) AS n
        FROM \`${projectId}.${dataset}.cheki_raw\`
        WHERE DATE(\`at\`) BETWEEN DATE_SUB(DATE(@startDate), INTERVAL 1 DAY) AND DATE_ADD(DATE(@endDate), INTERVAL 1 DAY)
          AND chekiType IN (${FREE_CHEKI_SQL})
          AND ${testUserCondition()}
        GROUP BY customerId, maidId, business_date
      ), selected_visits AS (
        SELECT v.*, IF(v.cheki > 0, LEAST(v.cheki, COALESCE(f.n, 0)), 0) AS freeCheki
        FROM \`${projectId}.${dataset}.visits_current_range\`(DATE(@startDate), DATE(@endDate), @maidId) v
        LEFT JOIN free_cheki f
          ON f.customerId = v.customerId AND f.maidId = v.maidId
         AND f.business_date = DATE(TIMESTAMP_SUB(v.\`at\`, INTERVAL 2 HOUR), "Asia/Tokyo")
        WHERE ${testUserCondition("v")}
      ), selected_shifts AS (
        SELECT * FROM \`${projectId}.${dataset}.shifts_current_range\`(DATE(@startDate), DATE(@endDate), @maidId)
      ), customer_payments AS (
        -- 期間内の課金（Webstore円 + アプリ内課金コイン）をユーザー単位に集計する。
        SELECT customerId, COUNT(*) AS paymentCount, SUM(amount) AS paymentAmount
        FROM \`${projectId}.${dataset}.payments_current_range\`(DATE(@startDate), DATE(@endDate))
        WHERE DATE(\`at\`, "Asia/Tokyo") BETWEEN DATE(@startDate) AND DATE(@endDate)
          AND ${testUserCondition()}
        GROUP BY customerId
      ), selected_customers AS (
        SELECT c.*, COALESCE(p.paymentCount, 0) AS paymentCount, COALESCE(p.paymentAmount, 0) AS paymentAmount
        FROM \`${projectId}.${dataset}.customers_current\` c
        LEFT JOIN customer_payments p ON p.customerId = c.id
        WHERE c.id IN (SELECT DISTINCT customerId FROM selected_visits) AND ${testUserCondition("c")}
      )
      SELECT 'maid' AS kind, TO_JSON_STRING(t) AS payload
      FROM \`${projectId}.${dataset}.maids_current\` t ${query.maidId ? "WHERE id = @maidId" : ""}
      UNION ALL
      SELECT 'customer', TO_JSON_STRING(t) FROM selected_customers t
      UNION ALL SELECT 'visit', TO_JSON_STRING(t) FROM selected_visits t
      UNION ALL SELECT 'shift', TO_JSON_STRING(t) FROM selected_shifts t
    `,
  });
  const parsed = rows.map((row) => ({ kind: String(row.kind), value: JSON.parse(String(row.payload)) }));
  return {
    // これは API 応答時刻であって同期時刻ではない。UIの「最終同期」には
    // loadSyncFreshness()（sync_watermark ビュー）を使うこと。
    generatedAt: new Date().toISOString(),
    maids: parsed.filter((r) => r.kind === "maid").map((r) => r.value as Maid),
    customers: parsed.filter((r) => r.kind === "customer").map((r) => r.value as Customer),
    visits: parsed.filter((r) => r.kind === "visit").map((r) => normalizeVisit(r.value as Visit)),
    shifts: parsed.filter((r) => r.kind === "shift").map((r) => r.value as Shift),
    bookings: await loadBookings(bigquery, location, projectId, dataset, query),
  };
}

/**
 * 予約・招待。売上は予約・招待を受けた日（営業日）に計上する。
 * bookings_raw は2026-11追加のため、未作成の環境では空として扱い画面全体を止めない。
 */
async function loadBookings(bigquery: BigQuery, location: string, projectId: string, dataset: string, query: DataQuery): Promise<Booking[]> {
  try {
    const [rows] = await bigquery.query({
      location,
      params: { startDate: query.start, endDate: query.end, maidId: query.maidId ?? null, includeTestUsers: Boolean(query.includeTestUsers) },
      types: { maidId: "STRING" },
      maximumBytesBilled: process.env.BIGQUERY_MAX_BYTES_BILLED || "1073741824",
      query: `
        SELECT TO_JSON_STRING(STRUCT(id, kind, \`at\`, slotAt, maidId, customerId, coin, coinVendor, rewardPoint, canceled, revenue)) AS payload
        FROM \`${projectId}.${dataset}.bookings_current\`
        WHERE DATE(TIMESTAMP_SUB(\`at\`, INTERVAL 2 HOUR), "Asia/Tokyo") BETWEEN DATE(@startDate) AND DATE(@endDate)
          AND (@maidId IS NULL OR maidId = @maidId)
          AND ${testUserCondition()}
      `,
    });
    return rows.map((row) => {
      const value = JSON.parse(String(row.payload)) as Booking;
      return { ...value, coin: Number(value.coin) || 0, rewardPoint: Number(value.rewardPoint) || 0, revenue: Number(value.revenue) || 0, canceled: Boolean(value.canceled) };
    });
  } catch (error) {
    console.warn(`BOOKINGS_UNAVAILABLE ${(error as Error).message}`);
    return [];
  }
}


/**
 * 同期の鮮度を sync_runs から取得する。
 * 旧実装は data-source の generatedAt（API応答時刻）を「最終同期」として表示していたため、
 * 同期が止まっていても常に「今」が表示され、停止に気づけなかった。
 */
export async function loadSyncFreshness(): Promise<SyncFreshness | null> {
  if (process.env.ANALYTICS_BACKEND !== "bigquery") return null;
  const projectId = process.env.BIGQUERY_PROJECT_ID;
  const dataset = process.env.BIGQUERY_DATASET;
  if (!projectId || !dataset) return null;
  const { BigQuery } = await import("@google-cloud/bigquery");
  const bigquery = new BigQuery({ projectId });
  const [rows] = await bigquery.query({
    location: process.env.BIGQUERY_LOCATION || "asia-northeast1",
    maximumBytesBilled: process.env.BIGQUERY_MAX_BYTES_BILLED || "1073741824",
    query: `SELECT * FROM \`${projectId}.${dataset}.sync_watermark\``,
  });
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const iso = (value: unknown) =>
    value && typeof value === "object" && "value" in (value as Record<string, unknown>)
      ? String((value as { value: unknown }).value)
      : value ? String(value) : null;
  return {
    lastSyncedAt: iso(row.lastSyncedAt),
    lastEventAt: iso(row.lastEventAt),
    lastStatus: row.lastStatus ? String(row.lastStatus) : null,
    freshnessLagMinutes: row.freshnessLagMinutes == null ? null : Number(row.freshnessLagMinutes),
    gaps: await loadCompletenessGaps(bigquery, projectId, dataset),
  };
}

/** 直近の取りこぼし判定で、取り込み直しても本番より少ないままの営業日。判定が未実施なら空。 */
async function loadCompletenessGaps(bigquery: InstanceType<typeof BigQuery>, projectId: string, dataset: string) {
  try {
    const [rows] = await bigquery.query({
      location: process.env.BIGQUERY_LOCATION || "asia-northeast1",
      maximumBytesBilled: process.env.BIGQUERY_MAX_BYTES_BILLED || "1073741824",
      query: `
        WITH latest AS (
          SELECT * FROM \`${projectId}.${dataset}.dq_results\`
          WHERE STARTS_WITH(checkName, "visits_daily_completeness:") AND checkedAt > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 2 DAY)
          QUALIFY ROW_NUMBER() OVER (PARTITION BY checkName ORDER BY checkedAt DESC) = 1
        )
        SELECT details FROM latest WHERE status != "pass" ORDER BY checkName`,
    });
    return (rows as Array<{ details: string }>).map((r) => {
      const d = JSON.parse(String(r.details)) as { day: string; production: number; dashboard: number };
      return { day: d.day, production: Number(d.production) || 0, dashboard: Number(d.dashboard) || 0 };
    });
  } catch {
    return [];
  }
}
