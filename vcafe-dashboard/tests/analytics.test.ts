import assert from "node:assert/strict";
import test from "node:test";
import { enforceMaidScope, filterData, scopeDataForViewer, summarize } from "../lib/analytics.ts";
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

test("summary ご帰宅数/有料数 are weighted by visit weight (core.py と一致)", () => {
  const totals = summarize({
    ...mockAnalyticsData,
    visits: [
      { id: "a", at: "2026-07-01T12:00:00Z", maidId: "maid-01", customerId: "usr-001", type: "paid", revenue: 840, cheki: 0, weight: 2 },
      { id: "b", at: "2026-07-01T12:30:00Z", maidId: "maid-01", customerId: "usr-002", type: "trial", revenue: 0, cheki: 0, weight: 1 },
      { id: "c", at: "2026-07-01T13:00:00Z", maidId: "maid-02", customerId: "usr-003", type: "reservation", revenue: 3920, cheki: 0, weight: 1 },
    ],
    shifts: [],
  });
  assert.equal(totals.visits, 4); // 2 + 1 + 1（重み付きご帰宅数）
  assert.equal(totals.paid, 3); // paid2 + reservation1、trialは除外
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
