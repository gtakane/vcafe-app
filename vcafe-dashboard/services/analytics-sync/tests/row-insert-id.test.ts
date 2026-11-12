import assert from "node:assert/strict";
import test from "node:test";
import { rowInsertId } from "../src/row-insert-id.ts";

// 2026-07-29 の再現テスト。
//
// 何が起きたか:
//   sync_runs / sync_rejects の行は recordKey も id も maidId+month も持たないため、
//   insertId が一律 "row:" + 実行開始時刻(syncedAt) に丸め込まれていた。
//   1回の実行内では syncedAt が変わらないため、複数の窓・複数のソースの行が
//   すべて同じ insertId になり、BigQuery のストリーミング重複排除で
//   ほぼ全行が黙って欠落していた（バックフィルで本来数千行入るはずが24行のみ）。

test("recordKeyがあればそれを使う（sourceUpdatedAt付き）", () => {
  const id = rowInsertId({ recordKey: "abc", sourceUpdatedAt: "2026-01-01T00:00:00Z" }, "2026-07-29T00:00:00Z");
  assert.equal(id, "abc:2026-01-01T00:00:00Z");
});

test("recordKeyが無ければidを使う", () => {
  const id = rowInsertId({ id: "doc1", sourceUpdatedAt: "2026-01-01T00:00:00Z" }, "2026-07-29T00:00:00Z");
  assert.equal(id, "doc1:2026-01-01T00:00:00Z");
});

test("recordKey/idが無ければmaidId:monthを使う（月次レポート）", () => {
  const id = rowInsertId({ maidId: "m1", month: "2026-01" }, "2026-07-29T00:00:00Z");
  assert.equal(id, "m1:2026-01:2026-07-29T00:00:00Z");
});

test("再現: sync_runsの行は窓・ソースが違えば異なるinsertIdになる", () => {
  const base = { runId: "run-1", windowKind: "backfill" };
  const ids = new Set([
    rowInsertId({ ...base, source: "userRecordVisits", windowStart: "2021-01-01T00:00:00Z", windowEnd: "2021-01-02T00:00:00Z" }, "2026-07-29T00:00:00Z"),
    rowInsertId({ ...base, source: "userAlbum", windowStart: "2021-01-01T00:00:00Z", windowEnd: "2021-01-02T00:00:00Z" }, "2026-07-29T00:00:00Z"),
    rowInsertId({ ...base, source: "userRecordVisits", windowStart: "2021-01-02T00:00:00Z", windowEnd: "2021-01-03T00:00:00Z" }, "2026-07-29T00:00:00Z"),
  ]);
  assert.equal(ids.size, 3, "同一実行(syncedAt固定)内でも窓・ソースが違えば別のinsertIdになるべき");
});

test("再現: sync_rejectsの行はsource・reasonCode・rejectedAtが違えば異なるinsertIdになる", () => {
  const base = { runId: "run-1" };
  const ids = new Set([
    rowInsertId({ ...base, source: "userAlbum", reasonCode: "UNRESOLVED_MAID_OR_INVALID", rejectedAt: "2026-07-29T08:00:00.001Z" }, "2026-07-29T00:00:00Z"),
    rowInsertId({ ...base, source: "userRecordVisits", reasonCode: "UNRESOLVED_MAID_OR_INVALID", rejectedAt: "2026-07-29T08:00:00.001Z" }, "2026-07-29T00:00:00Z"),
    rowInsertId({ ...base, source: "userAlbum", reasonCode: "UNRESOLVED_MAID_OR_INVALID", rejectedAt: "2026-07-29T09:00:00.002Z" }, "2026-07-29T00:00:00Z"),
  ]);
  assert.equal(ids.size, 3, "同一実行(syncedAt固定)内でもsource/reasonCode/rejectedAtが違えば別のinsertIdになるべき");
});

test("いずれの識別子も無ければ row:タイムスタンプ にフォールバックする", () => {
  const id = rowInsertId({ foo: "bar" }, "2026-07-29T00:00:00Z");
  assert.equal(id, "row:2026-07-29T00:00:00Z");
});

test("dq_results の判定結果は日ごとに別の insertId になる（同じ実行の7日分が1件に潰れない）", () => {
  const base = { runId: "run-1", status: "pass", checkedAt: "2026-11-12T06:40:00.000Z" };
  const ids = ["2026-11-05", "2026-11-06", "2026-11-07"].map((day) => rowInsertId({ ...base, checkName: `visits_daily_completeness:${day}` }, "2026-11-12T06:40:00.000Z"));
  assert.equal(new Set(ids).size, 3);
});

test("balance_snapshots の行は既定値に落ちない", () => {
  const id = rowInsertId({ runId: "run-1", source: "sync", snapshotAt: "2026-11-12T06:40:00.000Z" }, "x");
  assert.ok(!id.startsWith("row:"));
});

test("insertId を作る項目を持たない行は、挿入先のテーブルに存在しない（既定値への落下を防ぐ）", async () => {
  // 同期ジョブが書き込むテーブルごとの代表的な行。新しいテーブルを足したらここにも足すこと。
  const samples: Record<string, object> = {
    dq_results: { runId: "r", checkName: "c", checkedAt: "t" },
    balance_snapshots: { runId: "r", source: "sync", snapshotAt: "t" },
    sync_runs: { runId: "r", source: "s", windowStart: "a", windowEnd: "b" },
    sync_rejects: { runId: "r", source: "s", reasonCode: "x", rejectedAt: "t" },
    bookings_raw: { recordKey: "k" },
    maid_monthly_raw: { maidId: "m", month: "202611" },
  };
  for (const [table, row] of Object.entries(samples)) {
    assert.ok(!rowInsertId(row, "fallback").startsWith("row:"), `${table} が既定の insertId に落ちる`);
  }
});
