import assert from "node:assert/strict";
import test from "node:test";
import { buildMaidVisitLogs, mergedStayMinutes, paymentLabel, ticketLabel, typeLabel } from "../lib/maid-visits.ts";
import type { Visit } from "../lib/types.ts";

const maids = [{ id: "maid-01", name: "こはる" }];
const customers = [{ id: "usr-001", name: "あおい" }];

const visit = (over: Partial<Visit> = {}): Visit => ({
  id: "v1", at: "2026-07-27T11:00:00Z", maidId: "maid-01", customerId: "usr-001",
  type: "paid", revenue: 840, cheki: 0, weight: 1,
  ticketId: "ATCOIN", minutes: 30, billedCoin: 600, billedRewardPoint: 0, ...over,
});

test("paymentLabel: 支払い手段を判定する", () => {
  assert.equal(paymentLabel("paid", "ATCOIN", 600, 0), "あっとコイン");
  assert.equal(paymentLabel("paid", "ATCOIN", 0, 500), "リワードポイント");
  assert.equal(paymentLabel("paid", "ATCOIN", 300, 200), "あっとコイン+リワードP");
  assert.equal(paymentLabel("paid", "gokitaku30minutes", 0, 0), "チケット");
  assert.equal(paymentLabel("trial", "trial10minutes", 0, 0), "無料(お試し)");
  assert.equal(paymentLabel("reservation", "ATCOIN", 0, 0), "予約");
});

test("ticketLabel/typeLabel: 日本語表示に変換する", () => {
  assert.equal(ticketLabel("ATCOIN"), "あっとコイン");
  assert.equal(ticketLabel("gokitaku30minutes"), "ご帰宅30分チケット");
  assert.equal(ticketLabel("unknownTicket"), "unknownTicket"); // 未知IDはそのまま
  assert.equal(typeLabel("reservation"), "予約");
  assert.equal(typeLabel("trial"), "お試し");
});

test("buildMaidVisitLogs: 明細に滞在時間・チケット・支払い・ユーザー名が入る", () => {
  const [log] = buildMaidVisitLogs([visit()], maids, customers, []);
  assert.equal(log.customerName, "あおい");
  assert.equal(log.maidName, "こはる");
  assert.equal(log.minutes, 30);
  assert.equal(log.ticketLabel, "あっとコイン");
  assert.equal(log.payment, "あっとコイン");
  assert.equal(log.billedCoin, 600);
  assert.equal(log.presents, 0);
});

test("buildMaidVisitLogs: 新しい順に並ぶ", () => {
  const logs = buildMaidVisitLogs([
    visit({ id: "old", at: "2026-07-20T11:00:00Z" }),
    visit({ id: "new", at: "2026-07-27T11:00:00Z" }),
  ], maids, customers, []);
  assert.deepEqual(logs.map((l) => l.id), ["new", "old"]);
});

test("buildMaidVisitLogs: 同じ営業日のプレゼントを紐づけ、複数ご帰宅でも二重計上しない", () => {
  const presents = [{ customerId: "usr-001", maidId: "maid-01", at: "2026-07-27T13:00:00Z", itemName: "ブレスレット", quantity: 2 }];
  const logs = buildMaidVisitLogs([
    visit({ id: "a", at: "2026-07-27T11:00:00Z" }),
    visit({ id: "b", at: "2026-07-27T14:00:00Z" }),
  ], maids, customers, presents);
  const total = logs.reduce((sum, log) => sum + log.presents, 0);
  assert.equal(total, 2); // 2件のご帰宅があっても合計は2（重複計上しない）
  assert.equal(logs.filter((l) => l.presents > 0).length, 1);
  assert.equal(logs.find((l) => l.presents > 0)!.presentNames, "ブレスレット");
});

test("buildMaidVisitLogs: 深夜1時のご帰宅は前営業日のプレゼントと紐づく", () => {
  // 07/28 01:00 JST = 営業日 07/27
  const at = new Date("2026-07-28T01:00:00+09:00").toISOString();
  const presents = [{ customerId: "usr-001", maidId: "maid-01", at, itemName: "花束", quantity: 1 }];
  const [log] = buildMaidVisitLogs([visit({ at })], maids, customers, presents);
  assert.equal(log.presents, 1);
});

test("buildMaidVisitLogs: 明細列が未同期の古い行でも既定値で表示できる", () => {
  const legacy = { id: "v0", at: "2025-05-01T11:00:00Z", maidId: "maid-01", customerId: "usr-001", type: "paid", revenue: 840, cheki: 0, weight: 1 } as Visit;
  const [log] = buildMaidVisitLogs([legacy], maids, customers, []);
  assert.equal(log.minutes, 20); // DEFAULT_INITIAL_TIME
  assert.equal(log.ticketLabel, "—");
  assert.equal(log.billedCoin, 0);
});

test("buildMaidVisitLogs: 小数の滞在分は整数へ丸める（9.776 が 9,776 に見える誤読を防ぐ）", () => {
  // リワードポイント払いでは initialTime に実測の小数分が入ることがある（本番実例: 9.775766…）。
  const [log] = buildMaidVisitLogs([visit({ minutes: 9.775766666666666, billedCoin: 0, billedRewardPoint: 310 })], maids, customers, []);
  assert.equal(log.minutes, 10);
  assert.equal(log.payment, "リワードポイント");
});

test("mergedStayMinutes: 同時間帯の重なりを除いた実接客時間を返す", () => {
  // 3名が同じ20分に同席 → 延べ60分だが実時間は20分。
  const same = [
    { at: "2026-07-21T11:00:00Z", minutes: 20 },
    { at: "2026-07-21T11:00:00Z", minutes: 20 },
    { at: "2026-07-21T11:00:00Z", minutes: 20 },
  ];
  assert.equal(mergedStayMinutes(same), 20);

  // 一部重なり: 11:00-11:20 と 11:10-11:50 → 11:00-11:50 の50分。
  assert.equal(mergedStayMinutes([
    { at: "2026-07-21T11:00:00Z", minutes: 20 },
    { at: "2026-07-21T11:10:00Z", minutes: 40 },
  ]), 50);

  // 離れている場合は単純合計と一致する。
  assert.equal(mergedStayMinutes([
    { at: "2026-07-21T11:00:00Z", minutes: 20 },
    { at: "2026-07-21T13:00:00Z", minutes: 20 },
  ]), 40);
});

test("mergedStayMinutes: 空・不正値を安全に扱う", () => {
  assert.equal(mergedStayMinutes([]), 0);
  assert.equal(mergedStayMinutes([{ at: "not-a-date", minutes: 20 }]), 0);
  assert.equal(mergedStayMinutes([{ at: "2026-07-21T11:00:00Z", minutes: 0 }]), 0);
});

test("mergedStayMinutes: 実接客は延べ滞在を超えない", () => {
  const logs = buildMaidVisitLogs([
    visit({ id: "a", at: "2026-07-21T11:00:00Z", minutes: 20 }),
    visit({ id: "b", at: "2026-07-21T11:05:00Z", minutes: 20 }),
    visit({ id: "c", at: "2026-07-21T11:10:00Z", minutes: 40 }),
  ], maids, customers, []);
  const sum = logs.reduce((acc, l) => acc + l.minutes, 0);
  assert.ok(mergedStayMinutes(logs) <= sum);
  assert.equal(mergedStayMinutes(logs), 50); // 11:00〜11:50
});
