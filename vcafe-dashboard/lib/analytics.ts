import type { AnalyticsData, Granularity, Viewer, Visit } from "./types";
import {
  businessDateJst,
  CHEKI_PRICE,
  shiftActualHours,
  shiftLateMinutes,
  weightedPaidCount,
  weightedVisitCount,
} from "./metrics.ts";

export interface AnalyticsFilter {
  start: string;
  end: string;
  granularity: Granularity;
  maidId?: string;
}

export function enforceMaidScope(viewer: Viewer, requestedMaidId?: string) {
  if (viewer.role === "maid") {
    if (!viewer.maidId) throw new Error("メイドアカウントにmaidIdが設定されていません");
    return viewer.maidId;
  }
  return requestedMaidId || undefined;
}

export function scopeDataForViewer(data: AnalyticsData, viewer: Viewer): AnalyticsData {
  if (viewer.role === "admin") return data;
  const maidId = enforceMaidScope(viewer);
  const visits = data.visits.filter((visit) => visit.maidId === maidId);
  const shifts = data.shifts.filter((shift) => shift.maidId === maidId);
  const sourceCustomerIds = [...new Set(visits.map((visit) => visit.customerId))];
  const aliases = new Map(sourceCustomerIds.map((id, index) => [id, `segment-${String(index + 1).padStart(3, "0")}`]));
  return {
    ...data,
    maids: data.maids.filter((maid) => maid.id === maidId),
    customers: data.customers
      .filter((customer) => aliases.has(customer.id))
      .map((customer) => ({
        ...customer,
        id: aliases.get(customer.id)!,
        name: "非表示",
        registeredAt: customer.registeredAt?.slice(0, 7) ?? null,
      })),
    visits: visits.map((visit) => ({ ...visit, customerId: aliases.get(visit.customerId)! })),
    shifts,
  };
}

export function filterData(data: AnalyticsData, viewer: Viewer, filter: AnalyticsFilter): AnalyticsData {
  const maidId = enforceMaidScope(viewer, filter.maidId);
  const start = new Date(`${filter.start}T00:00:00+09:00`).getTime();
  const end = new Date(`${filter.end}T23:59:59.999+09:00`).getTime();
  const visits = data.visits.filter((v) => {
    const at = new Date(v.at).getTime();
    return at >= start && at <= end && (!maidId || v.maidId === maidId);
  });
  const shifts = data.shifts.filter((s) => {
    const at = new Date(s.scheduledStart).getTime();
    return at >= start && at <= end && (!maidId || s.maidId === maidId);
  });
  const visibleMaidIds = maidId ? new Set([maidId]) : new Set(data.maids.map((m) => m.id));
  const visibleCustomerIds = new Set(visits.map((v) => v.customerId));
  return {
    ...data,
    maids: data.maids.filter((m) => visibleMaidIds.has(m.id)),
    customers: data.customers.filter((u) => visibleCustomerIds.has(u.id)),
    visits,
    shifts,
  };
}

export function summarize(data: AnalyticsData) {
  // 売上・ご帰宅数はcore.pyと一致させる（チェキ単価は定数、ご帰宅数・有料数は重み付き）。
  const revenue = data.visits.reduce((sum, v) => sum + v.revenue + v.cheki * CHEKI_PRICE, 0);
  const customerCount = new Set(data.visits.map((v) => v.customerId)).size;
  const paid = weightedPaidCount(data.visits);
  const cheki = data.visits.reduce((sum, v) => sum + v.cheki, 0);
  const workMinutes = data.shifts.reduce((sum, s) => sum + shiftActualHours(s) * 60, 0);
  const lateMinutes = data.shifts.reduce((sum, s) => sum + shiftLateMinutes(s), 0);
  return { visits: weightedVisitCount(data.visits), revenue, customerCount, paid, cheki, workHours: workMinutes / 60, lateMinutes };
}

function bucketKey(at: string, granularity: Granularity) {
  // 日次/週次/月次は営業日（0:00〜1:59を前日扱い）を基準にする（core.py _biz_date と一致）。
  // 時間別だけは実時刻をそのまま用いる。
  const businessDate = businessDateJst(at); // 'YYYY-MM-DD'（JST営業日）
  const [y, mm, dd] = businessDate.split("-");
  if (granularity === "hour") {
    const local = new Date(new Date(at).getTime() + 9 * 3600000);
    return `${String(local.getUTCMonth() + 1).padStart(2, "0")}/${String(local.getUTCDate()).padStart(2, "0")} ${String(local.getUTCHours()).padStart(2, "0")}:00`;
  }
  if (granularity === "month") return `${y}/${mm}`;
  if (granularity === "week") {
    const monday = new Date(Date.UTC(Number(y), Number(mm) - 1, Number(dd)));
    const offset = (monday.getUTCDay() + 6) % 7;
    monday.setUTCDate(monday.getUTCDate() - offset);
    return `${String(monday.getUTCMonth() + 1).padStart(2, "0")}/${String(monday.getUTCDate()).padStart(2, "0")}週`;
  }
  return `${mm}/${dd}`;
}

export function buildTrend(visits: Visit[], granularity: Granularity) {
  const map = new Map<string, { label: string; visits: number; revenue: number }>();
  visits.forEach((visit) => {
    const label = bucketKey(visit.at, granularity);
    const current = map.get(label) || { label, visits: 0, revenue: 0 };
    current.visits += visit.weight ?? 1;
    current.revenue += visit.revenue + visit.cheki * CHEKI_PRICE;
    map.set(label, current);
  });
  return [...map.values()];
}

export function maidRows(data: AnalyticsData) {
  return data.maids.map((maid) => {
    const visits = data.visits.filter((v) => v.maidId === maid.id);
    const shifts = data.shifts.filter((s) => s.maidId === maid.id);
    const users = new Set(visits.map((v) => v.customerId)).size;
    const revenue = visits.reduce((sum, v) => sum + v.revenue + v.cheki * CHEKI_PRICE, 0);
    const workHours = shifts.reduce((sum, s) => sum + shiftActualHours(s), 0);
    // 平均ご帰宅数(件/h)は予約を除いた重み付き件数 / 稼働時間（core.py: non_rsv_weight / 稼働時間数）。
    const nonReservationWeight = visits.reduce((sum, v) => sum + (v.type === "reservation" ? 0 : v.weight ?? 1), 0);
    const weightedVisits = weightedVisitCount(visits);
    const repeatUsers = [...new Set(visits.map((v) => v.customerId))].filter((id) => visits.filter((v) => v.customerId === id).length >= 2).length;
    return { ...maid, visits: weightedVisits, users, revenue, workHours, perHour: workHours ? nonReservationWeight / workHours : 0, repeatRate: users ? repeatUsers / users : 0 };
  }).sort((a, b) => b.visits - a.visits);
}

export function customerRows(data: AnalyticsData) {
  return data.customers.map((customer) => {
    const visits = data.visits.filter((v) => v.customerId === customer.id).sort((a, b) => b.at.localeCompare(a.at));
    const favorite = data.maids.map((maid) => ({ name: maid.name, count: visits.filter((v) => v.maidId === maid.id).length })).sort((a, b) => b.count - a.count)[0];
    return {
      ...customer,
      visits: visits.length,
      spend: visits.reduce((sum, v) => sum + v.revenue + v.cheki * CHEKI_PRICE, 0),
      favoriteMaid: favorite?.count ? favorite.name : "—",
      lastVisit: visits[0]?.at.slice(0, 10) || "—",
    };
  }).sort((a, b) => b.visits - a.visits);
}
