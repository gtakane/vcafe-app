// 月次指標の読み込み（BigQuery・公式サイト）。組み立ては lib/monthly-kpi.ts の純関数で行う。

import { buildMonthlyKpi, monthRange, type AutoMonth, type HistoryRow, type KpiKey, type KpiOverrides, type KpiRow, type MaidMove, type MonthSales, type NewsItem, EDITABLE_KEYS, KPI_COLUMNS } from "./monthly-kpi.ts";
import { VISIT_COUNT_SQL } from "./summary-sql.ts";
import { testUserCondition } from "./test-users.ts";
import { loadBalances } from "./balances.ts";
import { loadOfficialNews } from "./official-news.ts";
import { excludingTax } from "./metrics.ts";

/**
 * データから出す最初の月（サービス開始）。CSVの空欄を埋め、CSVの値と見比べるため全期間を出す。
 * 全期間を読むため、データの集計は10分間使い回す（refresh で読み直し）。手入力の値は毎回読む（入力をすぐ反映するため）。
 */
export const AUTO_FROM = "2020-11";
const CACHE_MS = 10 * 60 * 1000;

/** 手入力の値以外（集計に時間がかかる部分）。 */
interface KpiInputs {
  months: string[];
  auto: Map<string, AutoMonth>;
  sales: Map<string, MonthSales>;
  history: Map<string, HistoryRow>;
  news: NewsItem[];
  maids: MaidMove[];
  historyCutoff: string | null;
  autoFrom: string;
  warnings: string[];
}
const cache = new Map<string, { at: number; value: KpiInputs }>();
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

async function bigQueryContext() {
  const projectId = process.env.BIGQUERY_PROJECT_ID;
  const dataset = process.env.BIGQUERY_DATASET;
  if (!projectId || !dataset) throw new Error("BigQueryの環境変数が設定されていません");
  const { BigQuery } = await import("@google-cloud/bigquery");
  return {
    bigquery: new BigQuery({ projectId }),
    location: process.env.BIGQUERY_LOCATION || "asia-northeast1",
    maximumBytesBilled: process.env.BIGQUERY_MAX_BYTES_BILLED || "1073741824",
    t: (name: string) => `\`${projectId}.${dataset}.${name}\``,
  };
}

export async function loadMonthlyKpi(options: { includeTestUsers: boolean; refresh?: boolean; now?: Date }): Promise<MonthlyKpiResult & { cachedAt: string }> {
  const cacheKey = options.includeTestUsers ? "include" : "exclude";
  let entry = cache.get(cacheKey);
  if (options.refresh || options.now || !entry || Date.now() - entry.at >= CACHE_MS) {
    entry = { at: Date.now(), value: await loadKpiInputs(options) };
    cache.set(cacheKey, entry);
  }
  const inputs = entry.value;
  const warnings = [...inputs.warnings];
  const overrides = await loadOverrides().catch((error) => {
    warnings.push("手入力の値を取得できませんでした（runbook-2026-11/step12-kpi-manual-input.sh が未実行の可能性があります）");
    console.warn(`MONTHLY_KPI_OVERRIDES ${(error as Error).message}`);
    return new Map() as KpiOverrides;
  });
  const rows = buildMonthlyKpi({ ...inputs, manualReward: new Map(), overrides });
  return { rows, historyCutoff: inputs.historyCutoff, autoFrom: inputs.autoFrom, includeTestUsers: options.includeTestUsers, warnings, cachedAt: new Date(entry.at).toISOString() };
}

/**
 * 手入力の値（列ごとの最新の1件。消した列は除く）。以前の set-maid-reward.sh の表（monthly_kpi_manual）も読む。
 */
async function loadOverrides(): Promise<KpiOverrides> {
  const { bigquery, location, t } = await bigQueryContext();
  const [rows] = await bigquery.query({ location, query: `
    WITH all_rows AS (
      SELECT month, field, numberValue, textValue, COALESCE(cleared, FALSE) AS cleared, enteredAt FROM ${t("monthly_kpi_overrides")}
      UNION ALL
      SELECT month, "maidReward", maidReward, CAST(NULL AS STRING), FALSE, enteredAt FROM ${t("monthly_kpi_manual")}
    )
    SELECT month, field, numberValue, textValue, cleared FROM all_rows
    WHERE TRUE
    QUALIFY ROW_NUMBER() OVER (PARTITION BY month, field ORDER BY enteredAt DESC) = 1` });
  const overrides: KpiOverrides = new Map();
  for (const row of rows as Array<Record<string, unknown>>) {
    const key = String(row.field) as KpiKey;
    if (row.cleared || !EDITABLE_KEYS.has(key)) continue;
    const value = row.textValue != null ? String(row.textValue) : row.numberValue != null ? Number(row.numberValue) : null;
    if (value == null) continue;
    const month = String(row.month);
    if (!overrides.has(month)) overrides.set(month, new Map());
    overrides.get(month)!.set(key, value);
  }
  return overrides;
}

/** 手入力の値を保存する（value が null なら、その列の手入力を消してCSV・データの値に戻す）。追記のみで、履歴は残る。 */
export async function saveKpiOverride(input: { month: string; field: KpiKey; value: number | string | null; enteredBy: string }): Promise<void> {
  const { bigquery, location, t } = await bigQueryContext();
  await bigquery.query({
    location,
    query: `INSERT INTO ${t("monthly_kpi_overrides")} (month, field, numberValue, textValue, cleared, enteredAt, enteredBy)
            VALUES (@month, @field, @numberValue, @textValue, @cleared, CURRENT_TIMESTAMP(), @enteredBy)`,
    params: {
      month: input.month, field: input.field,
      numberValue: typeof input.value === "number" ? input.value : null,
      textValue: typeof input.value === "string" ? input.value : null,
      cleared: input.value == null, enteredBy: input.enteredBy,
    },
    types: { numberValue: "FLOAT64", textValue: "STRING" },
  });
}

async function loadKpiInputs(options: { includeTestUsers: boolean; now?: Date }): Promise<KpiInputs> {
  const { bigquery, location, maximumBytesBilled, t } = await bigQueryContext();
  const now = options.now ?? new Date();
  const currentMonth = new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 7); // 営業日（JST-2h）の月
  const autoFrom = AUTO_FROM;
  const autoMonths = monthRange(autoFrom, currentMonth);
  const params = { from: `${autoFrom}-01`, to: `${currentMonth}-28`, months: autoMonths, includeTestUsers: options.includeTestUsers };
  const run = async (query: string) => (await bigquery.query({ location, params, maximumBytesBilled, query }))[0] as Array<Record<string, unknown>>;
  const warnings: string[] = [];
  const optional = async (label: string, query: string) => {
    try { return await run(query); } catch (error) { warnings.push(`${label}を取得できませんでした`); console.warn(`MONTHLY_KPI_${label} ${(error as Error).message}`); return []; }
  };

  const [visitRows, photoRows, presentRows, memberRows, maidRows, historyRows] = await Promise.all([
    // ご帰宅の集計と回数帯を1回の読み取りで出す（全期間を読むため、同じ表を2回読まない）。
    // 回数帯: 通常ご帰宅の回数（実回数）で分け、その人たちの通常ご帰宅の回数を足す
    // （運営のCSVの「総数」は回数。枠数で足すと40分のご帰宅の分だけ多くなる）。
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
        COUNTIF(n BETWEEN 2 AND 4) AS b2Users, SUM(IF(n BETWEEN 2 AND 4, n, 0)) AS b2Visits,
        COUNTIF(n BETWEEN 5 AND 19) AS b3Users, SUM(IF(n BETWEEN 5 AND 19, n, 0)) AS b3Visits,
        COUNTIF(n BETWEEN 20 AND 49) AS b4Users, SUM(IF(n BETWEEN 20 AND 49, n, 0)) AS b4Visits,
        COUNTIF(n >= 50) AS b5Users, SUM(IF(n >= 50, n, 0)) AS b5Visits
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
        // 運営のCSVの売上は税抜（経理の「売上合計（税抜）」と同じ）。月の確定売上の税抜で出す。
        sales.set(month.month, { yen: month.revenueExcludingTax ?? excludingTax(month.revenue.total), provisional: month.status !== "confirmed", note: month.note });
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
  if (!historyRows.length) warnings.push("運営のCSV（2026年10月以前）がまだ取り込まれていません（runbook-2026-11/import-monthly-kpi-csv.sh）");
  return { months, auto, sales, history, news: news.items, maids, historyCutoff, autoFrom, warnings };
}
