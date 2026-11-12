import assert from "node:assert/strict";
import test from "node:test";
import {
  businessDateJst,
  classifyVisit,
  countFreeKinds,
  excludingTax,
  legacyVisitRevenue,
  paidChekiCount,
  visitRevenueParts,
  visitTotalRevenue,
  freeKindOf,
  isFree,
  isPaid,
  shiftActualHours,
  shiftLateMinutes,
  visitRevenue,
  visitWeight,
  weightedPaidCount,
  weightedVisitCount,
  visitCountBreakdown,
} from "../lib/metrics.ts";
import type { Visit } from "../lib/types.ts";

const visit = (over: Partial<Visit>): Visit => ({
  id: "v",
  at: "2026-07-21T12:00:00Z",
  maidId: "maid-1",
  customerId: "cust-1",
  type: "paid",
  revenue: 840,
  cheki: 0,
  weight: 1,
  ...over,
});

test("visitWeight matches core.py: max(1, round(initialTime/20))", () => {
  assert.equal(visitWeight(undefined), 1); // 既定20 → 1
  assert.equal(visitWeight(20), 1);
  assert.equal(visitWeight(40), 2);
  assert.equal(visitWeight(60), 3);
  assert.equal(visitWeight(10), 1); // round(0.5)=0 でも下限1
  assert.equal(visitWeight(0), 1); // 不正値は既定20扱い → 1
});

test("classifyVisit matches core.py: 無料=trialのみ、予約はroomType、他は有料", () => {
  assert.equal(classifyVisit("trial10minutes", ""), "trial");
  assert.equal(classifyVisit("gokitaku30minutes", "reservation"), "reservation");
  assert.equal(classifyVisit("gokitaku30minutes", ""), "paid");
  // 0コインでも trial/予約でなければ有料に分類する（旧実装の free 誤分類を修正）。
  assert.equal(classifyVisit("ATCOIN", ""), "paid");
});

test("legacyVisitRevenue matches core.py _calc_revenue（Streamlit版との互換）", () => {
  assert.equal(legacyVisitRevenue("trial", "trial10minutes", 0, 0), 0);
  assert.equal(legacyVisitRevenue("reservation", "gokitaku30minutes", 0, 0), 3920);
  assert.equal(legacyVisitRevenue("paid", "gokitaku30minutes", 600, 0), 840);
  assert.equal(legacyVisitRevenue("paid", "premiumGokitaku1", 0, 0), 960);
  assert.equal(legacyVisitRevenue("paid", "ATCOIN", 500, 100), Math.round(600 * 1.4));
});

test("visitRevenue は経理の単価（コイン1.19円・リワードP1.1円・チケット850/960/650円）で計算する", () => {
  assert.equal(visitRevenue("paid", "gokitaku30minutes", 0, 0), 850);
  assert.equal(visitRevenue("paid", "gokitaku30minutes", 0, 0, 2), 1700); // 40分=2枚
  assert.equal(visitRevenue("paid", "premiumGokitaku1", 0, 0, 1), 960);
  assert.equal(visitRevenue("paid", "luckyGokitaku", 0, 0), 650);
  assert.equal(visitRevenue("paid", "ATCOIN", 600, 0, null, "apple"), Math.round(600 * 1.19));
  assert.equal(visitRevenue("paid", "ATCOIN", 0, 300), Math.round(300 * 1.1));
  assert.equal(visitRevenue("paid", "ATCOIN", 600, 300, null, "google"), Math.round(600 * 1.19) + Math.round(300 * 1.1));
  // 予約はご帰宅側では0（予約時のコイン消費として userReservations 側で計上する）
  assert.equal(visitRevenue("reservation", "ATCOIN", 0, 0), 0);
  assert.equal(visitRevenue("free", "freeGokitaku", 0, 0), 0);
  assert.equal(visitRevenue("trial", "trial10minutes", 0, 0), 0);
});

test("売上の内訳はコインの購入元で振り分け、無料チェキは売上にしない", () => {
  const parts = visitRevenueParts({ type: "paid", ticketId: "ATCOIN", billedCoin: 1000, billedCoinVendor: "apple", billedRewardPoint: 100, usedTicketCount: null });
  assert.deepEqual(parts, { apple: 1190, google: 0, coinUnknown: 0, rewardPoint: 110, ticket: 0, cheki: 0 });
  const legacy = visitRevenueParts({ type: "paid", ticketId: "ATCOIN", billedCoin: 1000, billedCoinVendor: null, billedRewardPoint: 0, usedTicketCount: null });
  assert.equal(legacy.coinUnknown, 1190);
  assert.equal(paidChekiCount({ cheki: 3, freeCheki: 1 }), 2);
  assert.equal(visitTotalRevenue({ revenue: 850, cheki: 2, freeCheki: 1 }), 850 + 500);
  assert.equal(excludingTax(3289514), 2990467); // 経理資料（10月）の税込→税抜と一致
});

test("isPaid counts reservation as paid but excludes trial", () => {
  assert.equal(isPaid("paid"), true);
  assert.equal(isPaid("reservation"), true);
  assert.equal(isPaid("trial"), false);
});

test("ご帰宅数: 通常は滞在時間÷20分（20分未満0.5件）、予約・お試し・無料は1件（2026-11-12 指定）", () => {
  const visits = [
    visit({ type: "paid", minutes: 20 }), // 1
    visit({ type: "paid", minutes: 40 }), // 2
    visit({ type: "paid", minutes: 10 }), // 0.5
    visit({ type: "paid", minutes: null, weight: 2 }), // 滞在時間の無い古い行は重み×20分 → 2
    visit({ type: "trial", minutes: 10 }), // 1
    visit({ type: "reservation", minutes: 60, weight: 3 }), // 1（滞在時間に関係なく）
    visit({ type: "free", minutes: 20, entryType: "newUserFree" }), // 1
  ];
  assert.equal(weightedVisitCount(visits), 8.5);
  assert.equal(weightedPaidCount(visits), 6.5); // 通常5.5 + 予約1、お試し・無料は除外
  assert.deepEqual(visitCountBreakdown(visits), { normal: 5.5, normalVisits: 4, reservation: 1, trial: 1, free: 1, total: 8.5 });
});

test("businessDateJst rolls 00:00-01:59 JST into the previous day (core.py _biz_date)", () => {
  // 2026-07-22 01:30 JST = 2026-07-21T16:30:00Z → 営業日は前日 2026-07-21
  assert.equal(businessDateJst("2026-07-21T16:30:00Z"), "2026-07-21");
  // 2026-07-22 02:00 JST = 2026-07-21T17:00:00Z → 当日 2026-07-22
  assert.equal(businessDateJst("2026-07-21T17:00:00Z"), "2026-07-22");
  // 2026-07-21 20:00 JST = 2026-07-21T11:00:00Z → 当日 2026-07-21
  assert.equal(businessDateJst("2026-07-21T11:00:00Z"), "2026-07-21");
});

test("shift hours fill missing punches with schedule (core.py calc_shift_detail)", () => {
  // 実打刻あり: 19:05→23:25 = 4.333h、遅刻5分
  const punched = { scheduledStart: "2026-07-21T10:00:00Z", scheduledEnd: "2026-07-21T14:30:00Z", actualStart: "2026-07-21T10:05:00Z", actualEnd: "2026-07-21T14:25:00Z" };
  assert.equal(Math.round(shiftActualHours(punched) * 60), 260); // 4h20m
  assert.equal(shiftLateMinutes(punched), 5);
  // 未打刻: 予定で補完 → 稼働=予定4.5h、遅刻0
  const noPunch = { scheduledStart: "2026-07-21T10:00:00Z", scheduledEnd: "2026-07-21T14:30:00Z", actualStart: null, actualEnd: null };
  assert.equal(shiftActualHours(noPunch), 4.5);
  assert.equal(shiftLateMinutes(noPunch), 0);
});


test("無料ご帰宅3種とお試しは無料枠。予約より無料判定を優先する", () => {
  assert.equal(classifyVisit("freeGokitaku", "workshift"), "free");
  assert.equal(classifyVisit("ATCOIN", "workshift", { isFreeEntry: true, entryType: "newUserFree" }), "free");
  assert.equal(classifyVisit("ATCOIN", "reservation", { isFreeEntry: true, entryType: "freshMaidFree" }), "free");
  assert.equal(classifyVisit("trial10minutes", "workshift"), "trial");
  assert.equal(classifyVisit("ATCOIN", "workshift", { isFreeEntry: false }), "paid");
  assert.equal(isFree("free"), true);
  assert.equal(isFree("trial"), true);
  assert.equal(isPaid("free"), false);
  assert.equal(visitRevenue("free", "freeGokitaku", 0, 0), 0);
});

test("無料枠の内訳：未知の entryType は件数を落とさず「その他の無料」に寄せる", () => {
  assert.equal(freeKindOf("free", "freeGokitaku", null), "freeTicket");
  assert.equal(freeKindOf("free", "ATCOIN", "newUserFree"), "newUserFree");
  assert.equal(freeKindOf("free", "ATCOIN", "campaignFree"), "otherFree");
  assert.equal(freeKindOf("trial", "trial10minutes", null), "trial");
  assert.equal(freeKindOf("paid", "ATCOIN", null), null);
  const counts = countFreeKinds([
    { type: "free", ticketId: "freeGokitaku", entryType: "freeTicket" },
    { type: "free", ticketId: "ATCOIN", entryType: "newUserFree" },
    { type: "free", ticketId: "ATCOIN", entryType: "freshMaidFree" },
    { type: "trial", ticketId: "trial10minutes", entryType: null },
    { type: "paid", ticketId: "ATCOIN", entryType: null },
  ]);
  assert.deepEqual(counts, { trial: 1, freeTicket: 1, newUserFree: 1, freshMaidFree: 1, otherFree: 0 });
});
