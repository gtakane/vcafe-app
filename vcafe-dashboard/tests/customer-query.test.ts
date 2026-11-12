import assert from "node:assert/strict";
import test from "node:test";
import { displayValue, fieldOf, filterCustomers, sortCustomers, type CustomerRecord } from "../lib/customer-query.ts";

const c = (id: string, extra: Partial<CustomerRecord> = {}): CustomerRecord => ({ id, name: id, rank: "ゴールド", registeredAt: "2026-01-01T00:00:00Z", ...extra });
const today = "2026-11-12";

test("未設定は昇順・降順どちらでも末尾。0は値として並ぶ", () => {
  const rows = [c("null"), c("zero", { paymentAmount: 0 }), c("big", { paymentAmount: 5000 }), c("mid", { paymentAmount: 100 })];
  assert.deepEqual(sortCustomers(rows, "paymentAmount", "desc").map((r) => r.id), ["big", "mid", "zero", "null"]);
  assert.deepEqual(sortCustomers(rows, "paymentAmount", "asc").map((r) => r.id), ["zero", "mid", "big", "null"]);
});

test("日付は時刻で比較し、ランクは上位→下位の順に並ぶ", () => {
  const rows = [c("a", { lastVisitAt: "2026-11-01T10:00:00Z" }), c("b", { lastVisitAt: "2026-02-01T10:00:00Z" }), c("c", { lastVisitAt: null })];
  assert.deepEqual(sortCustomers(rows, "lastVisitAt", "desc").map((r) => r.id), ["a", "b", "c"]);
  const ranks = [c("s", { rank: "シルバー" }), c("p", { rank: "プラチナ" }), c("x", { rank: "謎ランク" }), c("g", { rank: "ゴールド" })];
  assert.deepEqual(sortCustomers(ranks, "rank", "asc").map((r) => r.id), ["p", "g", "s", "x"]);
});

test("任意の日付列で期間・○日以内・○日以上前を絞り込める", () => {
  const rows = [c("recent", { lastPaymentAt: "2026-11-05T03:00:00Z" }), c("old", { lastPaymentAt: "2026-06-01T03:00:00Z" }), c("never")];
  const by = (op: "between" | "withinDays" | "olderThanDays", a: string, b = "") => filterCustomers(rows, { conditions: [{ id: "1", field: "lastPaymentAt", op, a, b }], mode: "and", today }).map((r) => r.id);
  assert.deepEqual(by("between", "2026-11-01", "2026-11-30"), ["recent"]);
  assert.deepEqual(by("withinDays", "30"), ["recent"]);
  assert.deepEqual(by("olderThanDays", "60"), ["old"]); // 未設定は「○日以上前」に含めない
});

test("複数条件は「かつ」「または」を切り替えられ、値が空の条件は無視する", () => {
  const rows = [c("a", { paymentAmount: 10000, gender: "male" }), c("b", { paymentAmount: 10, gender: "female" }), c("d", { paymentAmount: 10, gender: "male" })];
  const conditions = [
    { id: "1", field: "paymentAmount", op: "between" as const, a: "5000" },
    { id: "2", field: "gender", op: "equals" as const, a: "female" },
    { id: "3", field: "rank", op: "equals" as const, a: "" }, // 入力途中
  ];
  assert.deepEqual(filterCustomers(rows, { conditions, mode: "and", today }).map((r) => r.id), []);
  assert.deepEqual(filterCustomers(rows, { conditions, mode: "or", today }).map((r) => r.id), ["a", "b"]);
});

test("課金の有無と、未設定・0の表示の区別", () => {
  const rows = [c("paid", { lastPaymentAt: "2026-10-01T00:00:00Z" }), c("free")];
  assert.deepEqual(filterCustomers(rows, { conditions: [{ id: "1", field: "paying", op: "equals", a: "no" }], mode: "and", today }).map((r) => r.id), ["free"]);
  const fmt = { number: (n: number) => String(n), yen: (n: number) => `¥${n}`, date: (s: string) => s.slice(0, 10), gender: (g: string) => g };
  assert.equal(displayValue(c("x", { coin: 0 }), fieldOf("coin")!, fmt), "0");
  assert.equal(displayValue(c("x"), fieldOf("coin")!, fmt), "—");
});
