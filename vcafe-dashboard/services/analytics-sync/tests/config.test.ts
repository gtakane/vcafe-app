import assert from "node:assert/strict";
import test from "node:test";
import { loadSyncConfig } from "../src/config.ts";

const valid = {
  CONFIRM_READ_ONLY_SYNC: "I_UNDERSTAND_THIS_READS_PRODUCTION",
  PRODUCTION_PROJECT_ID: "vcafe-production",
  ANALYTICS_PROJECT_ID: "vcafe-analytics",
  BIGQUERY_DATASET: "vcafe_analytics",
  SYNC_START: "2026-07-20T15:00:00.000Z",
  SYNC_END: "2026-07-21T15:00:00.000Z",
  CUSTOMER_ID_HMAC_SECRET: "0123456789abcdef0123456789abcdef",
};

test("loads a bounded read-only sync config in dry-run mode by default", () => {
  const config = loadSyncConfig(valid);
  assert.equal(config.dryRun, true);
  // MAX_DOCUMENTS は「1ソース・1窓あたりの総上限」。1回のクエリ件数は PAGE_SIZE で別管理する。
  assert.equal(config.maxDocuments, 50000);
  assert.equal(config.pageSize, 2000);
});

test("uses a safe 90-minute lookback when a scheduler does not pass explicit dates", () => {
  const { SYNC_START: _start, SYNC_END: _end, ...scheduled } = valid;
  const config = loadSyncConfig(scheduled, new Date("2026-07-21T15:00:00.000Z"));
  assert.equal(config.start.toISOString(), "2026-07-21T13:30:00.000Z");
  assert.equal(config.end.toISOString(), "2026-07-21T15:00:00.000Z");
});

test("refuses to run without an explicit production-read confirmation", () => {
  assert.throws(() => loadSyncConfig({ ...valid, CONFIRM_READ_ONLY_SYNC: "" }), /同期を開始しません/);
});

test("refuses to use the production project as the analytics project", () => {
  assert.throws(() => loadSyncConfig({ ...valid, ANALYTICS_PROJECT_ID: "vcafe-production" }), /分離/);
});

test("refuses a window longer than 24 hours", () => {
  assert.throws(() => loadSyncConfig({ ...valid, SYNC_START: "2026-07-19T14:59:59.000Z" }), /24時間/);
});

test("PAGE_SIZE と MAX_DOCUMENTS は独立して指定できる", () => {
  const config = loadSyncConfig({ ...valid, PAGE_SIZE: "500", MAX_DOCUMENTS: "120000" });
  assert.equal(config.pageSize, 500);
  assert.equal(config.maxDocuments, 120000);
});

test("PAGE_SIZE は範囲外を拒否する", () => {
  assert.throws(() => loadSyncConfig({ ...valid, PAGE_SIZE: "0" }), /PAGE_SIZE/);
  assert.throws(() => loadSyncConfig({ ...valid, PAGE_SIZE: "20000" }), /PAGE_SIZE/);
});
