import assert from "node:assert/strict";
import test from "node:test";
import { firstPaymentRate, freshMaidFreeRevisit, monthlyPaying, monthsBack, newUserFreeConversion, payingCohorts } from "../lib/growth-insights.ts";

const range = { start: "2026-11-01", end: "2026-11-30" };

test("14日以内の初回課金率: 14日を過ぎて課金した人は未転換、14日経っていない人は判定待ち", () => {
  const regs = [
    { id: "a", registeredAt: "2026-11-01T03:00:00Z" }, // 3日後に課金 → 転換
    { id: "b", registeredAt: "2026-11-01T03:00:00Z" }, // 20日後に課金 → 未転換
    { id: "c", registeredAt: "2026-11-02T03:00:00Z" }, // 課金なし・判定済み → 未転換
    { id: "d", registeredAt: "2026-11-20T03:00:00Z" }, // 判定待ち
    { id: "e", registeredAt: "2026-10-31T03:00:00Z" }, // 期間外
  ];
  const pays = [
    { customerId: "a", at: "2026-11-04T03:00:00Z", amount: 1000 },
    { customerId: "b", at: "2026-11-21T03:00:00Z", amount: 1000 },
  ];
  const r = firstPaymentRate(regs, pays, range, new Date("2026-11-25T00:00:00Z"));
  assert.deepEqual({ registrations: r.registrations, judged: r.judged, converted: r.converted, pending: r.pending }, { registrations: 4, judged: 3, converted: 1, pending: 1 });
  assert.equal(r.rate, 1 / 3);
});

test("新規ユーザー無料からの有料化: 無料利用より後の課金・有料ご帰宅だけを数える", () => {
  const visits = [
    { customerId: "a", maidId: "m1", at: "2026-11-07T11:00:00Z", type: "free" as const, entryType: "newUserFree" },
    { customerId: "a", maidId: "m2", at: "2026-11-09T11:00:00Z", type: "paid" as const },
    { customerId: "b", maidId: "m1", at: "2026-11-07T11:00:00Z", type: "free" as const, entryType: "newUserFree" },
    { customerId: "c", maidId: "m1", at: "2026-11-08T11:00:00Z", type: "free" as const, entryType: "newUserFree" },
  ];
  const pays = [
    { customerId: "b", at: "2026-11-01T00:00:00Z", amount: 500 }, // 無料利用より前 → 数えない
    { customerId: "c", at: "2026-11-10T00:00:00Z", amount: 500 }, // 後 → 有料化
  ];
  const r = newUserFreeConversion(visits, pays, range);
  assert.deepEqual({ total: r.total, converted: r.converted }, { total: 3, converted: 2 });
});

test("新人メイド無料からの有料再訪: 同じメイドへの有料ご帰宅だけを数える", () => {
  const visits = [
    { customerId: "a", maidId: "new", at: "2026-11-07T11:00:00Z", type: "free" as const, entryType: "freshMaidFree" },
    { customerId: "a", maidId: "other", at: "2026-11-08T11:00:00Z", type: "paid" as const },
    { customerId: "b", maidId: "new", at: "2026-11-07T11:00:00Z", type: "free" as const, entryType: "freshMaidFree" },
    { customerId: "b", maidId: "new", at: "2026-11-09T11:00:00Z", type: "paid" as const },
  ];
  const r = freshMaidFreeRevisit(visits, range);
  assert.deepEqual({ total: r.total, converted: r.converted }, { total: 2, converted: 1 });
});

test("月ごとの課金者数と1人あたり額、登録月コホート", () => {
  assert.deepEqual(monthsBack("2026-02", 3), ["2025-12", "2026-01", "2026-02"]);
  const pays = [
    { customerId: "a", at: "2026-10-05T03:00:00Z", amount: 3000 },
    { customerId: "a", at: "2026-10-20T03:00:00Z", amount: 1000 },
    { customerId: "b", at: "2026-10-31T16:00:00Z", amount: 999 }, // JSTでは11/1
  ];
  const m = monthlyPaying(pays, [{ month: "2026-10", usingUsers: 4, usage: 10000 }], ["2026-10", "2026-11"]);
  assert.deepEqual(m[0], { month: "2026-10", payingUsers: 1, paymentAmount: 4000, arppu: 4000, usingUsers: 4, usage: 10000, usagePerUser: 2500 });
  assert.equal(m[1].payingUsers, 1);
  const regs = [{ id: "a", registeredAt: "2026-10-01T03:00:00Z" }, { id: "c", registeredAt: "2026-10-02T03:00:00Z" }];
  const cohorts = payingCohorts(regs, pays, ["2026-10"], "2026-11");
  assert.equal(cohorts[0].size, 2);
  assert.equal(cohorts[0].rates[0], 0.5); // 10月に a が課金
  assert.equal(cohorts[0].rates[1], 0); // 11月は誰も課金していない（b は対象外）
  assert.equal(cohorts[0].rates[2], null); // まだ来ていない月
});
