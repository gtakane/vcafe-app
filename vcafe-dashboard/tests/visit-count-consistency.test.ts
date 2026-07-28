import assert from "node:assert/strict";
import test from "node:test";
import { crossVisitCounts, customerRows, maidRows, summarize } from "../lib/analytics.ts";
import { weightedVisitCount } from "../lib/metrics.ts";
import type { AnalyticsData } from "../lib/types.ts";

// 指摘9の再現テスト。
// 「ご帰宅数」は滞在20分=1枠の重み付き件数（core.py の visitWeight 合計）。
// 旧実装は概要・メイド別が重み付きなのに対し、ユーザー別は visits.length、
// クロス表は +1 で数えており、同じ名前の指標が経路によって別の値になっていた。

// 同一 fixture: 1人のユーザーが1人のメイドに 20分×1回 + 40分×1回 = 重み3。
const data: AnalyticsData = {
  generatedAt: "2026-07-28T00:00:00Z",
  maids: [{ id: "maid-01", name: "こはる", avatar: "こ", status: "active" }],
  customers: [{ id: "usr-1", name: "あおい", rank: "ゴールド", registeredAt: "2024-01-01T00:00:00Z" }],
  visits: [
    { id: "v1", at: "2026-07-21T11:00:00Z", maidId: "maid-01", customerId: "usr-1", type: "paid", revenue: 840, cheki: 0, weight: 1, minutes: 20 },
    { id: "v2", at: "2026-07-21T13:00:00Z", maidId: "maid-01", customerId: "usr-1", type: "paid", revenue: 1680, cheki: 0, weight: 2, minutes: 40 },
  ],
  shifts: [],
};

const EXPECTED_WEIGHTED = 3; // 1 + 2
const EXPECTED_SESSIONS = 2; // 生の来店回数

test("ご帰宅数は4経路すべてで重み合計に一致する", () => {
  const overview = summarize(data).visits;
  const maid = maidRows(data)[0].visits;
  const customer = customerRows(data)[0].visits;
  const cross = crossVisitCounts(data.visits).get("usr-1|maid-01");

  assert.equal(overview, EXPECTED_WEIGHTED, "概要");
  assert.equal(maid, EXPECTED_WEIGHTED, "メイド別");
  assert.equal(customer, EXPECTED_WEIGHTED, "ユーザー別");
  assert.equal(cross, EXPECTED_WEIGHTED, "クロス表");

  // 4経路が互いに一致すること（将来どれか1つだけ変わっても検出する）
  assert.deepEqual(new Set([overview, maid, customer, cross]).size, 1);
});

test("生の来店回数は「来店セッション数」として別名で提供する", () => {
  const row = customerRows(data)[0];
  assert.equal(row.sessions, EXPECTED_SESSIONS);
  assert.notEqual(row.sessions, row.visits, "重み付きと生回数は別の値であるべき");
});

test("重み未設定の行は1として扱う（旧データ互換）", () => {
  const legacy: AnalyticsData = {
    ...data,
    visits: [{ id: "v0", at: "2026-07-21T11:00:00Z", maidId: "maid-01", customerId: "usr-1", type: "paid", revenue: 840, cheki: 0 } as AnalyticsData["visits"][number]],
  };
  assert.equal(weightedVisitCount(legacy.visits), 1);
  assert.equal(summarize(legacy).visits, 1);
  assert.equal(customerRows(legacy)[0].visits, 1);
  assert.equal(crossVisitCounts(legacy.visits).get("usr-1|maid-01"), 1);
});

test("クロス表は customerId|maidId ごとに重みを合算する", () => {
  const multi: AnalyticsData = {
    ...data,
    maids: [...data.maids, { id: "maid-02", name: "みるく", avatar: "み", status: "active" }],
    visits: [
      ...data.visits,
      { id: "v3", at: "2026-07-22T11:00:00Z", maidId: "maid-02", customerId: "usr-1", type: "paid", revenue: 840, cheki: 0, weight: 1, minutes: 20 },
    ],
  };
  const counts = crossVisitCounts(multi.visits);
  assert.equal(counts.get("usr-1|maid-01"), 3);
  assert.equal(counts.get("usr-1|maid-02"), 1);
  // 合計は概要と一致する
  assert.equal([...counts.values()].reduce((a, b) => a + b, 0), summarize(multi).visits);
});
