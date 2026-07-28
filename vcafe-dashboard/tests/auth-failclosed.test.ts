import assert from "node:assert/strict";
import test from "node:test";
import { resolveAuthMode } from "../lib/auth-mode.ts";

// 指摘1の再現テスト。AUTH_MODE の欠落・誤記だけで管理者になってはいけない。
// Cloud Run は --allow-unauthenticated のため、ここが fail-open だと全データが公開される。

const env = (over: Record<string, string | undefined>) => ({ NODE_ENV: "production", ...over });

test("AUTH_MODE 未設定は起動を拒否する（本番でデモ管理者にならない）", () => {
  assert.throws(() => resolveAuthMode(env({ AUTH_MODE: undefined })), /AUTH_MODE/);
});

test("AUTH_MODE の誤記は起動を拒否する", () => {
  assert.throws(() => resolveAuthMode(env({ AUTH_MODE: "firebse" })), /AUTH_MODE/);
  assert.throws(() => resolveAuthMode(env({ AUTH_MODE: "" })), /AUTH_MODE/);
  assert.throws(() => resolveAuthMode(env({ AUTH_MODE: "Firebase" })), /AUTH_MODE/); // 大小差も拒否
});

test("本番では demo を明示指定しても拒否する", () => {
  assert.throws(() => resolveAuthMode(env({ AUTH_MODE: "demo" })), /本番/);
});

test("本番以外で demo を明示指定したときだけデモを許可する", () => {
  assert.equal(resolveAuthMode({ NODE_ENV: "development", AUTH_MODE: "demo" }), "demo");
  assert.equal(resolveAuthMode({ NODE_ENV: "test", AUTH_MODE: "demo" }), "demo");
  // 明示しなければ開発でもデモにはしない
  assert.throws(() => resolveAuthMode({ NODE_ENV: "development", AUTH_MODE: undefined }), /AUTH_MODE/);
});

test("firebase は本番・非本番いずれでも有効", () => {
  assert.equal(resolveAuthMode(env({ AUTH_MODE: "firebase" })), "firebase");
  assert.equal(resolveAuthMode({ NODE_ENV: "development", AUTH_MODE: "firebase" }), "firebase");
});
