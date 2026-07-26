import { BigQuery } from "@google-cloud/bigquery";
import { mockAnalyticsData } from "./mock-data";
import { filterData } from "./analytics";
import type { AnalyticsData, Customer, Maid, Shift, Visit } from "./types";

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
  const maidWhere = query.maidId ? "AND maidId = @maidId" : "";
  // 営業日(19:00〜翌02:00)で絞る。JSTから2時間引いた日付が営業日。
  const businessDate = (column: string) => `DATE(TIMESTAMP_SUB(${column}, INTERVAL 2 HOUR), "Asia/Tokyo")`;
  const params: Record<string, Date | string> = { startDate: query.start, endDate: query.end };
  if (query.maidId) params.maidId = query.maidId;
  const [rows] = await bigquery.query({
    location,
    params,
    maximumBytesBilled: process.env.BIGQUERY_MAX_BYTES_BILLED || "1073741824",
    query: `
      WITH selected_visits AS (
        SELECT * FROM \`${projectId}.${dataset}.visits_current\`
        WHERE ${businessDate("`at`")} BETWEEN DATE(@startDate) AND DATE(@endDate) ${maidWhere}
      ), selected_shifts AS (
        SELECT * FROM \`${projectId}.${dataset}.shifts_current\`
        WHERE ${businessDate("scheduledStart")} BETWEEN DATE(@startDate) AND DATE(@endDate) ${maidWhere}
      )
      SELECT 'maid' AS kind, TO_JSON_STRING(t) AS payload
      FROM \`${projectId}.${dataset}.maids_current\` t ${query.maidId ? "WHERE id = @maidId" : ""}
      UNION ALL
      SELECT 'customer', TO_JSON_STRING(t) FROM \`${projectId}.${dataset}.customers_current\` t
      WHERE id IN (SELECT DISTINCT customerId FROM selected_visits)
      UNION ALL SELECT 'visit', TO_JSON_STRING(t) FROM selected_visits t
      UNION ALL SELECT 'shift', TO_JSON_STRING(t) FROM selected_shifts t
    `,
  });
  const parsed = rows.map((row) => ({ kind: String(row.kind), value: JSON.parse(String(row.payload)) }));
  return {
    generatedAt: new Date().toISOString(),
    maids: parsed.filter((r) => r.kind === "maid").map((r) => r.value as Maid),
    customers: parsed.filter((r) => r.kind === "customer").map((r) => r.value as Customer),
    visits: parsed.filter((r) => r.kind === "visit").map((r) => r.value as Visit),
    shifts: parsed.filter((r) => r.kind === "shift").map((r) => r.value as Shift),
  };
}
