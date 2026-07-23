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
  const totals = summarize({ ...mockAnalyticsData, visits: [{ id: "v", at: "2026-07-01T10:00:00Z", maidId: "maid-01", customerId: "usr-001", type: "paid", revenue: 840, cheki: 1 }], shifts: [] });
  assert.equal(totals.revenue, 1340);
});
