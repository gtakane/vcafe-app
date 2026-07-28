import assert from "node:assert/strict";
import test from "node:test";
import { CUSTOMER_NUMERIC_KEYS, loadCustomers } from "../lib/customers.ts";

// ANALYTICS_BACKEND 未設定 → モック経路。数値フィルタのロジックを検証する。

test("数値フィルタ: 下限・上限で絞り込める", async () => {
  const all = await loadCustomers({});
  const min = await loadCustomers({ numeric: [{ key: "totalVisitAmount", min: 30 }] });
  assert.ok(min.total > 0 && min.total < all.total);
  for (const c of min.customers) assert.ok(Number(c.totalVisitAmount ?? 0) >= 30);

  const range = await loadCustomers({ numeric: [{ key: "coin", min: 1000, max: 1500 }] });
  for (const c of range.customers) {
    const v = Number(c.coin ?? 0);
    assert.ok(v >= 1000 && v <= 1500);
  }
});

test("数値フィルタ: 課金額0円以上は全員に一致する（NULLは0扱い）", async () => {
  const all = await loadCustomers({});
  const zero = await loadCustomers({ numeric: [{ key: "paymentAmount", min: 0 }] });
  assert.equal(zero.total, all.total);
});

test("数値フィルタ: ホワイトリスト外の列は無視される", async () => {
  const all = await loadCustomers({});
  const bad = await loadCustomers({ numeric: [{ key: "id; DROP TABLE users --", min: 5 }] });
  assert.equal(bad.total, all.total);
  assert.ok(!CUSTOMER_NUMERIC_KEYS.has("id; DROP TABLE users --"));
});

test("数値フィルタ: min/max が数値でない場合は無視される", async () => {
  const all = await loadCustomers({});
  const nan = await loadCustomers({ numeric: [{ key: "paymentAmount", min: Number.NaN }] });
  assert.equal(nan.total, all.total);
});
