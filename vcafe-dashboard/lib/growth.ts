import { businessDateJst, isPaid, shiftActualHours } from "./metrics.ts";
import { mockAnalyticsData, customers as mockCustomers } from "./mock-data.ts";
import type { Visit } from "./types";

// 座席モデルの定数は lib/metrics.ts（共通ロジックの正典）へ移動。
// 既存の参照を壊さないよう再エクスポートしつつ、本ファイル内でも使う。
import { CAPACITY_PER_MAID_HOUR } from "./metrics.ts";
export { SEATS_PER_MAID, SLOTS_PER_HOUR, CAPACITY_PER_MAID_HOUR } from "./metrics.ts";

// グロース指標（DAU・新規登録・新規課金転換率・離脱率・占有率/空席率）の算出。
// すべて既存の同期データ（visits_current / customers_current / shifts_current）から導出でき、
// 追加のスキーマ変更・再バックフィルを必要としない定義にしている。

export interface GrowthDailyPoint {
  label: string;
  sortAt: number;
  dau: number;
}

export interface GrowthMetrics {
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
  activeUsers: number; // 期間内ユニークアクティブユーザー
  avgDau: number; // 平均DAU（営業日あたり）
  peakDau: number; // ピークDAU
  avgWau: number; // 平均WAU（週あたりユニーク、月〜日の週）
  peakWau: number; // ピークWAU
  avgMau: number; // 平均MAU（暦月あたりユニーク）
  peakMau: number; // ピークMAU
  stickiness: number; // 定着率 = 平均DAU / 平均MAU（0〜1）
  daily: GrowthDailyPoint[]; // DAU推移（営業日基準）
  newRegistrations: number; // 新規登録者数
  newPaidConversions: number; // 新規のうち有料ご帰宅に至った人数
  newPaidConversionRate: number; // 新規課金転換率 0〜1
  prevActiveUsers: number; // 直前同期間のアクティブ
  churnedUsers: number; // 直前同期間はアクティブだが当期間に来なかった人数
  churnRate: number; // 離脱率 0〜1
  workHours: number; // その期間にお給仕した全メイドの合計お給仕時間(h)
  occupiedSlots: number; // 実際に利用されたユーザー枠（重み付きご帰宅数, 滞在20分=1枠）
  capacitySlots: number; // 最大利用可能ユーザー枠 = 合計お給仕時間 × 9
  occupancyRate: number; // 占有率 0〜1
  vacancyRate: number; // 空席率 0〜1
}

export interface GrowthRegistration {
  id: string;
  registeredAt: string | null;
}

export interface GrowthVisitRow {
  customerId: string;
  maidId: string;
  at: string;
  type: Visit["type"];
  weight?: number; // 滞在20分=1。省略時は1として扱う。
}

export interface GrowthShiftRow {
  maidId: string;
  scheduledStart: string;
  scheduledEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
}

const pad2 = (value: number) => String(value).padStart(2, "0");

function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function daysInclusive(start: string, end: string): number {
  const [ay, am, ad] = start.split("-").map(Number);
  const [by, bm, bd] = end.split("-").map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

function dayList(start: string, end: string): string[] {
  const list: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    list.push(day);
    if (list.length > 800) break; // 上限ガード（最大366日運用だが暴走防止）
  }
  return list;
}

// 登録日はJSTの暦日で判定（営業日の2時間シフトは適用しない）。
function jstDate(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3_600_000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// 営業日 'YYYY-MM-DD' が属する週（月曜始まり）の月曜日を返す。analytics.ts の週次バケットと一致。
function weekKeyOf(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const offset = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - offset);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function avgAndPeak(sets: Map<string, Set<string>>): { avg: number; peak: number } {
  const counts = [...sets.values()].map((s) => s.size);
  if (!counts.length) return { avg: 0, peak: 0 };
  return { avg: Math.round(counts.reduce((a, b) => a + b, 0) / counts.length), peak: Math.max(...counts) };
}

function ensureSet<K>(map: Map<K, Set<string>>, key: K): Set<string> {
  let set = map.get(key);
  if (!set) { set = new Set(); map.set(key, set); }
  return set;
}

/** 生データ（当期＋前期のvisits、当期のshifts、当期の新規登録）からグロース指標を計算する純関数。 */
export function computeGrowth(
  start: string,
  end: string,
  registrations: GrowthRegistration[],
  visits: GrowthVisitRow[],
  shifts: GrowthShiftRow[],
): GrowthMetrics {
  const len = daysInclusive(start, end);
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(len - 1));

  const currentActive = new Set<string>();
  const prevActive = new Set<string>();
  const dauByDay = new Map<string, Set<string>>();
  const wauByWeek = new Map<string, Set<string>>();
  const mauByMonth = new Map<string, Set<string>>();
  const payingCurrent = new Set<string>();
  let occupiedSlots = 0;

  for (const visit of visits) {
    const bd = businessDateJst(visit.at);
    if (bd >= start && bd <= end) {
      currentActive.add(visit.customerId);
      ensureSet(dauByDay, bd).add(visit.customerId);
      ensureSet(wauByWeek, weekKeyOf(bd)).add(visit.customerId);
      ensureSet(mauByMonth, bd.slice(0, 7)).add(visit.customerId);
      occupiedSlots += visit.weight ?? 1;
      if (isPaid(visit.type)) payingCurrent.add(visit.customerId);
    } else if (bd >= prevStart && bd <= prevEnd) {
      prevActive.add(visit.customerId);
    }
  }

  const daily: GrowthDailyPoint[] = dayList(start, end).map((day) => {
    const [, mm, dd] = day.split("-");
    return { label: `${mm}/${dd}`, sortAt: Date.parse(`${day}T00:00:00Z`), dau: dauByDay.get(day)?.size ?? 0 };
  });
  const avgDau = daily.length ? Math.round(daily.reduce((sum, p) => sum + p.dau, 0) / daily.length) : 0;
  const peakDau = daily.reduce((max, p) => Math.max(max, p.dau), 0);
  const { avg: avgWau, peak: peakWau } = avgAndPeak(wauByWeek);
  const { avg: avgMau, peak: peakMau } = avgAndPeak(mauByMonth);
  const stickiness = avgMau > 0 ? avgDau / avgMau : 0;

  const regInRange = registrations.filter((r) => r.registeredAt && jstDate(r.registeredAt) >= start && jstDate(r.registeredAt) <= end);
  const newRegistrations = regInRange.length;
  const newPaidConversions = regInRange.filter((r) => payingCurrent.has(r.id)).length;
  const newPaidConversionRate = newRegistrations ? newPaidConversions / newRegistrations : 0;

  let churnedUsers = 0;
  prevActive.forEach((id) => { if (!currentActive.has(id)) churnedUsers += 1; });
  const churnRate = prevActive.size ? churnedUsers / prevActive.size : 0;

  // 最大利用可能枠 = 合計お給仕時間(h) × 9名/時。空席率 = 空き枠 ÷ 最大枠。
  let workHours = 0;
  for (const shift of shifts) {
    const bd = businessDateJst(shift.scheduledStart);
    if (bd < start || bd > end) continue;
    workHours += shiftActualHours(shift);
  }
  const capacitySlots = workHours * CAPACITY_PER_MAID_HOUR;
  const occupancyRate = capacitySlots > 0 ? occupiedSlots / capacitySlots : 0;
  const vacancyRate = capacitySlots > 0 ? Math.max(0, 1 - occupancyRate) : 0;

  return {
    start, end, prevStart, prevEnd,
    activeUsers: currentActive.size,
    avgDau, peakDau, avgWau, peakWau, avgMau, peakMau, stickiness, daily,
    newRegistrations, newPaidConversions, newPaidConversionRate,
    prevActiveUsers: prevActive.size, churnedUsers, churnRate,
    workHours, occupiedSlots, capacitySlots, occupancyRate, vacancyRate,
  };
}

function tsIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "object" && "value" in (value as Record<string, unknown>)) return String((value as { value: unknown }).value);
  return String(value);
}

function computeGrowthFromMock(start: string, end: string): GrowthMetrics {
  const registrations: GrowthRegistration[] = mockCustomers.map((c) => ({ id: c.id, registeredAt: c.registeredAt }));
  const visits: GrowthVisitRow[] = mockAnalyticsData.visits.map((v) => ({ customerId: v.customerId, maidId: v.maidId, at: v.at, type: v.type, weight: v.weight }));
  const shifts: GrowthShiftRow[] = mockAnalyticsData.shifts.map((s) => ({ maidId: s.maidId, scheduledStart: s.scheduledStart, scheduledEnd: s.scheduledEnd, actualStart: s.actualStart, actualEnd: s.actualEnd }));
  return computeGrowth(start, end, registrations, visits, shifts);
}

export async function loadGrowthData(query: { start: string; end: string }): Promise<GrowthMetrics> {
  const { start, end } = query;
  if (process.env.ANALYTICS_BACKEND !== "bigquery") return computeGrowthFromMock(start, end);

  const projectId = process.env.BIGQUERY_PROJECT_ID;
  const dataset = process.env.BIGQUERY_DATASET;
  if (!projectId || !dataset) throw new Error("BigQueryの環境変数が設定されていません");
  const len = daysInclusive(start, end);
  const prevStart = addDays(start, -len);
  const { BigQuery } = await import("@google-cloud/bigquery");
  const bigquery = new BigQuery({ projectId });
  const location = process.env.BIGQUERY_LOCATION || "asia-northeast1";
  const maximumBytesBilled = process.env.BIGQUERY_MAX_BYTES_BILLED || "1073741824";
  const businessDate = (column: string) => `DATE(TIMESTAMP_SUB(${column}, INTERVAL 2 HOUR), "Asia/Tokyo")`;
  const params: Record<string, string> = { start, end, prevStart };

  const [regRows] = await bigquery.query({
    location, params, maximumBytesBilled,
    query: `SELECT id, registeredAt FROM \`${projectId}.${dataset}.customers_current\`
            WHERE registeredAt IS NOT NULL AND DATE(registeredAt, "Asia/Tokyo") BETWEEN DATE(@start) AND DATE(@end)`,
  });
  const [visitRows] = await bigquery.query({
    location, params, maximumBytesBilled,
    query: `SELECT customerId, maidId, \`at\`, type, weight FROM \`${projectId}.${dataset}.visits_current\`
            WHERE ${businessDate("`at`")} BETWEEN DATE(@prevStart) AND DATE(@end)`,
  });
  const [shiftRows] = await bigquery.query({
    location, params, maximumBytesBilled,
    query: `SELECT maidId, scheduledStart, scheduledEnd, actualStart, actualEnd FROM \`${projectId}.${dataset}.shifts_current\`
            WHERE ${businessDate("scheduledStart")} BETWEEN DATE(@start) AND DATE(@end)`,
  });

  const registrations: GrowthRegistration[] = regRows.map((r) => ({ id: String(r.id), registeredAt: tsIso(r.registeredAt) }));
  const visits: GrowthVisitRow[] = visitRows.map((r) => ({ customerId: String(r.customerId), maidId: String(r.maidId), at: tsIso(r.at) ?? "", type: String(r.type) as Visit["type"], weight: Number(r.weight ?? 1) || 1 })).filter((v) => v.at);
  const shifts: GrowthShiftRow[] = shiftRows.map((r) => ({ maidId: String(r.maidId), scheduledStart: tsIso(r.scheduledStart) ?? "", scheduledEnd: tsIso(r.scheduledEnd) ?? "", actualStart: tsIso(r.actualStart), actualEnd: tsIso(r.actualEnd) })).filter((s) => s.scheduledStart && s.scheduledEnd);
  return computeGrowth(start, end, registrations, visits, shifts);
}
