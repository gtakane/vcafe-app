import assert from "node:assert/strict";
import test from "node:test";
import { parseAnalyticsRange } from "../lib/date-range.ts";

test("parses a valid JST range", () => {
  const range = parseAnalyticsRange("2026-07-01", "2026-07-21");
  assert.equal(range?.startAt.toISOString(), "2026-06-30T15:00:00.000Z");
  assert.equal(range?.endAt.toISOString(), "2026-07-21T14:59:59.999Z");
});

test("rejects invalid calendar dates and reversed ranges", () => {
  assert.equal(parseAnalyticsRange("2026-02-31", "2026-03-01"), null);
  assert.equal(parseAnalyticsRange("2026-07-21", "2026-07-01"), null);
});

test("rejects a range over the maximum", () => {
  assert.equal(parseAnalyticsRange("2025-01-01", "2026-07-21"), null);
});
