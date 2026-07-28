import assert from "node:assert/strict";
import test from "node:test";
import { buildMaidDirectory, mapVisit, type SourceDocument } from "../src/transform.ts";

// 指摘5の再現テスト。
// 旧実装 buildMaidMap() は「その同期窓に含まれた workshifts」だけからニックネーム→ID表を作っていた。
// 増分同期は既定90分窓なので、19時開始のシフトは翌1時の訪問を処理する窓に含まれず、
// 同一メイドが正規IDと nickname:* に分裂していた。
// 正しくは maidWorkReport（メイド名簿）から毎回作り、確定できないものは reject する。

const secret = "0123456789abcdef0123456789abcdef";
const timestamp = (iso: string) => ({ toDate: () => new Date(iso) });

// 名簿は maidWorkReport の全件スナップショット（小規模なので毎回取得してよい）。
const directory = [
  { id: "maid-01", nickname: "こはる" },
  { id: "maid-02", nickname: "みるく" },
];

test("名簿からニックネーム→IDを解決する（同期窓のシフトに依存しない）", () => {
  const map = buildMaidDirectory(directory);
  assert.equal(map.get("こはる"), "maid-01");
  assert.equal(map.get("みるく"), "maid-02");
});

test("19時開始シフトの翌1時の訪問でも正規maidIdを解決できる", () => {
  // 窓は翌0:30〜2:00 を想定。この窓に workshifts は1件も含まれない。
  const map = buildMaidDirectory(directory);
  const visit = mapVisit({
    id: "v1", parentId: "user-1",
    data: { enterDateTime: timestamp("2026-07-21T16:00:00Z"), maidNickname: "こはる", usedTicketItemId: "ATCOIN", billedCoin: 600 },
  } as SourceDocument, secret, map);
  assert.equal(visit?.maidId, "maid-01", "窓外のシフトに依存して nickname:* になってはいけない");
  assert.ok(!String(visit?.maidId).startsWith("nickname:"));
});

test("名簿に無いニックネームは確定できないため reject する（nickname:* で通常集計へ混ぜない）", () => {
  const map = buildMaidDirectory(directory);
  const visit = mapVisit({
    id: "v2", parentId: "user-1",
    data: { enterDateTime: timestamp("2026-07-21T11:00:00Z"), maidNickname: "存在しないメイド", usedTicketItemId: "ATCOIN" },
  } as SourceDocument, secret, map);
  assert.equal(visit, null);
});

test("同名メイドが2人いる場合はニックネームで確定できないため reject する", () => {
  const ambiguous = [
    { id: "maid-01", nickname: "こはる" },
    { id: "maid-09", nickname: "こはる" }, // 改名や重複登録で起こり得る
  ];
  const map = buildMaidDirectory(ambiguous);
  assert.equal(map.get("こはる"), undefined, "曖昧な名前は解決しない");

  const visit = mapVisit({
    id: "v3", parentId: "user-1",
    data: { enterDateTime: timestamp("2026-07-21T11:00:00Z"), maidNickname: "こはる", usedTicketItemId: "ATCOIN" },
  } as SourceDocument, secret, map);
  assert.equal(visit, null);
});

test("maidId が直接入っていれば名簿を引かずに採用する", () => {
  const map = buildMaidDirectory(directory);
  const visit = mapVisit({
    id: "v4", parentId: "user-1",
    data: { enterDateTime: timestamp("2026-07-21T11:00:00Z"), maidId: "maid-77", maidNickname: "未登録", usedTicketItemId: "ATCOIN" },
  } as SourceDocument, secret, map);
  assert.equal(visit?.maidId, "maid-77");
});
