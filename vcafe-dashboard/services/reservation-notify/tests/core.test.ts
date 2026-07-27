import assert from "node:assert/strict";
import test from "node:test";
import { businessDayWindowJst, formatMaidMessage, groupByMaid, jstDateStr, jstTime, maidKey, notificationDocId, resolveDiscordId } from "../src/core.ts";
import type { MaidDiscordMapping, ReservationEntry } from "../src/core.ts";

test("businessDayWindowJst: 00:00実行の当日営業日は [当日02:00, 翌02:00) JST", () => {
  const now = new Date("2026-07-27T00:00:00+09:00"); // JST 07/27 00:00
  const w = businessDayWindowJst(now, 0);
  assert.equal(w.day, "2026-07-27");
  assert.equal(w.start.toISOString(), new Date("2026-07-27T02:00:00+09:00").toISOString());
  assert.equal(w.end.toISOString(), new Date("2026-07-28T02:00:00+09:00").toISOString());
});

test("jstDateStr: UTCからJSTの暦日へ変換", () => {
  assert.equal(jstDateStr(new Date("2026-07-26T15:30:00Z")), "2026-07-27"); // 00:30 JST
  assert.equal(jstDateStr(new Date("2026-07-26T14:59:00Z")), "2026-07-26"); // 23:59 JST
});

test("jstTime: JSTのHH:MM", () => {
  assert.equal(jstTime("2026-07-27T11:30:00Z"), "20:30"); // 20:30 JST
});

test("groupByMaid: メイド別・時刻昇順に集約", () => {
  const entries: ReservationEntry[] = [
    { id: "r1", maidId: "m1", maidNickname: "こはる", at: "2026-07-27T13:00:00Z" }, // 22:00
    { id: "r2", maidId: "m1", maidNickname: "こはる", at: "2026-07-27T11:00:00Z" }, // 20:00
    { id: "r3", maidId: "m2", maidNickname: "みるく", at: "2026-07-27T12:00:00Z" },
  ];
  const groups = groupByMaid(entries);
  assert.equal(groups.length, 2);
  const koharu = groups.find((g) => g.maidId === "m1")!;
  assert.deepEqual(koharu.entries.map((e) => e.id), ["r2", "r1"]); // 時刻昇順
});

test("groupByMaid: maidId が無い場合はニックネームでまとめる", () => {
  const entries: ReservationEntry[] = [
    { id: "r1", maidId: "", maidNickname: "しずく", at: "2026-07-27T11:00:00Z" },
    { id: "r2", maidId: "", maidNickname: "しずく", at: "2026-07-27T12:00:00Z" },
  ];
  const groups = groupByMaid(entries);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, maidKey("", "しずく"));
  assert.equal(groups[0].entries.length, 2);
});

test("formatMaidMessage: 件数と時刻を含む。既定ではお客様名を伏せる", () => {
  const group = groupByMaid([
    { id: "r1", maidId: "m1", maidNickname: "こはる", at: "2026-07-27T11:00:00Z", customerLabel: "あおい" },
    { id: "r2", maidId: "m1", maidNickname: "こはる", at: "2026-07-27T13:30:00Z", customerLabel: "はる" },
  ])[0];
  const hidden = formatMaidMessage("2026-07-27", group);
  assert.match(hidden, /こはるさん/);
  assert.match(hidden, /20:00〜/);
  assert.match(hidden, /22:30〜/);
  assert.match(hidden, /合計 2 件/);
  assert.doesNotMatch(hidden, /あおい/); // 既定はお客様名を出さない
  const shown = formatMaidMessage("2026-07-27", group, true);
  assert.match(shown, /あおい様/);
});

test("resolveDiscordId: maidId優先、無ければニックネームで解決", () => {
  const mapping: MaidDiscordMapping = { byMaidId: new Map([["m1", "discord-1"]]), byNickname: new Map([["みるく", "discord-2"]]) };
  const [g1, g2, g3] = groupByMaid([
    { id: "a", maidId: "m1", maidNickname: "こはる", at: "2026-07-27T11:00:00Z" },
    { id: "b", maidId: "", maidNickname: "みるく", at: "2026-07-27T11:00:00Z" },
    { id: "c", maidId: "m9", maidNickname: "るな", at: "2026-07-27T11:00:00Z" },
  ]);
  assert.equal(resolveDiscordId(g1, mapping), "discord-1");
  assert.equal(resolveDiscordId(g2, mapping), "discord-2");
  assert.equal(resolveDiscordId(g3, mapping), undefined); // 未対応
});

test("notificationDocId: 営業日とキーで一意・危険文字を除去", () => {
  assert.equal(notificationDocId("2026-07-27", "nick:こはる"), "2026-07-27__nick:こはる");
  assert.equal(notificationDocId("2026-07-27", "a/b#c"), "2026-07-27__a_b_c");
});
