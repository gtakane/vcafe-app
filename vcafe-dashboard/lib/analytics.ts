import type { AnalyticsData, Granularity, Role, Viewer, Visit } from "./types";

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
  const revenue = data.visits.reduce((sum, v) => sum + v.revenue + v.cheki * 500, 0);
  const customerCount = new Set(data.visits.map((v) => v.customerId)).size;
  const paid = data.visits.filter((v) => v.type === "paid" || v.type === "reservation").length;
  const cheki = data.visits.reduce((sum, v) => sum + v.cheki, 0);
  const workMinutes = data.shifts.reduce((sum, s) => {
    if (!s.actualStart || !s.actualEnd) return sum;
    return sum + Math.max(0, new Date(s.actualEnd).getTime() - new Date(s.actualStart).getTime()) / 60000;
  }, 0);
  const lateMinutes = data.shifts.reduce((sum, s) => {
    if (!s.actualStart) return sum;
    return sum + Math.max(0, new Date(s.actualStart).getTime() - new Date(s.scheduledStart).getTime()) / 60000;
  }, 0);
  return { visits: data.visits.length, revenue, customerCount, paid, cheki, workHours: workMinutes / 60, lateMinutes };
}

function bucketKey(at: string, granularity: Granularity) {
  const date = new Date(at);
  const local = new Date(date.getTime() + 9 * 3600000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  if (granularity === "hour") return `${m}/${d} ${String(local.getUTCHours()).padStart(2, "0")}:00`;
  if (granularity === "month") return `${y}/${m}`;
  if (granularity === "week") {
    const monday = new Date(Date.UTC(y, local.getUTCMonth(), local.getUTCDate()));
    const offset = (monday.getUTCDay() + 6) % 7;
    monday.setUTCDate(monday.getUTCDate() - offset);
    return `${String(monday.getUTCMonth() + 1).padStart(2, "0")}/${String(monday.getUTCDate()).padStart(2, "0")}週`;
  }
  return `${m}/${d}`;
}

export function buildTrend(visits: Visit[], granularity: Granularity) {
  const map = new Map<string, { label: string; visits: number; revenue: number }>();
  visits.forEach((visit) => {
    const label = bucketKey(visit.at, granularity);
    const current = map.get(label) || { label, visits: 0, revenue: 0 };
    current.visits += 1;
    current.revenue += visit.revenue + visit.cheki * 500;
    map.set(label, current);
  });
  return [...map.values()];
}

export function maidRows(data: AnalyticsData) {
  return data.maids.map((maid) => {
    const visits = data.visits.filter((v) => v.maidId === maid.id);
    const shifts = data.shifts.filter((s) => s.maidId === maid.id);
    const users = new Set(visits.map((v) => v.customerId)).size;
    const revenue = visits.reduce((sum, v) => sum + v.revenue + v.cheki * 500, 0);
    const workHours = shifts.reduce((sum, s) => !s.actualStart || !s.actualEnd ? sum : sum + (new Date(s.actualEnd).getTime() - new Date(s.actualStart).getTime()) / 3600000, 0);
    const repeatUsers = [...new Set(visits.map((v) => v.customerId))].filter((id) => visits.filter((v) => v.customerId === id).length >= 2).length;
    return { ...maid, visits: visits.length, users, revenue, workHours, perHour: workHours ? visits.length / workHours : 0, repeatRate: users ? repeatUsers / users : 0 };
  }).sort((a, b) => b.visits - a.visits);
}

export function customerRows(data: AnalyticsData) {
  return data.customers.map((customer) => {
    const visits = data.visits.filter((v) => v.customerId === customer.id).sort((a, b) => b.at.localeCompare(a.at));
    const favorite = data.maids.map((maid) => ({ name: maid.name, count: visits.filter((v) => v.maidId === maid.id).length })).sort((a, b) => b.count - a.count)[0];
    return {
      ...customer,
      visits: visits.length,
      spend: visits.reduce((sum, v) => sum + v.revenue + v.cheki * 500, 0),
      favoriteMaid: favorite?.count ? favorite.name : "—",
      lastVisit: visits[0]?.at.slice(0, 10) || "—",
    };
  }).sort((a, b) => b.visits - a.visits);
}
