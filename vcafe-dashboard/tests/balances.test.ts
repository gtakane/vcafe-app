import assert from "node:assert/strict";
import test from "node:test";
import { computeBalances, monthEndSnapshot, purchaseYen, valueSnapshot, type BalanceSnapshot } from "../lib/balances.ts";

const snap = (snapshotAt: string, extra: Partial<BalanceSnapshot> = {}): BalanceSnapshot => ({
  snapshotAt, source: "sync", appleCoin: 0, googleCoin: 0, legacyCoin: 0, rewardPoint: 0,
  ticketGokitaku: 0, ticketPremium: 0, ticketRandom: 0, ticketCheki: 0, ticketChekiFree: 0, ...extra,
});

test("経理の10/31時点の残高（11/1の書き出し）を同じ単価で再現できる", () => {
  // 経理資料: Apple 453,943 / Google 234,680 / 未使用チケット（正しい枚数計算）+ 未使用コイン 1,381,379
  const v = valueSnapshot(snap("2026-10-31T20:00:00Z", {
    appleCoin: 381465, googleCoin: 197210, rewardPoint: 1255799,
    ticketGokitaku: 455, ticketCheki: 553, ticketPremium: 138, ticketRandom: 64, ticketChekiFree: 86,
  }));
  assert.equal(v.apple, 453943);
  assert.equal(v.google, 234680);
  // チケットは枚数×単価（経理シートのプレミアム・ランダムは1行960円・650円固定の不具合があるため、そちらとは一致しない）
  assert.equal(v.stripe, 1381379 + 455 * 850 + 553 * 500 + 138 * 960 + 64 * 650);
});

test("月末の残高は翌月1日 2:00 以降の最初の記録。無ければ3日までの記録で代用", () => {
  const list = [snap("2026-10-31T16:30:00Z"), snap("2026-10-31T20:00:00Z"), snap("2026-11-01T20:00:00Z")];
  // 2026-10-31T16:30Z = JST 11/1 1:30（営業時間内）→ 使わない。20:00Z = JST 11/1 5:00 → 使う
  assert.equal(monthEndSnapshot(list, "2026-10")?.snapshot.snapshotAt, "2026-10-31T20:00:00Z");
  assert.equal(monthEndSnapshot(list, "2026-10")?.exact, true);
  assert.equal(monthEndSnapshot([snap("2026-11-02T20:00:00Z")], "2026-10")?.exact, false);
  assert.equal(monthEndSnapshot([snap("2026-11-05T20:00:00Z")], "2026-10"), null);
});

test("確定売上 = 購入額（Apple/Googleは手数料15%控除）＋前月末残高−当月末残高", () => {
  assert.deepEqual(purchaseYen({ month: "2026-11", apple: 10000, google: 2000, stripe: 30000, inappUnknown: 0 }), { apple: 8500, google: 1700, stripe: 30000, total: 40200 });
  const snapshots = [
    snap("2026-10-31T20:00:00Z", { appleCoin: 1000, rewardPoint: 10000, ticketGokitaku: 2 }), // 11月の期首
    snap("2026-11-30T20:00:00Z", { appleCoin: 400, rewardPoint: 6000, ticketGokitaku: 1 }), // 11月の期末
  ];
  const result = computeBalances(snapshots, [{ month: "2026-11", apple: 1000, google: 0, stripe: 2000, inappUnknown: 0 }], ["2026-10", "2026-11"], new Date("2026-12-02T00:00:00Z"));
  const nov = result.months.find((m) => m.month === "2026-11")!;
  assert.equal(nov.status, "provisional"); // 購入額が課金台帳からの推定のため
  assert.equal(nov.revenue?.apple, 850 + 1190 - 476);
  assert.equal(nov.revenue?.stripe, 2000 + (11000 + 1700) - (6600 + 850));
  assert.equal(result.months.find((m) => m.month === "2026-10")!.status, "missing"); // 10/1の記録が無い
  assert.equal(result.monthEnds.length, 2);
});

test("当月は最新の記録で暫定値を出す", () => {
  const snapshots = [snap("2026-10-31T20:00:00Z", { rewardPoint: 1000 }), snap("2026-11-11T20:00:00Z", { rewardPoint: 400 })];
  const result = computeBalances(snapshots, [], ["2026-11"], new Date("2026-11-12T03:00:00Z"));
  assert.equal(result.months[0].status, "provisional");
  assert.equal(result.months[0].revenue?.stripe, 1100 - 440);
});

test("Appleの会計月は暦月とずれる（2026年10月 = 9/27〜10/31、11月 = 11/1〜11/28）", async () => {
  const { appleFiscalMonthRange, monthlyFromDaily } = await import("../lib/balances.ts");
  assert.deepEqual(appleFiscalMonthRange("2026-10"), { start: "2026-09-27", end: "2026-10-31" });
  assert.deepEqual(appleFiscalMonthRange("2026-11"), { start: "2026-11-01", end: "2026-11-28" });
  assert.deepEqual(appleFiscalMonthRange("2026-12"), { start: "2026-11-29", end: "2026-12-26" });
  const daily = [
    { day: "2026-09-28", apple: 100, google: 10, stripe: 1000, inappUnknown: 0 }, // Appleは10月、Google/Stripeは9月
    { day: "2026-10-15", apple: 200, google: 20, stripe: 2000, inappUnknown: 0 },
    { day: "2026-11-29", apple: 400, google: 40, stripe: 4000, inappUnknown: 0 }, // Appleは12月、Google/Stripeは11月
  ];
  const [oct, nov] = monthlyFromDaily(daily, ["2026-10", "2026-11"]);
  assert.deepEqual([oct.apple, oct.google, oct.stripe], [300, 20, 2000]);
  assert.deepEqual([nov.apple, nov.google, nov.stripe], [0, 40, 4000]);
});

test("各社の報告値が登録された月は、課金台帳の推定ではなく報告値を購入額に使う", () => {
  assert.deepEqual(purchaseYen({ month: "2026-11", apple: 999999, google: 999999, stripe: 999999, inappUnknown: 0, reported: { apple: 673183, google: 188615, stripe: 2605010 } }),
    { apple: 673183, google: 188615, stripe: 2605010, total: 3466808 });
});

test("前月は、購入額を各社の報告値で登録したときだけ確定にする", () => {
  const snapshots = [snap("2026-10-31T20:00:00Z", { rewardPoint: 1000 }), snap("2026-11-30T20:00:00Z", { rewardPoint: 400 })];
  const reported = { month: "2026-11", apple: 1000, google: 0, stripe: 2000, inappUnknown: 0, reported: { apple: 900, google: 0, stripe: 2000 } };
  const result = computeBalances(snapshots, [reported], ["2026-11"], new Date("2026-12-02T00:00:00Z"));
  assert.equal(result.months[0].status, "confirmed");
  assert.equal(result.months[0].revenue?.apple, 900);
  assert.ok(result.months[0].note.includes("各社の報告値"));
});
