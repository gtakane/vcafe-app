import assert from "node:assert/strict";
import test from "node:test";
import { summarizeInsertErrors } from "../src/insert-errors.ts";

// 2026-07-27 の事故で実際に出たログ:
//
//   INSERT_FAILED table=shifts_raw name=PartialFailureError message= reasons=[{"errors"…
//
// message は空、reasons は生の配列を JSON.stringify しただけで、Cloud Run のログ画面では
// 途中で切れて読めなかった。結果「全テーブルで失敗している」以上のことが分からず、
// 原因（recordKey 列が無い）にたどり着けなかった。
//
// PartialFailureError の中身は BigQuery が行ごとに返す
// { row, errors: [{ reason, location, message }] } の配列で、
// 列不足なら location にその列名が入る。ここを取り出して短くまとめる。

/** 実際に BigQuery が返した形（recordKey / runId が無いテーブルへの挿入）。 */
const productionShape = {
  name: "PartialFailureError",
  message: "",
  errors: [
    {
      row: { id: "x1" },
      errors: [
        { reason: "invalid", location: "recordKey", message: "no such field: recordKey." },
        { reason: "invalid", location: "runId", message: "no such field: runId." },
      ],
    },
    {
      row: { id: "x2" },
      errors: [
        { reason: "invalid", location: "recordKey", message: "no such field: recordKey." },
      ],
    },
  ],
};

test("列不足の理由と列名を取り出す", () => {
  const summary = summarizeInsertErrors(productionShape);
  assert.equal(summary.rowsFailed, 2);
  assert.deepEqual(summary.fields.sort(), ["recordKey", "runId"]);
  assert.deepEqual(summary.reasons, ["invalid"]);
  assert.match(summary.sample, /no such field: recordKey/);
});

test("同じ理由が何行続いても要約は短いまま（ログが切れて読めなくならない）", () => {
  const many = {
    name: "PartialFailureError",
    errors: Array.from({ length: 500 }, (_, index) => ({
      row: { id: `x${index}` },
      errors: [{ reason: "invalid", location: "recordKey", message: "no such field: recordKey." }],
    })),
  };
  const summary = summarizeInsertErrors(many);
  assert.equal(summary.rowsFailed, 500);
  assert.deepEqual(summary.fields, ["recordKey"]);
  // 500行ぶんを並べない。
  assert.ok(summary.sample.length < 300, `要約が長すぎる: ${summary.sample.length}文字`);
});

test("insertErrors が response 側に入る形にも対応する", () => {
  const summary = summarizeInsertErrors({
    name: "PartialFailureError",
    response: { insertErrors: [{ row: {}, errors: [{ reason: "stopped", location: "at", message: "stopped" }] }] },
  });
  assert.equal(summary.rowsFailed, 1);
  assert.deepEqual(summary.fields, ["at"]);
});

test("PartialFailureError でない例外でも壊れない", () => {
  const summary = summarizeInsertErrors(new Error("network unreachable"));
  assert.equal(summary.rowsFailed, 0);
  assert.deepEqual(summary.fields, []);
  assert.equal(summary.sample, "network unreachable");
});

test("行データはログへ出さない（本番の値を分析ログに残さない）", () => {
  const summary = summarizeInsertErrors({
    name: "PartialFailureError",
    errors: [{
      row: { customerId: "秘密のID", nickname: "実名" },
      errors: [{ reason: "invalid", location: "recordKey", message: "no such field: recordKey." }],
    }],
  });
  const serialized = JSON.stringify(summary);
  assert.ok(!serialized.includes("秘密のID"), "行の値がログに含まれている");
  assert.ok(!serialized.includes("実名"), "行の値がログに含まれている");
});
