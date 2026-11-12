// 月次指標の読み込み（BigQuery・公式サイト）。組み立ては lib/monthly-kpi.ts の純関数で行う。

import { buildMonthlyKpi, monthRange, type AutoMonth, type HistoryRow, type KpiRow, type MaidMove, type MonthSales, KPI_COLUMNS } from "./monthly-kpi.ts";
import { VISIT_COUNT_SQL } from "./summary-sql.ts";
import { testUserCondition } from "./test-users.ts";
import { loadBalances } from "./balances.ts";
import { loadOfficialNews } from "./official-news.ts";

/**
 * データから出す最初の月（サービス開始）。CSVの空欄を埋め、CSVの値と見比べるため全期間を出す。
 * 全期間を読むため、結果は10分間使い回す（refresh で読み直し）。
 */
export const AUTO_FROM = "2020-11";
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: MonthlyKpiResult }>();
/** 月の確定売上を出せる最初の月（経理の11/1の残高を基準値にしている）。 */
const FIRST_SALES_MONTH = "2026-11";

export interface MonthlyKpiResult {
  rows: KpiRow[];
  historyCutoff: string | null;
  autoFrom: string;
  includeTestUsers: boolean;
  warnings: string[];
}

const businessMonth = (column: string) => `FORMAT_DATE("%Y-%m", DATE(TIMESTAMP_SUB(${column}, INTERVAL 2 HOUR), "Asia/Tokyo"))`;

export async function loadMonthlyKpi(options: { includeTestUsers: boolean; refresh?: boolean; now?: Date }): Promise<MonthlyKpiResult & { cachedAt: string }> {
  const cacheKey = options.includeTestUsers ? "include" : "exclude";
  const cached = cache.get(cacheKey);
  if (!options.refresh && !options.now && cached && Date.now() - cached.at < CACHE_MS) return { ...cached.value, cachedAt: new Date(cached.at).toISOString() };
  const value = await loadMonthlyKpiUncached(options);
  const at = Date.now();
  cache.set(cacheKey, { at, value });
  return { ...value, cachedAt: new Date(at).toISOString() };
}

async function loadMonthlyKpiUncached(options: { includeTestUsers: boolean; now?: Date }): Promise<MonthlyKpiResult> {
  const projectId = process.env.BIGQUERY_PROJECT_ID;
  const dataset = process.env.BIGQUERY_DATASET;
  if (!projectId || !dataset) throw new Error("BigQueryの環境変数が設定されていません");
  const { BigQuery } = await import("@google-cloud/bigquery");
  const bigquery = new BigQuery({ projectId });
  const location = process.env.BIGQUERY_LOCATION || "asia-northeast1";
  const maximumBytesBilled = process.env.BIGQUERY_MAX_BYTES_BILLED || "1073741824";
  const now = options.now ?? new Date();
  const currentMonth = new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 7); // 営業日（JST-2h）の月
  const autoFrom = AUTO_FROM;
  const autoMonths = monthRange(autoFrom, currentMonth);
  const params = { from: `${autoFrom}-01`, to: `${currentMonth}-28`, months: autoMonths, includeTestUsers: options.includeTestUsers };
  const t = (name: string) => `\`${projectId}.${dataset}.${name}\``;
  const run = async (query: string) => (await bigquery.query({ location, params, maximumBytesBilled, query }))[0] as Array<Record<string, unknown>>;
  const warnings: string[] = [];
  const optional = async (label: string, query: string) => {
    try { return await run(query); } catch (error) { warnings.push(`${label}を取得できませんでした`); console.warn(`MONTHLY_KPI_${label} ${(error as Error).message}`); return []; }
  };

  const [visitRows, photoRows, presentRows, memberRows, maidRows, historyRows, rewardRows] = await Promise.all([
    // ご帰宅の集計と回数帯を1回の読み取りで出す（全期間を読むため、同じ表を2回読まない）。
    // 回数帯: 通常ご帰宅の回数（実回数）で分け、その人たちの合計ご帰宅数（全区分）を足す。
    run(`
      WITH v AS (
        SELECT customerId, type, ${VISIT_COUNT_SQL} AS units, COALESCE(NULLIF(minutes, 0), weight * 20, 20) AS stay, ${businessMonth("`at`")} AS month
        FROM ${t("visits_current_range")}(DATE(@from), LAST_DAY(DATE(@to)), NULL)
        WHERE ${testUserCondition()}
      ), u AS (
        SELECT month, customerId, COUNTIF(type = "paid") AS n, SUM(IF(type = "paid", units, 0)) AS normal,
          COUNTIF(type = "reservation") AS reservation, COUNTIF(type = "trial") AS trial, COUNTIF(type = "free") AS free,
          SUM(units) AS units, SUM(stay) AS stay
        FROM v GROUP BY month, customerId
      )
      SELECT month, SUM(normal) AS normal, SUM(n) AS normalVisits, SUM(reservation) AS reservation, SUM(trial) AS trial, SUM(free) AS free,
        SUM(units) AS total, SUM(stay) AS serveMinutes, COUNTIF(n > 0) AS uu,
        COUNTIF(n = 1) AS b1Users,
        COUNTIF(n BETWEEN 2 AND 4) AS b2Users, SUM(IF(n BETWEEN 2 AND 4, units, 0)) AS b2Visits,
        COUNTIF(n BETWEEN 5 AND 19) AS b3Users, SUM(IF(n BETWEEN 5 AND 19, units, 0)) AS b3Visits,
        COUNTIF(n BETWEEN 20 AND 49) AS b4Users, SUM(IF(n BETWEEN 20 AND 49, units, 0)) AS b4Visits,
        COUNTIF(n >= 50) AS b5Users, SUM(IF(n >= 50, units, 0)) AS b5Visits
      FROM u GROUP BY month`),
    run(`
      SELECT ${businessMonth("`at`")} AS month, COUNT(DISTINCT id) AS photos
      FROM ${t("cheki_raw")}
      WHERE DATE(\`at\`) BETWEEN DATE_SUB(DATE(@from), INTERVAL 1 DAY) AND LAST_DAY(DATE(@to)) AND ${testUserCondition()}
      GROUP BY month`),
    // プレゼントの金額はアプリのメイド月次実績にしか無い（テストユーザーの切り替えは効かない）。
    optional("プレゼント", `
      SELECT CONCAT(SUBSTR(REGEXP_REPLACE(month, r"[^0-9]", ""), 1, 4), "-", SUBSTR(REGEXP_REPLACE(month, r"[^0-9]", ""), 5, 2)) AS month,
        SUM(totalPresentsPrice) AS presentYen
      FROM ${t("maid_monthly_current")} GROUP BY 1`),
    run(`
      SELECT m AS month,
        COUNTIF(c.registeredAt < TIMESTAMP(DATE_ADD(PARSE_DATE("%Y-%m", m), INTERVAL 1 MONTH), "Asia/Tokyo")) AS members,
        COUNTIF(FORMAT_TIMESTAMP("%Y-%m", c.registeredAt, "Asia/Tokyo") = m) AS newMembers
      FROM UNNEST(@months) AS m CROSS JOIN ${t("customers_current")} c
      WHERE ${testUserCondition("c")}
      GROUP BY m`),
    optional("入店・退店", `
      WITH s AS (
        SELECT maidId, MIN(scheduledStart) AS firstAt, MAX(scheduledStart) AS lastAt
        FROM ${t("shifts_current")} WHERE scheduledStart <= CURRENT_TIMESTAMP() GROUP BY maidId
      )
      SELECT m.name, m.status, ${businessMonth("s.firstAt")} AS firstMonth, ${businessMonth("s.lastAt")} AS lastMonth
      FROM s JOIN ${t("maids_current")} m ON m.id = s.maidId`),
    optional("CSVの記録", `SELECT * FROM ${t("monthly_kpi_history")}`),
    optional("メイド報酬", `SELECT month, maidReward FROM ${t("monthly_kpi_manual")}`),
  ]);

  const n = (value: unknown) => (value == null ? 0 : Number(value) || 0);
  const nOrNull = (value: unknown) => (value == null || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null);
  const auto = new Map<string, AutoMonth>();
  for (const month of autoMonths) {
    const v = visitRows.find((r) => r.month === month);
    const b = v;
    const m = memberRows.find((r) => r.month === month);
    if (!v && !m) continue;
    auto.set(month, {
      month,
      normal: n(v?.normal), normalVisits: n(v?.normalVisits), reservation: n(v?.reservation), trial: n(v?.trial), free: n(v?.free), total: n(v?.total),
      uu: n(v?.uu),
      buckets: {
        b1Users: n(b?.b1Users), b2Users: n(b?.b2Users), b2Visits: n(b?.b2Visits), b3Users: n(b?.b3Users), b3Visits: n(b?.b3Visits),
        b4Users: n(b?.b4Users), b4Visits: n(b?.b4Visits), b5Users: n(b?.b5Users), b5Visits: n(b?.b5Visits),
      },
      photos: n(photoRows.find((r) => r.month === month)?.photos),
      presentYen: nOrNull(presentRows.find((r) => r.month === month)?.presentYen),
      serveMinutes: n(v?.serveMinutes),
      members: m ? n(m.members) : null,
      newMembers: m ? n(m.newMembers) : null,
    });
  }

  // 売上: 月の確定売上（購入額＋前月末残高−当月末残高）。
  const sales = new Map<string, MonthSales>();
  const salesMonths = autoMonths.filter((month) => month >= FIRST_SALES_MONTH);
  if (salesMonths.length) {
    try {
      const balances = await loadBalances(salesMonths, options.includeTestUsers);
      for (const month of balances.months) {
        if (!month.revenue) continue;
        sales.set(month.month, { yen: month.revenue.total, provisional: month.status !== "confirmed", note: month.note });
      }
    } catch (error) {
      warnings.push("売上（未使用残高の記録）を取得できませんでした");
      console.warn(`MONTHLY_KPI_SALES ${(error as Error).message}`);
    }
  }

  const history = new Map<string, HistoryRow>();
  for (const row of historyRows) {
    const month = String(row.month);
    const record: HistoryRow = { month, presentCount: nOrNull(row.presentCount) };
    for (const column of KPI_COLUMNS) {
      if (column.format === "text") (record as Record<string, unknown>)[column.key] = row[column.key] == null ? null : String(row[column.key]);
      else (record as Record<string, unknown>)[column.key] = nOrNull(row[column.key]);
    }
    history.set(month, record);
  }
  const historyCutoff = [...history.keys()].sort().at(-1) ?? null;
  const manualReward = new Map(rewardRows.map((r) => [String(r.month), n(r.maidReward)]));

  // 出来事: CSVの無い月（自動の月）の年だけ公式サイトから取る。
  const newsYears = [...new Set(autoMonths.filter((month) => !historyCutoff || month > historyCutoff).map((month) => Number(month.slice(0, 4))))];
  const news = newsYears.length ? await loadOfficialNews(newsYears) : { items: [], errors: [] };
  warnings.push(...news.errors);

  const maids: MaidMove[] = maidRows.map((r) => ({
    name: String(r.name ?? ""), firstMonth: r.firstMonth ? String(r.firstMonth) : null, lastMonth: r.lastMonth ? String(r.lastMonth) : null,
    inactive: String(r.status) === "inactive",
  })).filter((m) => m.name);

  const firstMonth = [historyRows.length ? [...history.keys()].sort()[0] : autoFrom, autoFrom].sort()[0];
  const months = monthRange(firstMonth, currentMonth).reverse();
  const rows = buildMonthlyKpi({ months, auto, sales, manualReward, history, news: news.items, maids, historyCutoff });
  if (!historyRows.length) warnings.push("運営のCSV（2026年10月以前）がまだ取り込まれていません（runbook-2026-11/import-monthly-kpi-csv.sh）");
  return { rows, historyCutoff, autoFrom, includeTestUsers: options.includeTestUsers, warnings };
}
