import assert from "node:assert/strict";
import test from "node:test";
import { mapSafely } from "../src/safe-map.ts";
import { mapCheki, mapPayment, mapPresent, mapPurchase, mapShift, mapUser, mapUserPayment, mapVisit, type SourceDocument } from "../src/transform.ts";

// 壊れた本番 shape への耐性テスト。
// 本番では実際に「終了打刻が1件足りない配列」「registrationDate が空文字」
// といった想定外の形が存在し、片方は maid 管理アプリを落とした。
// 1件の壊れた文書で窓全体が落ちないこと、reject に生の値を残さないことを固定する。

const secret = "0123456789abcdef0123456789abcdef";
const maidMap = new Map([["こはる", "maid-01"]]);

/** 決定的な擬似乱数（テストを再現可能にする）。 */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** 本番で観測され得る「壊れた値」の集合。 */
const HOSTILE_VALUES: unknown[] = [
  null, undefined, "", "  ", 0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
  "20", "abc", true, false, [], {}, [null], [undefined],
  { seconds: Number.NaN, nanoseconds: 0 },
  { seconds: 8.64e15, nanoseconds: 0 },      // 異常な Timestamp
  { toDate: () => { throw new Error("boom"); } }, // toDate() が例外を投げる
  { toDate: () => new Date("invalid") },
  { toDate: () => null },
];

const FIELDS = [
  "enterDateTime", "date", "presentDateTime", "paymentDate", "requestDate", "confirmPurchaseTime",
  "openTime", "closeTime", "serveStartTime", "serveEndTime",
  "maidId", "maidNickname", "usedTicketItemId", "roomType",
  "initialTime", "billedCoin", "billedRewardPoint", "amount", "chargeCoin", "quantity",
  "author", "userId", "coinSendToChargeCoin", "nickname", "registrationDate", "rank",
];

function hostileDocument(random: () => number, index: number): SourceDocument {
  const data: Record<string, unknown> = {};
  for (const field of FIELDS) {
    if (random() < 0.6) data[field] = HOSTILE_VALUES[Math.floor(random() * HOSTILE_VALUES.length)];
  }
  return {
    id: `doc-${index}`,
    // parentId 欠落も一定割合で起こす
    parentId: random() < 0.7 ? `uid-${index}` : undefined,
    path: random() < 0.8 ? `users/uid-${index}/coll/doc-${index}` : undefined,
    updatedAt: random() < 0.8 ? "2026-07-21T12:00:00.000Z" : undefined,
    data,
  };
}

const MAPPERS: Array<[string, (d: SourceDocument) => unknown]> = [
  ["mapVisit", (d) => mapVisit(d, secret, maidMap)],
  ["mapPresent", (d) => mapPresent(d, secret, maidMap)],
  ["mapCheki", (d) => mapCheki(d, secret, maidMap, "2026-07-28T00:00:00Z")],
  ["mapShift", (d) => mapShift(d, maidMap, secret)],
  ["mapPayment", (d) => mapPayment(d, secret)],
  ["mapPurchase", (d) => mapPurchase(d, secret)],
  ["mapUserPayment", (d) => mapUserPayment(d, secret)],
  ["mapUser", (d) => mapUser(d, secret)],
];

test("壊れた文書を大量に流しても mapSafely が窓を落とさない", () => {
  const random = rng(20260728);
  const documents = Array.from({ length: 400 }, (_, i) => hostileDocument(random, i));

  for (const [name, mapper] of MAPPERS) {
    const rejects: Array<{ reasonCode: string; hashedPath: string | null }> = [];
    const result = mapSafely(documents, mapper, {
      source: name,
      secret,
      onReject: (entry) => rejects.push({ reasonCode: entry.reasonCode, hashedPath: entry.hashedPath }),
    });
    // 例外で全体が落ちないこと。受理＋棄却で必ず総数に一致する。
    assert.equal(result.accepted.length + result.rejected, documents.length, `${name}: 件数が合わない`);
    assert.ok(rejects.length === result.rejected, `${name}: reject の記録漏れ`);
  }
});

test("reject に生の値・UID・パスを残さない", () => {
  const document: SourceDocument = {
    id: "doc-secret", parentId: "uid-SECRET-USER", path: "users/uid-SECRET-USER/userRecordVisits/doc-secret",
    data: { enterDateTime: { toDate: () => { throw new Error("生の値 SENSITIVE-VALUE を含む例外"); } }, maidNickname: "こはる" },
  };
  const rejects: Array<Record<string, unknown>> = [];
  mapSafely([document], (d) => mapVisit(d, secret, maidMap), {
    source: "userRecordVisits", secret, onReject: (entry) => rejects.push(entry as unknown as Record<string, unknown>),
  });
  assert.equal(rejects.length, 1);
  const serialized = JSON.stringify(rejects[0]);
  assert.ok(!serialized.includes("uid-SECRET-USER"), "生のUIDが残っている");
  assert.ok(!serialized.includes("SENSITIVE-VALUE"), "例外メッセージの生の値が残っている");
  assert.ok(!serialized.includes("users/uid-"), "生のパスが残っている");
  // hashedPath は recordKey と同じ HMAC。逆引きできない。
  assert.match(String(rejects[0].hashedPath), /^[0-9a-f]{64}$/);
  assert.equal(rejects[0].reasonCode, "MAPPER_THREW");
});

test("toDate() が例外を投げる1件があっても他の行は取り込まれる", () => {
  const good: SourceDocument = {
    id: "ok", parentId: "uid-ok", path: "users/uid-ok/userRecordVisits/ok",
    data: { enterDateTime: { toDate: () => new Date("2026-07-21T11:00:00Z") }, maidNickname: "こはる", usedTicketItemId: "ATCOIN" },
  };
  const bad: SourceDocument = {
    id: "ng", parentId: "uid-ng", path: "users/uid-ng/userRecordVisits/ng",
    data: { enterDateTime: { toDate: () => { throw new Error("boom"); } }, maidNickname: "こはる" },
  };
  const result = mapSafely([bad, good, bad], (d) => mapVisit(d, secret, maidMap), { source: "userRecordVisits", secret, onReject: () => {} });
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected, 2);
});

test("reject率が閾値を超えたら検知できる", () => {
  const documents = Array.from({ length: 10 }, (_, i) => ({
    id: `d${i}`, parentId: `u${i}`, path: `users/u${i}/c/d${i}`,
    data: i < 6 ? { enterDateTime: { toDate: () => { throw new Error("x"); } } } : { enterDateTime: { toDate: () => new Date("2026-07-21T11:00:00Z") }, maidId: "maid-01" },
  }));
  const result = mapSafely(documents, (d) => mapVisit(d, secret, maidMap), { source: "userRecordVisits", secret, onReject: () => {} });
  assert.equal(result.rejectRate > 0.5, true, "reject率を算出できていない");
});
