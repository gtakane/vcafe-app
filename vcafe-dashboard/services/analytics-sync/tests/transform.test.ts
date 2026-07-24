import assert from "node:assert/strict";
import test from "node:test";
import { buildMaidMap, mapShift, mapUser, mapVisit, pseudonymizeCustomerId } from "../src/transform.ts";

const secret = "0123456789abcdef0123456789abcdef";
const timestamp = (iso: string) => ({ toDate: () => new Date(iso) });

test("pseudonymizes a user deterministically without exposing the source id", () => {
  const first = pseudonymizeCustomerId("source-user-id", secret);
  assert.equal(first, pseudonymizeCustomerId("source-user-id", secret));
  assert.notEqual(first, "source-user-id");
  assert.equal(first.length, 64);
});

test("maps and pseudonymizes a confirmed user document", () => {
  const user = mapUser({ id: "user-1", data: { nickname: "ゲスト", rank: "Gold", registrationDate: timestamp("2024-06-17T11:00:10Z") } }, secret);
  assert.equal(user?.name, "ゲスト");
  assert.equal(user?.rank, "Gold");
  assert.notEqual(user?.id, "user-1");
});

test("maps a paid visit with the known ticket price", () => {
  const visit = mapVisit({ id: "visit-1", parentId: "user-1", data: { enterDateTime: timestamp("2026-07-21T10:00:00Z"), maidNickname: "こはる", usedTicketItemId: "gokitaku30minutes", billedCoin: 600 } }, secret, new Map([["こはる", "maid-1"]]));
  assert.equal(visit?.maidId, "maid-1");
  assert.equal(visit?.revenue, 840);
  assert.equal(visit?.type, "paid");
  assert.equal(visit?.weight, 1); // initialTime未設定 → 既定20 → 重み1
});

test("derives the visit weight from initialTime (core.py と一致)", () => {
  const visit = mapVisit({ id: "visit-2", parentId: "user-1", data: { enterDateTime: timestamp("2026-07-21T10:00:00Z"), usedTicketItemId: "gokitaku30minutes", billedCoin: 600, initialTime: 40 } }, secret, new Map());
  assert.equal(visit?.weight, 2); // 40分 → 重み2
});

test("classifies a zero-coin non-trial visit as paid, not free", () => {
  // 旧実装は billedCoin+reward<=0 を free に誤分類していた。core.py は有料扱い。
  const visit = mapVisit({ id: "visit-3", parentId: "user-1", data: { enterDateTime: timestamp("2026-07-21T10:00:00Z"), usedTicketItemId: "ATCOIN", billedCoin: 0 } }, secret, new Map());
  assert.equal(visit?.type, "paid");
  assert.equal(visit?.revenue, 0); // round(0 * 1.4)
});

test("classifies reservation and trial visits", () => {
  const reservation = mapVisit({ id: "visit-4", parentId: "user-1", data: { enterDateTime: timestamp("2026-07-21T10:00:00Z"), roomType: "reservation", usedTicketItemId: "gokitaku30minutes" } }, secret, new Map());
  assert.equal(reservation?.type, "reservation");
  assert.equal(reservation?.revenue, 3920);
  const trial = mapVisit({ id: "visit-5", parentId: "user-1", data: { enterDateTime: timestamp("2026-07-21T10:00:00Z"), usedTicketItemId: "trial10minutes" } }, secret, new Map());
  assert.equal(trial?.type, "trial");
  assert.equal(trial?.revenue, 0);
});

test("builds the maid lookup and maps actual shift timestamps", () => {
  const source = { id: "shift-1", data: { maidId: "maid-1", maidNickname: "こはる", openTime: timestamp("2026-07-21T10:00:00Z"), closeTime: timestamp("2026-07-21T14:30:00Z"), serveStartTime: [timestamp("2026-07-21T10:05:00Z")], serveEndTime: [timestamp("2026-07-21T14:25:00Z")] } };
  assert.equal(buildMaidMap([source]).get("こはる"), "maid-1");
  const shift = mapShift(source);
  assert.equal(shift?.maidName, "こはる");
  assert.equal(shift?.actualStart, "2026-07-21T10:05:00.000Z");
});
