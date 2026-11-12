// 施策と課金のグロース指標（2026-11追加）。
//   1. 新規登録数と、登録から14日以内の初回課金率
//   2. 新規ユーザー無料を使った人が、その後に有料化した率
//   3. 新人メイド無料を使った人が、そのメイドへ有料で再訪した率
//   4. 月ごとの課金者数と、課金者1人あたりの課金額・利用額
//   5. 登録月ごとの課金継続率
//   6. 未使用残高（前受金）の推移 … 残高の記録（balance_snapshots）から。lib/balances.ts
//
// 計算は純関数（テスト可能）で行い、BigQuery からは必要最小限の行だけを取る。

import { businessDateJst, isPaid } from "./metrics.ts";
import type { Visit } from "./types";

export const FIRST_PAYMENT_WINDOW_DAYS = 14;
export const COHORT_MONTHS = 12;

export interface InsightRegistration { id: string; registeredAt: string | null }
export interface InsightPayment { customerId: string; at: string; amount: number }
export interface InsightVisit { customerId: string; maidId: string; at: string; type: Visit["type"]; entryType?: string | null; revenue?: number }
export interface InsightMonthlyUsage { month: string; usingUsers: number; usage: number } // 有料利用（消費）の月次集計（SQLで算出）

export interface RateResult { total: number; judged: number; converted: number; rate: number | null; pending: number }

export interface MonthlyPayingPoint {
  month: string; // YYYY-MM
  payingUsers: number; // 課金者数（その月に1回以上課金）
  paymentAmount: number; // 課金額合計（円・ストア/Stripe実払い）
  arppu: number; // 課金者1人あたり課金額
  usingUsers: number; // 有料利用者数（その月に有料ご帰宅・予約をした人）
  usage: number; // 利用額（経理と同じ単価の消費額）
  usagePerUser: number; // 有料利用者1人あたり利用額
}

export interface CohortRow {
  month: string; // 登録月 YYYY-MM
  size: number; // 登録者数
  rates: Array<number | null>; // k か月目（0=登録月）に課金した人の割合。未来の月は null
}

export interface GrowthInsights {
  asOf: string; // 判定基準日（JST, YYYY-MM-DD）
  firstPayment: RateResult & { registrations: number }; // 1
  newUserFree: RateResult; // 2
  freshMaidFree: RateResult; // 3
  monthly: MonthlyPayingPoint[]; // 4
  cohorts: CohortRow[]; // 5
}

const DAY_MS = 86400000;
const jstMonth = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit" }).format(new Date(iso)).slice(0, 7);
const jstDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date(iso));

export function monthsBack(endMonth: string, count: number): string[] {
  const [y, m] = endMonth.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (count - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

function monthIndex(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return y * 12 + (m - 1);
}

const rate = (converted: number, judged: number) => (judged ? converted / judged : null);

/**
 * 1. 期間内の新規登録者のうち、登録から14日以内に初めて課金した人の割合。
 *    登録から14日経っていない人は判定できないため分母から外し、「判定待ち」として数える。
 */
export function firstPaymentRate(registrations: InsightRegistration[], payments: InsightPayment[], range: { start: string; end: string }, now: Date): GrowthInsights["firstPayment"] {
  const inRange = registrations.filter((r) => r.registeredAt && jstDay(r.registeredAt) >= range.start && jstDay(r.registeredAt) <= range.end);
  const firstPaid = new Map<string, number>();
  for (const p of payments) {
    const t = Date.parse(p.at);
    const current = firstPaid.get(p.customerId);
    if (current === undefined || t < current) firstPaid.set(p.customerId, t);
  }
  let judged = 0, converted = 0, pending = 0;
  for (const r of inRange) {
    const registered = Date.parse(r.registeredAt!);
    const deadline = registered + FIRST_PAYMENT_WINDOW_DAYS * DAY_MS;
    const paidAt = firstPaid.get(r.id);
    if (paidAt !== undefined && paidAt <= deadline) { judged += 1; converted += 1; continue; }
    if (deadline > now.getTime()) { pending += 1; continue; } // まだ14日経っていない
    judged += 1;
  }
  return { registrations: inRange.length, total: inRange.length, judged, converted, pending, rate: rate(converted, judged) };
}

/**
 * 2. 期間内に初めて「新規ユーザー無料」を使った人のうち、その後に有料化した人の割合。
 *    有料化 = 無料の利用より後に、課金した または 有料ご帰宅（予約を含む）をした。判定は今日時点まで。
 */
export function newUserFreeConversion(visits: InsightVisit[], payments: InsightPayment[], range: { start: string; end: string }): RateResult {
  const firstFree = new Map<string, number>();
  for (const v of visits) {
    if (v.type !== "free" || v.entryType !== "newUserFree") continue;
    const t = Date.parse(v.at);
    const current = firstFree.get(v.customerId);
    if (current === undefined || t < current) firstFree.set(v.customerId, t);
  }
  const users = [...firstFree].filter(([, t]) => { const d = businessDateJst(new Date(t).toISOString()); return d >= range.start && d <= range.end; });
  const laterPaid = (customerId: string, after: number) =>
    payments.some((p) => p.customerId === customerId && Date.parse(p.at) > after) ||
    visits.some((v) => v.customerId === customerId && isPaid(v.type) && Date.parse(v.at) > after);
  const converted = users.filter(([id, t]) => laterPaid(id, t)).length;
  return { total: users.length, judged: users.length, converted, pending: 0, rate: rate(converted, users.length) };
}

/**
 * 3. 期間内に「新人メイド無料」を使った（ユーザー×メイド）のうち、その後に同じメイドへ有料でご帰宅した割合。
 */
export function freshMaidFreeRevisit(visits: InsightVisit[], range: { start: string; end: string }): RateResult {
  const firstFree = new Map<string, number>(); // key = customerId|maidId
  for (const v of visits) {
    if (v.type !== "free" || v.entryType !== "freshMaidFree") continue;
    const key = `${v.customerId}|${v.maidId}`;
    const t = Date.parse(v.at);
    const current = firstFree.get(key);
    if (current === undefined || t < current) firstFree.set(key, t);
  }
  const pairs = [...firstFree].filter(([, t]) => { const d = businessDateJst(new Date(t).toISOString()); return d >= range.start && d <= range.end; });
  const converted = pairs.filter(([key, t]) => {
    const [customerId, maidId] = key.split("|");
    return visits.some((v) => v.customerId === customerId && v.maidId === maidId && isPaid(v.type) && Date.parse(v.at) > t);
  }).length;
  return { total: pairs.length, judged: pairs.length, converted, pending: 0, rate: rate(converted, pairs.length) };
}

/** 4. 月ごとの課金者数・課金者1人あたり課金額と、有料利用者数・1人あたり利用額。 */
export function monthlyPaying(payments: InsightPayment[], usage: InsightMonthlyUsage[], months: string[]): MonthlyPayingPoint[] {
  return months.map((month) => {
    const inMonth = payments.filter((p) => jstMonth(p.at) === month);
    const payingUsers = new Set(inMonth.map((p) => p.customerId)).size;
    const paymentAmount = Math.round(inMonth.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
    const u = usage.find((x) => x.month === month);
    const usingUsers = u?.usingUsers ?? 0, used = Math.round(u?.usage ?? 0);
    return {
      month, payingUsers, paymentAmount, arppu: payingUsers ? Math.round(paymentAmount / payingUsers) : 0,
      usingUsers, usage: used, usagePerUser: usingUsers ? Math.round(used / usingUsers) : 0,
    };
  });
}

/** 5. 登録月ごとに、登録から k か月目に課金した人の割合（k=0 は登録月）。 */
export function payingCohorts(registrations: InsightRegistration[], payments: InsightPayment[], months: string[], currentMonth: string): CohortRow[] {
  const paidMonths = new Map<string, Set<number>>();
  for (const p of payments) {
    const set = paidMonths.get(p.customerId) || new Set<number>();
    set.add(monthIndex(jstMonth(p.at)));
    paidMonths.set(p.customerId, set);
  }
  const current = monthIndex(currentMonth);
  return months.map((month) => {
    const cohort = registrations.filter((r) => r.registeredAt && jstMonth(r.registeredAt) === month);
    const start = monthIndex(month);
    const rates = Array.from({ length: COHORT_MONTHS }, (_, k) => {
      if (start + k > current) return null;
      if (!cohort.length) return 0;
      const paid = cohort.filter((r) => paidMonths.get(r.id)?.has(start + k)).length;
      return paid / cohort.length;
    });
    return { month, size: cohort.length, rates };
  });
}

export function computeInsights(input: {
  range: { start: string; end: string };
  now: Date;
  registrations: InsightRegistration[];
  payments: InsightPayment[];
  visits: InsightVisit[];
  usage: InsightMonthlyUsage[];
}): GrowthInsights {
  const endMonth = input.range.end.slice(0, 7);
  const months = monthsBack(endMonth, COHORT_MONTHS);
  const currentMonth = jstMonth(input.now.toISOString());
  return {
    asOf: jstDay(input.now.toISOString()),
    firstPayment: firstPaymentRate(input.registrations, input.payments, input.range, input.now),
    newUserFree: newUserFreeConversion(input.visits, input.payments, input.range),
    freshMaidFree: freshMaidFreeRevisit(input.visits, input.range),
    monthly: monthlyPaying(input.payments, input.usage, months),
    cohorts: payingCohorts(input.registrations, input.payments, months, currentMonth < endMonth ? currentMonth : endMonth),
  };
}

const tsIso = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "object" && "value" in (value as Record<string, unknown>)) return String((value as { value: unknown }).value);
  return String(value);
};

/** BigQuery から必要な行を取り、指標を計算する。 */
export async function loadGrowthInsights(range: { start: string; end: string }): Promise<GrowthInsights> {
  const projectId = process.env.BIGQUERY_PROJECT_ID;
  const dataset = process.env.BIGQUERY_DATASET;
  if (!projectId || !dataset) throw new Error("BigQueryの環境変数が設定されていません");
  const { BigQuery } = await import("@google-cloud/bigquery");
  const bigquery = new BigQuery({ projectId });
  const location = process.env.BIGQUERY_LOCATION || "asia-northeast1";
  const maximumBytesBilled = process.env.BIGQUERY_MAX_BYTES_BILLED || "1073741824";
  const months = monthsBack(range.end.slice(0, 7), COHORT_MONTHS);
  const from = `${months[0]}-01`; // 12か月前の月初
  const params = { from, start: range.start, end: range.end };
  const t = (name: string) => `\`${projectId}.${dataset}.${name}\``;
  const run = async (query: string) => (await bigquery.query({ location, params, maximumBytesBilled, query }))[0] as Array<Record<string, unknown>>;

  const [regRows, payRows, visitRows, usageRows] = await Promise.all([
    run(`SELECT id, registeredAt FROM ${t("customers_current")} WHERE registeredAt IS NOT NULL AND DATE(registeredAt, "Asia/Tokyo") >= DATE(@from)`),
    // 課金台帳（userPayments）。初回課金の判定のため、登録月の前後も含めて12か月前から取る。
    run(`SELECT customerId, \`at\`, amount FROM ${t("payments_current_range")}(DATE_SUB(DATE(@from), INTERVAL 1 DAY), CURRENT_DATE("Asia/Tokyo"))`),
    // 無料ご帰宅は2026-11-06開始。期間の開始から今日までのご帰宅（その後の有料化を見るため）。
    run(`SELECT customerId, maidId, \`at\`, type, entryType FROM ${t("visits_current_range")}(GREATEST(DATE(@start), DATE "2026-11-06"), CURRENT_DATE("Asia/Tokyo"), NULL)`),
    // 有料利用（消費）の月次。経理と同じ単価（metrics.ts visitRevenue と同じ式）＋予約・招待。
    run(`
      WITH v AS (
        SELECT customerId, FORMAT_DATE("%Y-%m", DATE(TIMESTAMP_SUB(\`at\`, INTERVAL 2 HOUR), "Asia/Tokyo")) AS month,
          ROUND(COALESCE(billedCoin, 0) * 1.19) + ROUND(COALESCE(billedRewardPoint, 0) * 1.1)
          + CASE ticketId WHEN "gokitaku30minutes" THEN 850 WHEN "premiumGokitaku1" THEN 960 WHEN "luckyGokitaku" THEN 650 ELSE 0 END * COALESCE(usedTicketCount, 1) AS yen
        FROM ${t("visits_current_range")}(DATE(@from), DATE(@end), NULL)
        WHERE type NOT IN ("free", "trial", "reservation") AND ticketId IS NOT NULL
      ), b AS (
        SELECT customerId, FORMAT_DATE("%Y-%m", DATE(TIMESTAMP_SUB(\`at\`, INTERVAL 2 HOUR), "Asia/Tokyo")) AS month, revenue AS yen
        FROM ${t("bookings_current")}
        WHERE NOT COALESCE(canceled, FALSE) AND DATE(TIMESTAMP_SUB(\`at\`, INTERVAL 2 HOUR), "Asia/Tokyo") BETWEEN DATE(@from) AND DATE(@end)
      )
      SELECT month, COUNT(DISTINCT customerId) AS usingUsers, SUM(yen) AS usage FROM (SELECT * FROM v UNION ALL SELECT * FROM b) GROUP BY month`).catch(() => []),
  ]);

  return computeInsights({
    range,
    now: new Date(),
    registrations: regRows.map((r) => ({ id: String(r.id), registeredAt: tsIso(r.registeredAt) })),
    payments: payRows.map((r) => ({ customerId: String(r.customerId), at: tsIso(r.at) ?? "", amount: Number(r.amount) || 0 })).filter((p) => p.at),
    visits: visitRows.map((r) => ({ customerId: String(r.customerId), maidId: String(r.maidId), at: tsIso(r.at) ?? "", type: String(r.type) as Visit["type"], entryType: r.entryType ? String(r.entryType) : null })).filter((v) => v.at),
    usage: usageRows.map((r) => ({ month: String(r.month), usingUsers: Number(r.usingUsers) || 0, usage: Number(r.usage) || 0 })),
  });
}
