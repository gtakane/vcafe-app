import { BigQuery } from "@google-cloud/bigquery";
import type { MaidMonthlyReport, MaidReportsResult } from "./types";
import { mockMaidReports } from "./mock-data";

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalize(row: Record<string, unknown>): MaidMonthlyReport {
  return {
    maidId: String(row.maidId ?? ""),
    month: String(row.month ?? ""),
    nickname: String(row.nickname ?? "名称未設定"),
    attendance: num(row.attendance),
    totalWorkTimes: num(row.totalWorkTimes),
    late: num(row.late),
    latetime: num(row.latetime),
    totalReservation: num(row.totalReservation),
    totalWorkTimesReserve: num(row.totalWorkTimesReserve),
    presumeTotalWorkTimeReserve: num(row.presumeTotalWorkTimeReserve),
    lateReservation: num(row.lateReservation),
    latetimeReservation: num(row.latetimeReservation),
    totalVisits: num(row.totalVisits),
    totalOtameshi: num(row.totalOtameshi),
    totalPresents: num(row.totalPresents),
    totalPresentsPrice: num(row.totalPresentsPrice),
    totalPhoto: num(row.totalPhoto),
  };
}

export async function loadMaidReports(requestedMonth?: string, maidId?: string): Promise<MaidReportsResult> {
  if (process.env.ANALYTICS_BACKEND !== "bigquery") {
    return mockMaidReports(requestedMonth, maidId);
  }
  const projectId = process.env.BIGQUERY_PROJECT_ID;
  const dataset = process.env.BIGQUERY_DATASET;
  if (!projectId || !dataset) throw new Error("BigQueryの環境変数が設定されていません");
  const bigquery = new BigQuery({ projectId });
  const location = process.env.BIGQUERY_LOCATION || "asia-northeast1";
  const maximumBytesBilled = process.env.BIGQUERY_MAX_BYTES_BILLED || "1073741824";

  const [monthRows] = await bigquery.query({
    location,
    maximumBytesBilled,
    query: `SELECT DISTINCT month FROM \`${projectId}.${dataset}.maid_monthly_current\` ORDER BY month DESC`,
  });
  const months = monthRows.map((row) => String(row.month)).filter(Boolean);
  if (!months.length) return { months: [], month: "", reports: [] };
  const month = requestedMonth && months.includes(requestedMonth) ? requestedMonth : months[0];

  const params: Record<string, string> = { month };
  if (maidId) params.maidId = maidId;
  const [rows] = await bigquery.query({
    location,
    params,
    maximumBytesBilled,
    query: `
      SELECT p.nickname AS nickname, r.*
      FROM \`${projectId}.${dataset}.maid_monthly_current\` r
      JOIN \`${projectId}.${dataset}.maid_profiles_current\` p ON p.id = r.maidId
      WHERE r.month = @month ${maidId ? "AND r.maidId = @maidId" : ""}
      ORDER BY r.totalVisits DESC
    `,
  });
  return { months, month, reports: rows.map((row) => normalize(row as Record<string, unknown>)) };
}
