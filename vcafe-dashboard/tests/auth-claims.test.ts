import assert from "node:assert/strict";
import test from "node:test";
import { buildCustomClaims, validateClaimRequest } from "../lib/auth-claims.ts";

test("builds admin claims and removes a stale maidId", () => {
  assert.deepEqual(buildCustomClaims({ maidId: "old-maid", feature: "keep" }, { uid: "testAdminUid_12345", role: "admin" }), { feature: "keep", role: "admin" });
});

test("requires a maidId for maid claims", () => {
  assert.throws(() => validateClaimRequest({ uid: "testMaidUid_123456", role: "maid" }), /maidId/);
});

test("builds maid claims without losing unrelated claims", () => {
  assert.deepEqual(buildCustomClaims({ feature: "keep" }, { uid: "testMaidUid_123456", role: "maid", maidId: "maid-01" }), { feature: "keep", role: "maid", maidId: "maid-01" });
});

test("rejects an unsupported role", () => {
  assert.throws(() => validateClaimRequest({ uid: "testAdminUid_12345", role: "owner" as "admin" }), /role/);
});
