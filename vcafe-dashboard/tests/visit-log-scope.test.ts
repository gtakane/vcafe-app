import assert from "node:assert/strict";
import test from "node:test";
import { buildScopedVisitLogs } from "../lib/maid-visits.ts";
import type { AnalyticsData, PresentLike, Viewer } from "../lib/types.ts";

// 指摘3の再現テスト。
// 旧実装は「訪問の customerId を segment-00N へ置換してから」プレゼントを結合していたため、
// BigQuery が返す HMAC customerId と一致せず、maid 経路のアイテム使用が常に0件になっていた。
// 正しくは「元のHMAC IDでサーバー内結合してから、完成したログを匿名化する」。

const maid: Viewer = { uid: "u1", name: "こはる", role: "maid", maidId: "maid-01" };
const admin: Viewer = { uid: "a1", name: "運営", role: "admin" };

const data: AnalyticsData = {
  generatedAt: "2026-07-28T00:00:00Z",
  maids: [{ id: "maid-01", name: "こはる", avatar: "こ", status: "active" }],
  customers: [{ id: "hmac-abc", name: "あおい", rank: "プラチナ", registeredAt: "2024-02-12T00:00:00Z" }],
  visits: [{
    id: "v1", at: "2026-07-21T11:00:00Z", maidId: "maid-01", customerId: "hmac-abc",
    type: "paid", revenue: 840, cheki: 0, weight: 1, ticketId: "ATCOIN", minutes: 20,
    billedCoin: 600, billedRewardPoint: 0,
  }],
  shifts: [],
};

// BigQuery が返すのは元のHMAC ID。ここが結合キー。
const presents: PresentLike[] = [
  { customerId: "hmac-abc", maidId: "maid-01", at: "2026-07-21T12:00:00Z", itemName: "花束", quantity: 1 },
];

test("maid経路でもプレゼントが結合される（HMAC IDで結合してから匿名化する）", async () => {
  const logs = await buildScopedVisitLogs(data, { maidId: "maid-01", start: "2026-07-21", end: "2026-07-21" }, maid, presents);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].presents, 1, "maidにアイテム使用が0件として見えてはいけない");
  assert.equal(logs[0].presentNames, "花束");
});

test("maidへ返すログにHMAC IDと実名を含めない", async () => {
  const logs = await buildScopedVisitLogs(data, { maidId: "maid-01", start: "2026-07-21", end: "2026-07-21" }, maid, presents);
  assert.match(logs[0].customerId, /^segment-\d{3}$/);
  assert.notEqual(logs[0].customerId, "hmac-abc");
  assert.equal(logs[0].customerName, "非表示");
  // シリアライズ後の文字列にも元IDが残らないこと
  assert.ok(!JSON.stringify(logs).includes("hmac-abc"));
  assert.ok(!JSON.stringify(logs).includes("あおい"));
});

test("admin経路は実IDと実名を保持する", async () => {
  const logs = await buildScopedVisitLogs(data, { maidId: "maid-01", start: "2026-07-21", end: "2026-07-21" }, admin, presents);
  assert.equal(logs[0].customerId, "hmac-abc");
  assert.equal(logs[0].customerName, "あおい");
  assert.equal(logs[0].presents, 1);
});

test("同一営業日に複数訪問があってもプレゼントを二重計上しない", async () => {
  const twice: AnalyticsData = {
    ...data,
    visits: [
      data.visits[0],
      { ...data.visits[0], id: "v2", at: "2026-07-21T13:00:00Z" },
    ],
  };
  const logs = await buildScopedVisitLogs(twice, { maidId: "maid-01", start: "2026-07-21", end: "2026-07-21" }, maid, presents);
  assert.equal(logs.length, 2);
  assert.equal(logs.reduce((sum, l) => sum + l.presents, 0), 1, "同じ営業日のプレゼントは1回だけ計上する");
});

test("JST 00:00〜01:59 のご帰宅は前営業日のプレゼントと結合される", async () => {
  // JST 7/22 01:00 = UTC 7/21 16:00。営業日は 7/21。
  const lateNight: AnalyticsData = {
    ...data,
    visits: [{ ...data.visits[0], id: "v3", at: "2026-07-21T16:00:00Z" }],
  };
  const logs = await buildScopedVisitLogs(lateNight, { maidId: "maid-01", start: "2026-07-21", end: "2026-07-22" }, maid, presents);
  assert.equal(logs[0].presents, 1, "深夜1時のご帰宅は前営業日として結合されるべき");
});

test("JST 02:00 のご帰宅は翌営業日となり前日のプレゼントと結合しない", async () => {
  // JST 7/22 02:00 = UTC 7/21 17:00。営業日は 7/22。
  const nextDay: AnalyticsData = {
    ...data,
    visits: [{ ...data.visits[0], id: "v4", at: "2026-07-21T17:00:00Z" }],
  };
  const logs = await buildScopedVisitLogs(nextDay, { maidId: "maid-01", start: "2026-07-21", end: "2026-07-22" }, maid, presents);
  assert.equal(logs[0].presents, 0);
});
