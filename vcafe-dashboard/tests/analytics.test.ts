import assert from "node:assert/strict";
import test from "node:test";
import { buildTrend, enforceMaidScope, filterData, scopeDataForViewer, summarize } from "../lib/analytics.ts";
import { mockAnalyticsData } from "../lib/mock-data.ts";

test("maid role cannot request another maid's data", () => {
  const scoped = enforceMaidScope({ uid: "x", name: "こはる", role: "maid", maidId: "maid-01" }, "maid-02");
  assert.equal(scoped, "maid-01");
});

test("filtered maid data contains only the authenticated maid", () => {
  const result = filterData(mockAnalyticsData, { uid: "x", name: "こはる", role: "maid", maidId: "maid-01" }, { start: "2026-07-01", end: "2026-07-21", granularity: "day", maidId: "maid-04" });
  assert.deepEqual(new Set(result.visits.map((v) => v.maidId)), new Set(["maid-01"]));
  assert.deepEqual(result.maids.map((m) => m.id), ["maid-01"]);
});

test("maid payload is scoped and customer identities are removed before reaching the browser", () => {
  const result = scopeDataForViewer(mockAnalyticsData, { uid: "x", name: "こはる", role: "maid", maidId: "maid-01" });
  assert.ok(result.visits.every((visit) => visit.maidId === "maid-01"));
  assert.ok(result.customers.every((customer) => customer.name === "非表示" && customer.id.startsWith("segment-")));
  assert.ok(result.visits.every((visit) => visit.customerId.startsWith("segment-")));
});

test("summary revenue includes cheki", () => {
  const totals = summarize({ ...mockAnalyticsData, visits: [{ id: "v", at: "2026-07-01T10:00:00Z", maidId: "maid-01", customerId: "usr-001", type: "paid", revenue: 840, cheki: 1, weight: 1 }], shifts: [] });
  assert.equal(totals.revenue, 1340);
});

test("summary ご帰宅数/有料数: 通常は滞在時間÷20分、予約・お試しは1件", () => {
  const totals = summarize({
    ...mockAnalyticsData,
    visits: [
      { id: "a", at: "2026-07-01T12:00:00Z", maidId: "maid-01", customerId: "usr-001", type: "paid", revenue: 840, cheki: 0, weight: 2 },
      { id: "b", at: "2026-07-01T12:30:00Z", maidId: "maid-01", customerId: "usr-002", type: "trial", revenue: 0, cheki: 0, weight: 1 },
      { id: "c", at: "2026-07-01T13:00:00Z", maidId: "maid-02", customerId: "usr-003", type: "reservation", revenue: 3920, cheki: 0, weight: 1 },
    ],
    shifts: [],
  });
  assert.equal(totals.visits, 4); // 通常（重み2＝40分）2 + お試し1 + 予約1
  assert.equal(totals.paid, 3); // 通常2 + 予約1、お試しは除外
  assert.deepEqual(totals.visitBreakdown, { normal: 2, normalVisits: 1, reservation: 1, trial: 1, free: 0, total: 4 });
  assert.equal(totals.revenue, 4760); // 840 + 0 + 3920
});

test("work hours fall back to the schedule when punches are missing (fillna)", () => {
  const totals = summarize({
    ...mockAnalyticsData,
    visits: [],
    shifts: [
      { id: "s1", maidId: "maid-01", scheduledStart: "2026-07-21T10:00:00Z", scheduledEnd: "2026-07-21T14:30:00Z", actualStart: null, actualEnd: null },
    ],
  });
  assert.equal(Number(totals.workHours.toFixed(2)), 4.5); // 未打刻でも予定4.5hを計上
  assert.equal(totals.lateMinutes, 0);
});

test("売上は予約・招待を予約日に計上し、キャンセル分と無料チェキを含めない", () => {
  const visits = [
    { id: "a", at: "2026-10-01T12:00:00Z", maidId: "maid-01", customerId: "usr-001", type: "paid" as const, revenue: 1190, cheki: 2, freeCheki: 1, weight: 1, ticketId: "ATCOIN", billedCoin: 1000, billedCoinVendor: "apple", billedRewardPoint: 0 },
    { id: "b", at: "2026-10-01T13:00:00Z", maidId: "maid-01", customerId: "usr-002", type: "reservation" as const, revenue: 0, cheki: 0, weight: 1, ticketId: "ATCOIN", billedCoin: 0, billedRewardPoint: 0 },
  ];
  const bookings = [
    { id: "r1", kind: "reservation" as const, at: "2026-10-01T03:00:00Z", maidId: "maid-01", customerId: "usr-002", coin: 0, coinVendor: null, rewardPoint: 2800, canceled: false, revenue: 3080 },
    { id: "r2", kind: "reservation" as const, at: "2026-10-01T04:00:00Z", maidId: "maid-01", customerId: "usr-002", coin: 2800, coinVendor: "google", rewardPoint: 0, canceled: true, revenue: 0 },
  ];
  const totals = summarize({ ...mockAnalyticsData, visits, shifts: [], bookings });
  assert.equal(totals.revenue, 1190 + 500 + 3080); // 有料チェキ1枚のみ
  assert.equal(totals.revenueParts.apple, 1190);
  assert.equal(totals.revenueParts.rewardPoint, 3080);
  assert.equal(totals.revenueParts.cheki, 500);
  assert.equal(totals.revenueParts.bookings, 3080);
  assert.equal(totals.revenueParts.google, 0); // キャンセル分は含めない
  assert.equal(totals.revenueParts.other, 0);
  const trend = buildTrend(visits, "day", bookings);
  assert.equal(trend.reduce((sum, p) => sum + p.revenue, 0), totals.revenue);
});

test("メイド画面には自分宛ての予約だけを渡し、顧客IDは別名に置き換える", () => {
  const data = {
    ...mockAnalyticsData,
    visits: [{ id: "a", at: "2026-10-01T12:00:00Z", maidId: "maid-01", customerId: "usr-001", type: "paid" as const, revenue: 850, cheki: 0, weight: 1 }],
    shifts: [],
    bookings: [
      { id: "r1", kind: "reservation" as const, at: "2026-10-01T03:00:00Z", maidId: "maid-01", customerId: "usr-001", coin: 0, coinVendor: null, rewardPoint: 100, canceled: false, revenue: 110 },
      { id: "r2", kind: "reservation" as const, at: "2026-10-01T03:00:00Z", maidId: "maid-01", customerId: "usr-999", coin: 0, coinVendor: null, rewardPoint: 100, canceled: false, revenue: 110 },
      { id: "r3", kind: "reservation" as const, at: "2026-10-01T03:00:00Z", maidId: "maid-02", customerId: "usr-001", coin: 0, coinVendor: null, rewardPoint: 100, canceled: false, revenue: 110 },
    ],
  };
  const scoped = scopeDataForViewer(data, { uid: "m", name: "m", role: "maid", maidId: "maid-01" });
  assert.deepEqual(scoped.bookings?.map((b) => b.id), ["r1", "r2"]);
  assert.ok(scoped.bookings?.every((b) => !b.customerId.startsWith("usr-")), "元の顧客IDが漏れている");
});
