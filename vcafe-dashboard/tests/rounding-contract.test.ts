import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { businessDateJst, visitRevenue, visitWeight, type VisitType } from "../lib/metrics.ts";

// 指摘10の契約テスト（TypeScript側）。
// 同じ fixture を tests/rounding_contract_test.py からも実行し、両言語で同じ値になることを保証する。
// 丸め規則は half-up（0.5は常に切り上げ）。Python の組み込み round() は偶数丸めのため使用しない。

const fixture = JSON.parse(readFileSync(new URL("./fixtures/rounding-golden.json", import.meta.url), "utf8")) as {
  rule: { name: string };
  visitWeight: Array<{ initialTime: unknown; expected: number; note?: string }>;
  visitRevenue: Array<{ type: string; ticketId: string; billedCoin: number; billedReward: number; expected: number; note?: string }>;
  businessDateJst: Array<{ atIso: string; expected: string; note?: string }>;
};

test("契約: 丸め規則は half-up", () => {
  assert.equal(fixture.rule.name, "half-up");
});

test("visitWeight が golden fixture と一致する", () => {
  for (const item of fixture.visitWeight) {
    const actual = visitWeight(item.initialTime as number | null | undefined);
    assert.equal(actual, item.expected, `initialTime=${JSON.stringify(item.initialTime)} ${item.note ?? ""}`);
  }
});

test("visitRevenue が golden fixture と一致する", () => {
  for (const item of fixture.visitRevenue) {
    const actual = visitRevenue(item.type as VisitType, item.ticketId, item.billedCoin, item.billedReward);
    assert.equal(actual, item.expected, `${item.ticketId} coin=${item.billedCoin} reward=${item.billedReward} ${item.note ?? ""}`);
  }
});

test("businessDateJst が golden fixture と一致する（営業日境界）", () => {
  for (const item of fixture.businessDateJst) {
    assert.equal(businessDateJst(item.atIso), item.expected, `${item.atIso} ${item.note ?? ""}`);
  }
});

test("偶数丸めなら不一致になるケースを明示的に検証する", () => {
  // Python の round() は 2.5→2, 4.5→4, 6.5→6 と偶数へ丸める。half-up ではすべて切り上げ。
  assert.equal(visitWeight(50), 3); // 2.5
  assert.equal(visitWeight(90), 5); // 4.5
  assert.equal(visitWeight(130), 7); // 6.5
});
