import assert from "node:assert/strict";
import test from "node:test";
import { manifestColumns, manifestTables, validateRows, type RowRejection } from "../src/row-validation.ts";

// 指摘11の実行時検証。
// 旧実装は挿入行を型アサーションだけで信用しており、schema.sql と TypeScript の
// ずれは実行時に BigQuery のエラーとして初めて表面化していた。

test("manifest が schema.sql の全テーブルを含む", () => {
  const tables = manifestTables();
  for (const expected of ["visits_raw", "cheki_raw", "shifts_raw", "presents_raw", "payments_raw", "customers_raw", "sync_runs", "sync_rejects", "dq_results"]) {
    assert.ok(tables.includes(expected), `${expected} が manifest に無い`);
  }
});

test("recordKey / runId が manifest に含まれる（列追加の取りこぼし検知）", () => {
  for (const table of ["visits_raw", "cheki_raw", "shifts_raw", "presents_raw", "payments_raw", "customers_raw"]) {
    const columns = manifestColumns(table);
    assert.ok(columns.includes("recordKey"), `${table} に recordKey が無い`);
    assert.ok(columns.includes("runId"), `${table} に runId が無い`);
  }
});

test("manifest に無い列が混じった行を弾く", () => {
  const rejections: RowRejection[] = [];
  const result = validateRows("visits_raw", [
    { id: "v1", at: "2026-07-21T11:00:00Z", maidId: "m", customerId: "c", type: "paid", revenue: 840, cheki: 0, weight: 1, syncedAt: "2026-07-28T00:00:00Z" },
    { id: "v2", typo_column: "x" },
  ], (r) => rejections.push(r));
  assert.equal(result.valid.length, 1);
  assert.equal(result.rejected, 1);
  assert.equal(rejections[0].reasonCode, "UNKNOWN_COLUMN");
  assert.equal(rejections[0].fieldNames, "typo_column");
});

test("型が違う行を弾く", () => {
  const rejections: RowRejection[] = [];
  const result = validateRows("visits_raw", [
    { id: "v1", revenue: "840" as unknown as number }, // INT64 に文字列
  ], (r) => rejections.push(r));
  assert.equal(result.rejected, 1);
  assert.equal(rejections[0].reasonCode, "TYPE_MISMATCH");
  assert.equal(rejections[0].fieldNames, "revenue");
});

test("reject に生の値を含めない（列名のみ）", () => {
  const rejections: RowRejection[] = [];
  validateRows("visits_raw", [{ id: "v1", secret_value: "SENSITIVE" }], (r) => rejections.push(r));
  const serialized = JSON.stringify(rejections);
  assert.ok(!serialized.includes("SENSITIVE"), "生の値が reject に残っている");
  assert.ok(serialized.includes("secret_value"), "列名は記録されるべき");
});

test("NULL 許容列は NULL でも通る", () => {
  const result = validateRows("visits_raw", [
    { id: "v1", at: "2026-07-21T11:00:00Z", sourceUpdatedAt: null, ticketId: null, minutes: null },
  ]);
  assert.equal(result.rejected, 0);
});

test("manifest に無いテーブルは検証をスキップする（握りつぶさず警告する）", () => {
  const result = validateRows("unknown_table", [{ anything: 1 }]);
  assert.equal(result.valid.length, 1);
  assert.equal(result.rejected, 0);
});
