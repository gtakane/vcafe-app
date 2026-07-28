import assert from "node:assert/strict";
import test from "node:test";
import { buildMaidMap, mapPayment, mapPurchase, mapShift, mapUser, mapUserPayment, mapVisit, pseudonymizeCustomerId } from "../src/transform.ts";

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
  const visit = mapVisit({ id: "visit-2", parentId: "user-1", data: { maidId: "maid-1", enterDateTime: timestamp("2026-07-21T10:00:00Z"), usedTicketItemId: "gokitaku30minutes", billedCoin: 600, initialTime: 40 } }, secret, new Map());
  assert.equal(visit?.weight, 2); // 40分 → 重み2
});

test("classifies a zero-coin non-trial visit as paid, not free", () => {
  // 旧実装は billedCoin+reward<=0 を free に誤分類していた。core.py は有料扱い。
  const visit = mapVisit({ id: "visit-3", parentId: "user-1", data: { maidId: "maid-1", enterDateTime: timestamp("2026-07-21T10:00:00Z"), usedTicketItemId: "ATCOIN", billedCoin: 0 } }, secret, new Map());
  assert.equal(visit?.type, "paid");
  assert.equal(visit?.revenue, 0); // round(0 * 1.4)
});

test("classifies reservation and trial visits", () => {
  const reservation = mapVisit({ id: "visit-4", parentId: "user-1", data: { maidId: "maid-1", enterDateTime: timestamp("2026-07-21T10:00:00Z"), roomType: "reservation", usedTicketItemId: "gokitaku30minutes" } }, secret, new Map());
  assert.equal(reservation?.type, "reservation");
  assert.equal(reservation?.revenue, 3920);
  const trial = mapVisit({ id: "visit-5", parentId: "user-1", data: { maidId: "maid-1", enterDateTime: timestamp("2026-07-21T10:00:00Z"), usedTicketItemId: "trial10minutes" } }, secret, new Map());
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

test("mapPayment: Webstore課金を正規化する（author→仮名化ID・円）", () => {
  const row = mapPayment({ id: "pay-1", data: {
    author: "user-abc", paymentAmount: 840, productId: "gokitakuTicket01", itemId: "gokitaku30minutes",
    store: "webstore", stripeStatus: "stripeSucceeded",
    requestDate: { toDate: () => new Date("2026-05-21T10:18:51.660Z") },
  } }, "secret-secret-secret-secret-1234")!;
  assert.equal(row.at, "2026-05-21T10:18:51.660Z");
  assert.equal(row.amount, 840);
  assert.equal(row.coin, 0);
  assert.equal(row.channel, "webstore");
  assert.equal(row.status, "stripeSucceeded");
  assert.notEqual(row.customerId, "user-abc"); // 仮名化されている
});

test("mapPurchase: アプリ内課金を正規化する（コイン数を保持）", () => {
  const row = mapPurchase({ id: "buy-1", data: {
    userId: "user-xyz", coinSendToChargeCoin: 500, coinVendorSendToChargeCoin: "google",
    productId: "com.v.cafe.athome.500ac", platform: "Android", purchaseIsSuccessful: true,
    confirmPurchaseTime: { toDate: () => new Date("2025-11-18T16:54:21.535Z") },
  } }, "secret-secret-secret-secret-1234")!;
  assert.equal(row.coin, 500);
  assert.equal(row.amount, 700); // 本番に円額が無いため 500ac × 1.4円 で換算する
  assert.equal(row.channel, "inapp");
  assert.equal(row.status, "succeeded");
});

test("mapPayment/mapPurchase: 必須項目が欠けた行は除外する", () => {
  assert.equal(mapPayment({ id: "x", data: { paymentAmount: 100 } }, "secret-secret-secret-secret-1234"), null);
  assert.equal(mapPurchase({ id: "y", data: { userId: "u" } }, "secret-secret-secret-secret-1234"), null);
});

test("mapUserPayment: WEB版の円建て課金を台帳として取り込む", () => {
  const row = mapUserPayment({ id: "up-1", parentId: "user-web", data: {
    amount: 1100,
    requestDate: timestamp("2020-11-07T05:19:07.765Z"),
    paymentDate: timestamp("2020-11-07T05:20:14.722Z"),
  } }, secret)!;
  assert.equal(row.at, "2020-11-07T05:20:14.722Z"); // paymentDate を優先
  assert.equal(row.amount, 1100);
  assert.equal(row.coin, 0);
  assert.equal(row.channel, "webstore");
  assert.equal(row.source, "userPayments");
  assert.notEqual(row.customerId, "user-web"); // 仮名化されている
  assert.ok(!row.id.includes("user-web")); // 生のユーザーIDをIDに含めない
});

test("mapUserPayment: アプリ版はストア実払い円額を採用する（×1.4換算より正確）", () => {
  const row = mapUserPayment({ id: "up-2", parentId: "user-app", data: {
    productId: "com.v.cafe.athome.500ac", coinVendor: "apple",
    chargeCoin: 500, chargeRewardPoint: 0, amount: 740, amountRewardPoint: 0,
    paymentDate: timestamp("2025-04-09T16:39:48.283Z"),
  } }, secret)!;
  assert.equal(row.amount, 740); // 500ac×1.4=700 ではなく実払いの740円
  assert.equal(row.coin, 500);
  assert.equal(row.channel, "inapp");
  assert.equal(row.status, "succeeded");
});

test("mapUserPayment: 未完了の決済リクエスト(requestDateのみ)は除外する", () => {
  assert.equal(mapUserPayment({ id: "up-3", parentId: "user-x", data: {
    requestDate: timestamp("2020-11-07T05:08:01.548Z"),
  } }, secret), null);
  assert.equal(mapUserPayment({ id: "up-4", data: { amount: 100 } }, secret), null); // 親ID無し
});

test("mapPayment/mapPurchase: source列で由来を区別できる", () => {
  const pay = mapPayment({ id: "p", data: { author: "u", paymentAmount: 1, requestDate: timestamp("2026-01-01T00:00:00Z") } }, secret)!;
  const buy = mapPurchase({ id: "b", data: { userId: "u", coinSendToChargeCoin: 1, purchaseIsSuccessful: true, confirmPurchaseTime: timestamp("2026-01-01T00:00:00Z") } }, secret)!;
  assert.equal(pay.source, "payments");
  assert.equal(buy.source, "purchaseLog");
});

test("mapShift: 打刻配列の並び順が乱れていても最小・最大で実績を取る", () => {
  const shift = mapShift({ id: "s1", data: {
    maidId: "m1", maidNickname: "まゆら",
    openTime: timestamp("2026-07-21T12:00:00Z"), closeTime: timestamp("2026-07-21T17:00:00Z"),
    // 並びが時系列でない（本番の arrayUnion では順序が保証されない）
    serveStartTime: [timestamp("2026-07-21T14:00:00Z"), timestamp("2026-07-21T11:51:00Z")],
    serveEndTime: [timestamp("2026-07-21T11:51:27Z"), timestamp("2026-07-21T16:55:00Z")],
  } })!;
  assert.equal(shift.actualStart, "2026-07-21T11:51:00.000Z"); // 最小
  assert.equal(shift.actualEnd, "2026-07-21T16:55:00.000Z");   // 最大（誤タップの11:51:27ではない）
});

test("mapShift: 終了打刻が足りない（セッション未クローズ）なら未打刻として扱う", () => {
  // 本番実例: 開始が3回・終了が1回。at(-1) では 26秒のお給仕時間になっていた。
  const shift = mapShift({ id: "s2", data: {
    maidId: "m1", maidNickname: "まゆら",
    openTime: timestamp("2026-07-27T12:00:00Z"), closeTime: timestamp("2026-07-27T17:00:00Z"),
    serveStartTime: [timestamp("2026-07-27T11:51:01Z"), timestamp("2026-07-27T12:30:00Z"), timestamp("2026-07-27T14:00:00Z")],
    serveEndTime: [timestamp("2026-07-27T11:51:27Z")],
  } })!;
  assert.equal(shift.actualStart, "2026-07-27T11:51:01.000Z");
  assert.equal(shift.actualEnd, null); // 予定の closeTime で補完される
});

test("mapShift: 終了が開始以前の記録は採用しない", () => {
  const shift = mapShift({ id: "s3", data: {
    maidId: "m1", maidNickname: "まゆら",
    openTime: timestamp("2026-07-21T12:00:00Z"), closeTime: timestamp("2026-07-21T17:00:00Z"),
    serveStartTime: [timestamp("2026-07-21T12:05:00Z")],
    serveEndTime: [timestamp("2026-07-21T12:00:00Z")],
  } })!;
  assert.equal(shift.actualEnd, null);
});

test("mapVisit: メイドを特定できない行は reject する（旧実装の nickname:unknown を廃止）", () => {
  // 旧実装は maidId も maidNickname も無い行に `nickname:unknown` を付けて集計へ混ぜていた。
  // 実在しないメイドの実績が積み上がるため、集計対象から外す。
  const visit = mapVisit({ id: "v", parentId: "u", data: {
    enterDateTime: timestamp("2026-07-21T10:00:00Z"), usedTicketItemId: "ATCOIN",
  } }, secret, new Map());
  assert.equal(visit, null);
});

test("mapShift: メイドを特定できないシフトは reject する", () => {
  const shift = mapShift({ id: "s", data: {
    openTime: timestamp("2026-07-21T12:00:00Z"), closeTime: timestamp("2026-07-21T17:00:00Z"),
  } }, new Map());
  assert.equal(shift, null);
});
