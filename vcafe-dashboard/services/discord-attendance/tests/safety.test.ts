import assert from "node:assert/strict";
import test from "node:test";
import { resolveManagementProjectId } from "../src/safety.ts";

test("returns the management project id when isolation is satisfied", () => {
  const id = resolveManagementProjectId({ MANAGEMENT_PROJECT_ID: "vcafe-admin-analytics", PRODUCTION_PROJECT_ID: "v-athome-cafe-app" });
  assert.equal(id, "vcafe-admin-analytics");
});

test("requires MANAGEMENT_PROJECT_ID", () => {
  assert.throws(() => resolveManagementProjectId({ PRODUCTION_PROJECT_ID: "v-athome-cafe-app" }), /MANAGEMENT_PROJECT_ID/);
});

test("requires PRODUCTION_PROJECT_ID so the guard can never be skipped", () => {
  // 旧実装は PRODUCTION_PROJECT_ID 未設定でガードを素通りできた。今は必須。
  assert.throws(() => resolveManagementProjectId({ MANAGEMENT_PROJECT_ID: "vcafe-admin-analytics" }), /PRODUCTION_PROJECT_ID/);
});

test("rejects identical management and production projects", () => {
  assert.throws(
    () => resolveManagementProjectId({ MANAGEMENT_PROJECT_ID: "v-athome-cafe-app", PRODUCTION_PROJECT_ID: "v-athome-cafe-app" }),
    /同一/,
  );
});

test("rejects a known production project as management even if PRODUCTION_PROJECT_ID is set elsewhere", () => {
  // MANAGEMENT を本番、PRODUCTION を別IDにして同一チェックを迂回しても、既知本番リストで止める。
  assert.throws(
    () => resolveManagementProjectId({ MANAGEMENT_PROJECT_ID: "v-athome-cafe-app", PRODUCTION_PROJECT_ID: "some-other-project" }),
    /既知の本番/,
  );
});
