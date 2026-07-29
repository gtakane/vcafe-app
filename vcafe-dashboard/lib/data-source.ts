import { BigQuery } from "@google-cloud/bigquery";
import { mockAnalyticsData } from "./mock-data";
import { filterData } from "./analytics";
import type { AnalyticsData, Customer, Maid, Shift, SyncFreshness, Visit } from "./types";

export interface DataQuery {
  start: string;
  end: string;
  maidId?: string;
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
  const params: Record<string, Date | string | null> = { startDate: query.start, endDate: query.end, maidId: query.maidId ?? null };
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
      WITH selected_visits AS (
        SELECT * FROM \`${projectId}.${dataset}.visits_current_range\`(DATE(@startDate), DATE(@endDate), @maidId)
      ), selected_shifts AS (
        SELECT * FROM \`${projectId}.${dataset}.shifts_current_range\`(DATE(@startDate), DATE(@endDate), @maidId)
      ), customer_payments AS (
        -- 期間内の課金（Webstore円 + アプリ内課金コイン）をユーザー単位に集計する。
        SELECT customerId, COUNT(*) AS paymentCount, SUM(amount) AS paymentAmount
        FROM \`${projectId}.${dataset}.payments_current_range\`(DATE(@startDate), DATE(@endDate))
        WHERE DATE(\`at\`, "Asia/Tokyo") BETWEEN DATE(@startDate) AND DATE(@endDate)
        GROUP BY customerId
      ), selected_customers AS (
        SELECT c.*, COALESCE(p.paymentCount, 0) AS paymentCount, COALESCE(p.paymentAmount, 0) AS paymentAmount
        FROM \`${projectId}.${dataset}.customers_current\` c
        LEFT JOIN customer_payments p ON p.customerId = c.id
        WHERE c.id IN (SELECT DISTINCT customerId FROM selected_visits)
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
    visits: parsed.filter((r) => r.kind === "visit").map((r) => r.value as Visit),
    shifts: parsed.filter((r) => r.kind === "shift").map((r) => r.value as Shift),
  };
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
  };
}
