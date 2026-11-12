import assert from "node:assert/strict";
import test from "node:test";
import { excludedMaidIdsFrom, withoutExcludedMaids } from "../src/excluded-maids.ts";

test("EXCLUDED_MAID_IDS をカンマ区切りで読み、空白と空要素を無視する", () => {
  assert.deepEqual([...excludedMaidIdsFrom({ EXCLUDED_MAID_IDS: " maid-a, ,maid-b " })], ["maid-a", "maid-b"]);
  assert.equal(excludedMaidIdsFrom({}).size, 0);
});

test("除外対象のメイドの行だけを取り除く（未指定なら何もしない）", () => {
  const rows = [{ maidId: "maid-a" }, { maidId: "test-maid" }, { maidId: "maid-b" }];
  assert.deepEqual(withoutExcludedMaids(rows, new Set(["test-maid"]), (r) => r.maidId), [{ maidId: "maid-a" }, { maidId: "maid-b" }]);
  assert.equal(withoutExcludedMaids(rows, new Set(), (r) => r.maidId), rows);
});

test("同期本体が全メイド系テーブルの挿入で除外を通している", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  for (const table of ["visits_raw", "cheki_raw", "shifts_raw", "presents_raw", "maid_profiles_raw", "maid_monthly_raw"]) {
    const line = source.split("\n").find((l) => l.includes(`insertRows("${table}"`));
    assert.ok(line?.includes("withoutExcludedMaids"), `${table} の挿入でテスト用メイドを除外していない`);
  }
});
