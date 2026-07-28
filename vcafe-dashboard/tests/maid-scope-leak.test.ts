import assert from "node:assert/strict";
import test from "node:test";
import { scopeDataForViewer } from "../lib/analytics.ts";
import type { AnalyticsData, Customer, Viewer } from "../lib/types.ts";

// 指摘2の再現テスト。maid のレスポンスに顧客の準識別子・財務列が残ってはいけない。
// segment-001 への置換は表示名の匿名化にすぎず、性別・生年・ランク・残高・課金額の
// 組み合わせから個人が再識別され得る。

const maid: Viewer = { uid: "u1", name: "こはる", role: "maid", maidId: "maid-01" };

const customer: Customer = {
  id: "hmac-abc", name: "あおい", rank: "プラチナ", registeredAt: "2024-02-12T00:00:00Z",
  gender: "female", birthYear: 1988, active: true,
  lastVisitAt: "2026-07-14T00:00:00Z", lastPaymentAt: "2026-07-02T00:00:00Z",
  lastPurchasedItemAt: "2026-07-01T00:00:00Z", lastPresentAt: "2026-06-30T00:00:00Z",
  purchasedItemCoin: 1500, purchasedItemRewardPoint: 20, purchasedItemQuantity: 5,
  presentAmount: 3, coin: 2500, rewardPoint: 310,
  totalVisitAmount: 1374, consecutiveVisitDays: 2, maxConsecutiveVisitDays: 9,
};

const data: AnalyticsData = {
  generatedAt: "2026-07-28T00:00:00Z",
  maids: [{ id: "maid-01", name: "こはる", avatar: "こ", status: "active" }],
  customers: [customer],
  visits: [{
    id: "v1", at: "2026-07-21T11:00:00Z", maidId: "maid-01", customerId: "hmac-abc",
    type: "paid", revenue: 840, cheki: 0, weight: 1,
  }],
  shifts: [],
};

// 漏れてはいけない列。準識別子（再識別に使える）と財務情報。
const FORBIDDEN = [
  "gender", "birthYear", "rank", "active",
  "coin", "rewardPoint",
  "paymentCount", "paymentAmount", "lastPaymentAt",
  "purchasedItemCoin", "purchasedItemRewardPoint", "purchasedItemQuantity", "lastPurchasedItemAt",
  "presentAmount", "lastPresentAt",
  "totalVisitAmount", "consecutiveVisitDays", "maxConsecutiveVisitDays",
  "lastVisitAt",
] as const;

test("maid レスポンスに顧客の準識別子・財務列が含まれない", () => {
  const scoped = scopeDataForViewer(data, maid);
  assert.equal(scoped.customers.length, 1);
  const row = scoped.customers[0] as unknown as Record<string, unknown>;
  const leaked = FORBIDDEN.filter((key) => key in row);
  assert.deepEqual(leaked, [], `maidへ漏れている列: ${leaked.join(", ")}`);
});

test("maid レスポンスの顧客IDは元のHMAC IDではない", () => {
  const scoped = scopeDataForViewer(data, maid);
  assert.notEqual(scoped.customers[0].id, "hmac-abc");
  assert.match(scoped.customers[0].id, /^segment-\d{3}$/);
  assert.equal(scoped.visits[0].customerId, scoped.customers[0].id);
  // 名前も出さない
  assert.equal(scoped.customers[0].name, "非表示");
});

test("admin レスポンスは従来どおり全列を保持する", () => {
  const admin: Viewer = { uid: "a1", name: "運営", role: "admin" };
  const scoped = scopeDataForViewer(data, admin);
  assert.equal(scoped.customers[0].id, "hmac-abc");
  assert.equal(scoped.customers[0].gender, "female");
  assert.equal(scoped.customers[0].paymentAmount ?? null, null); // 元データに無い列は増やさない
  assert.equal(scoped.customers[0].coin, 2500);
});
