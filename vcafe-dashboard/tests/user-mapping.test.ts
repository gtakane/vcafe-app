import assert from "node:assert/strict";
import test from "node:test";
import { mapFirestoreUser } from "../lib/user-mapping.ts";

const registrationDate = { toDate: () => new Date("2024-06-17T11:00:10.000Z") };

test("maps the confirmed production user fields", () => {
  const mapped = mapFirestoreUser("user-1", { nickname: "ご主人様", rank: "ゴールド", registrationDate })!;
  assert.equal(mapped.id, "user-1");
  assert.equal(mapped.name, "ご主人様");
  assert.equal(mapped.rank, "ゴールド");
  assert.equal(mapped.registeredAt, "2024-06-17T11:00:10.000Z");
});

test("maps the extended user profile fields (gender/課金/アイテム/プレゼント)", () => {
  const ts = (iso: string) => ({ toDate: () => new Date(iso) });
  const mapped = mapFirestoreUser("user-2", {
    nickname: "たいちょう", rank: "silver", registrationDate,
    gender: "male",
    birthdate: [1990, 2, 16],
    active: true,
    lastVisitDate: ts("2022-01-19T16:18:05.954Z"),
    lastPaymentDate: ts("2022-01-19T13:07:47.512Z"),
    lastPurchasedItemDate: ts("2022-01-19T16:49:42.191Z"),
    lastPresentDate: ts("2022-01-19T16:51:07.407Z"),
    purchasedItemAmountCoin: 300,
    purchasedItemAmountRewardPoint: 0,
    purchasedItemTotalQuantity: 1,
    presentAmount: 1,
    coin: 530,
    rewardPoint: 230,
    visitAmount: 3,
    consecutiveVisitDays: 1,
    maxConsecutiveVisitDays: 2,
  })!;
  assert.equal(mapped.gender, "male");
  assert.equal(mapped.birthYear, 1990);
  assert.equal(mapped.active, true);
  assert.equal(mapped.lastPaymentAt, "2022-01-19T13:07:47.512Z");
  assert.equal(mapped.lastPurchasedItemAt, "2022-01-19T16:49:42.191Z");
  assert.equal(mapped.lastPresentAt, "2022-01-19T16:51:07.407Z");
  assert.equal(mapped.purchasedItemCoin, 300);
  assert.equal(mapped.purchasedItemQuantity, 1);
  assert.equal(mapped.presentAmount, 1);
  assert.equal(mapped.coin, 530);
  assert.equal(mapped.totalVisitAmount, 3);
  assert.equal(mapped.maxConsecutiveVisitDays, 2);
});

test("未設定の付加項目は null（0と区別する）", () => {
  const mapped = mapFirestoreUser("user-3", { nickname: "新人", rank: "bronze", registrationDate })!;
  assert.equal(mapped.gender, null);
  assert.equal(mapped.lastPaymentAt, null); // 一度も課金していない
  assert.equal(mapped.purchasedItemCoin, null);
  assert.equal(mapped.birthYear, null);
});

test("excludes testUser", () => {
  assert.equal(mapFirestoreUser("user-1", { nickname: "test", rank: "test", registrationDate, testUser: true }), null);
});

test("excludes the existing misspelled testUesrFlag field", () => {
  assert.equal(mapFirestoreUser("user-1", { nickname: "test", rank: "test", registrationDate, testUesrFlag: true }), null);
});

test("keeps a real user whose registrationDate is missing", () => {
  const mapped = mapFirestoreUser("user-1", { nickname: "unknown", rank: "未設定" })!;
  assert.equal(mapped.id, "user-1");
  assert.equal(mapped.name, "unknown");
  assert.equal(mapped.rank, "未設定");
  assert.equal(mapped.registeredAt, null);
});
