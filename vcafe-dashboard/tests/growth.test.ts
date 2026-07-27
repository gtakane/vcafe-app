import assert from "node:assert/strict";
import test from "node:test";
import { computeGrowth } from "../lib/growth.ts";
import type { GrowthRegistration, GrowthShiftRow, GrowthVisitRow } from "../lib/growth.ts";

// 営業日: 19:00〜翌02:00。JSTで書きやすいよう +09:00 表記の時刻を使う。
const at = (day: string, hourJst: number) => new Date(`${day}T${String(hourJst).padStart(2, "0")}:00:00+09:00`).toISOString();

test("DAU は営業日ごとのユニークアクティブ数、平均とピークを返す", () => {
  const visits: GrowthVisitRow[] = [
    { customerId: "u1", maidId: "m1", at: at("2026-07-01", 20), type: "paid" },
    { customerId: "u2", maidId: "m1", at: at("2026-07-01", 21), type: "paid" },
    { customerId: "u1", maidId: "m2", at: at("2026-07-01", 22), type: "paid" }, // 同日同一ユーザーは1
    { customerId: "u3", maidId: "m1", at: at("2026-07-02", 20), type: "trial" },
  ];
  const result = computeGrowth("2026-07-01", "2026-07-02", [], visits, []);
  assert.equal(result.daily.length, 2);
  assert.equal(result.daily[0].dau, 2); // 07/01: u1,u2
  assert.equal(result.daily[1].dau, 1); // 07/02: u3
  assert.equal(result.peakDau, 2);
  assert.equal(result.avgDau, 2); // round((2+1)/2)=2
  assert.equal(result.activeUsers, 3);
});

test("WAU/MAU = 週次(月曜始まり)・月次のユニークアクティブの平均とピーク", () => {
  const visits: GrowthVisitRow[] = [
    { customerId: "u1", maidId: "m1", at: at("2026-07-01", 20), type: "paid" }, // 週A(06/29-07/05)
    { customerId: "u2", maidId: "m1", at: at("2026-07-01", 21), type: "paid" }, // 週A
    { customerId: "u3", maidId: "m1", at: at("2026-07-04", 20), type: "paid" }, // 週A
    { customerId: "u4", maidId: "m1", at: at("2026-07-07", 20), type: "paid" }, // 週B(07/06-07/12)
  ];
  const result = computeGrowth("2026-07-01", "2026-07-12", [], visits, []);
  assert.equal(result.peakWau, 3); // 週A: u1,u2,u3
  assert.equal(result.avgWau, 2); // (3 + 1) / 2
  assert.equal(result.avgMau, 4); // 7月ユニーク u1..u4
  assert.equal(result.peakMau, 4);
});

test("深夜(0:00〜1:59)のご帰宅は前営業日に集計される", () => {
  const visits: GrowthVisitRow[] = [
    { customerId: "u1", maidId: "m1", at: at("2026-07-02", 1), type: "paid" }, // 07/02 01:00 → 営業日 07/01
  ];
  const result = computeGrowth("2026-07-01", "2026-07-01", [], visits, []);
  assert.equal(result.daily[0].dau, 1);
  assert.equal(result.activeUsers, 1);
});

test("新規課金転換率 = 期間内新規登録のうち有料ご帰宅した割合", () => {
  const registrations: GrowthRegistration[] = [
    { id: "new1", registeredAt: at("2026-07-01", 12) },
    { id: "new2", registeredAt: at("2026-07-02", 12) },
    { id: "new3", registeredAt: at("2026-07-03", 12) },
    { id: "old1", registeredAt: at("2026-06-01", 12) }, // 期間外は新規に数えない
  ];
  const visits: GrowthVisitRow[] = [
    { customerId: "new1", maidId: "m1", at: at("2026-07-05", 20), type: "paid" }, // 課金
    { customerId: "new2", maidId: "m1", at: at("2026-07-05", 20), type: "trial" }, // 無料のみ→非転換
    { customerId: "old1", maidId: "m1", at: at("2026-07-05", 20), type: "paid" },
  ];
  const result = computeGrowth("2026-07-01", "2026-07-31", registrations, visits, []);
  assert.equal(result.newRegistrations, 3);
  assert.equal(result.newPaidConversions, 1); // new1のみ
  assert.equal(Number(result.newPaidConversionRate.toFixed(4)), Number((1 / 3).toFixed(4)));
});

test("離脱率 = 直前同期間はアクティブだが当期間に来なかった割合", () => {
  const visits: GrowthVisitRow[] = [
    // 前期間 06/01〜06/30 に u1,u2,u3 がアクティブ
    { customerId: "u1", maidId: "m1", at: at("2026-06-10", 20), type: "paid" },
    { customerId: "u2", maidId: "m1", at: at("2026-06-11", 20), type: "paid" },
    { customerId: "u3", maidId: "m1", at: at("2026-06-12", 20), type: "paid" },
    // 当期間 07/01〜07/31 に u1 のみ再訪 → u2,u3 が離脱
    { customerId: "u1", maidId: "m1", at: at("2026-07-05", 20), type: "paid" },
  ];
  const result = computeGrowth("2026-07-01", "2026-07-31", [], visits, []);
  // 31日窓の直前・同一長(31日)窓は 05/31〜06/30。
  assert.equal(result.prevStart, "2026-05-31");
  assert.equal(result.prevEnd, "2026-06-30");
  assert.equal(result.prevActiveUsers, 3);
  assert.equal(result.churnedUsers, 2);
  assert.equal(Number(result.churnRate.toFixed(4)), Number((2 / 3).toFixed(4)));
});

test("空席率 = 合計お給仕時間×9(最大利用枠)に対する重み付きご帰宅数の空き割合", () => {
  const shifts: GrowthShiftRow[] = [
    // m1 は 19:00〜21:00（2時間）お給仕 → 最大 2h × 9 = 18枠
    { maidId: "m1", scheduledStart: at("2026-07-01", 19), scheduledEnd: at("2026-07-01", 21), actualStart: at("2026-07-01", 19), actualEnd: at("2026-07-01", 21) },
  ];
  const visits: GrowthVisitRow[] = [
    { customerId: "u1", maidId: "m1", at: at("2026-07-01", 19), type: "paid", weight: 1 }, // 20分=1枠
    { customerId: "u2", maidId: "m1", at: at("2026-07-01", 19), type: "paid", weight: 2 }, // 40分=2枠
    { customerId: "u3", maidId: "m1", at: at("2026-07-01", 20), type: "reservation", weight: 3 }, // 予約も座席を占有
  ];
  const result = computeGrowth("2026-07-01", "2026-07-01", [], visits, shifts);
  assert.equal(result.workHours, 2);
  assert.equal(result.capacitySlots, 18);
  assert.equal(result.occupiedSlots, 6); // 1+2+3
  assert.equal(Number(result.occupancyRate.toFixed(4)), Number((6 / 18).toFixed(4)));
  assert.equal(Number(result.vacancyRate.toFixed(4)), Number((12 / 18).toFixed(4)));
});

test("シフトが無い日は最大枠0のため占有率・空席率とも0", () => {
  const visits: GrowthVisitRow[] = [{ customerId: "u1", maidId: "m1", at: at("2026-07-01", 20), type: "paid", weight: 1 }];
  const result = computeGrowth("2026-07-01", "2026-07-01", [], visits, []);
  assert.equal(result.capacitySlots, 0);
  assert.equal(result.occupancyRate, 0);
  assert.equal(result.vacancyRate, 0);
});
