import assert from "node:assert/strict";
import test from "node:test";
import { parseShiftTemplate } from "../src/parser.ts";

const receivedAt = new Date("2026-07-21T03:00:00.000Z");

test("parses absence", () => {
  const result = parseShiftTemplate(`依頼内容：[欠勤]\nメイド名：こはる\n対象日時：[7月22日　19:00～23:30]\n理由：[①体調不良]`, receivedAt);
  assert.equal(result?.eventType, "absence");
  assert.equal(result?.maidName, "こはる");
  assert.equal(result?.targetRange?.startAt, "2026-07-22T10:00:00.000Z");
  assert.equal(result?.reason, "①体調不良");
});

test("parses shift change as remove and add ranges", () => {
  const result = parseShiftTemplate(`依頼内容：[シフト変更]\nメイド名：みるく\n削除する日時：[7月23日 19:00～22:00]\n追加する日時：[7月24日 20:00～23:30]\n理由：[②私用や仕事]`, receivedAt);
  assert.equal(result?.eventType, "shift_change");
  assert.equal(result?.removeRange?.localDate, "2026-07-23");
  assert.equal(result?.addRange?.startTime, "20:00");
});

test("parses shift addition", () => {
  const result = parseShiftTemplate(`依頼内容：[シフト追加]\nメイド名：しずく\n追加する日時：[7月25日 19:30～23:30]\n理由・補足：[ヘルプ]`, receivedAt);
  assert.equal(result?.eventType, "shift_add");
  assert.equal(result?.addRange?.startTime, "19:30");
});

test("parses late report", () => {
  const result = parseShiftTemplate(`報告内容：[遅刻]\nメイド名：るな\n対象日時：[7月21日 19:00～23:30]\n理由：[③機材故障や電波障害]`, receivedAt);
  assert.equal(result?.eventType, "late");
});

test("parses early leave and rolls an overnight end time to the next day", () => {
  const result = parseShiftTemplate(`報告内容：[早退]\nメイド名：もも\n対象日時：[7月21日 23:00～01:00]\n理由：[⑤別途連絡]`, receivedAt);
  assert.equal(result?.eventType, "early_leave");
  assert.equal(result?.targetRange?.endAt, "2026-07-21T16:00:00.000Z");
});

test("infers the next year for a December post about January", () => {
  const result = parseShiftTemplate(`依頼内容：[欠勤]\nメイド名：こはる\n対象日時：[1月2日 19:00～23:30]\n理由：[私用]`, new Date("2026-12-30T03:00:00.000Z"));
  assert.equal(result?.targetRange?.localDate, "2027-01-02");
});

test("rejects an unfilled template", () => {
  assert.equal(parseShiftTemplate(`依頼内容：[欠勤]\nメイド名：\n対象日時：[●月●日 ●●:●●～●●:●●]`, receivedAt), null);
});

test("rejects an invalid calendar date", () => {
  assert.equal(parseShiftTemplate(`依頼内容：[欠勤]\nメイド名：こはる\n対象日時：[2月31日 19:00～23:30]\n理由：[私用]`, receivedAt), null);
});
