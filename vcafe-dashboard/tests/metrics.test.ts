import assert from "node:assert/strict";
import test from "node:test";
import {
  businessDateJst,
  classifyVisit,
  isPaid,
  shiftActualHours,
  shiftLateMinutes,
  visitRevenue,
  visitWeight,
  weightedPaidCount,
  weightedVisitCount,
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

test("visitRevenue matches core.py _calc_revenue", () => {
  assert.equal(visitRevenue("trial", "trial10minutes", 0, 0), 0);
  assert.equal(visitRevenue("reservation", "gokitaku30minutes", 0, 0), 3920);
  assert.equal(visitRevenue("paid", "gokitaku30minutes", 600, 0), 840);
  assert.equal(visitRevenue("paid", "premiumGokitaku1", 0, 0), 960);
  // 未知チケットは (billedCoin + billedRewardPoint) * 1.4 の四捨五入。
  assert.equal(visitRevenue("paid", "ATCOIN", 500, 100), Math.round(600 * 1.4));
});

test("isPaid counts reservation as paid but excludes trial", () => {
  assert.equal(isPaid("paid"), true);
  assert.equal(isPaid("reservation"), true);
  assert.equal(isPaid("trial"), false);
});

test("weighted counts use visit weight (ご帰宅数/有料数)", () => {
  const visits = [
    visit({ type: "paid", weight: 2 }),
    visit({ type: "trial", weight: 1 }),
    visit({ type: "reservation", weight: 3 }),
  ];
  assert.equal(weightedVisitCount(visits), 6); // 2 + 1 + 3
  assert.equal(weightedPaidCount(visits), 5); // paid2 + reservation3、trialは除外
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
