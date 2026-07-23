import assert from "node:assert/strict";
import test from "node:test";
import { mapFirestoreUser } from "../lib/user-mapping.ts";

const registrationDate = { toDate: () => new Date("2024-06-17T11:00:10.000Z") };

test("maps the confirmed production user fields", () => {
  assert.deepEqual(mapFirestoreUser("user-1", { nickname: "ご主人様", rank: "ゴールド", registrationDate }), {
    id: "user-1", name: "ご主人様", rank: "ゴールド", registeredAt: "2024-06-17T11:00:10.000Z",
  });
});

test("excludes testUser", () => {
  assert.equal(mapFirestoreUser("user-1", { nickname: "test", rank: "test", registrationDate, testUser: true }), null);
});

test("excludes the existing misspelled testUesrFlag field", () => {
  assert.equal(mapFirestoreUser("user-1", { nickname: "test", rank: "test", registrationDate, testUesrFlag: true }), null);
});

test("keeps a real user whose registrationDate is missing", () => {
  assert.deepEqual(mapFirestoreUser("user-1", { nickname: "unknown", rank: "未設定" }), {
    id: "user-1", name: "unknown", rank: "未設定", registeredAt: null,
  });
});
