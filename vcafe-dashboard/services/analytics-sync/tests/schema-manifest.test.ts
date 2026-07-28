import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { manifestColumns, manifestTables } from "../src/row-validation.ts";

// 指摘11の一部。manifest と schema.sql のずれを CI で検出する。
// BigQuery への接続なしで「manifest が schema.sql から再生成された最新版か」を検証できる。
// 実データセットとの照合は scripts/check-bigquery-schema.sh（要BigQuery接続）で行う。

const sql = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");

/** schema.sql を素朴に解析して列一覧を得る（generate-manifest.mjs と同じ規則）。 */
function parseSchema(): Record<string, Set<string>> {
  const tables: Record<string, Set<string>> = {};
  for (const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS `PROJECT_ID\.DATASET_ID\.(\w+)` \(([\s\S]*?)\n\)/g)) {
    const [, table, body] = match;
    const columns = new Set<string>();
    for (const raw of body.split("\n")) {
      const line = raw.trim().replace(/,$/, "");
      if (!line || line.startsWith("--")) continue;
      const parts = line.replaceAll("`", "").split(/\s+/);
      if (parts.length >= 2) columns.add(parts[0]);
    }
    tables[table] = columns;
  }
  for (const match of sql.matchAll(/ALTER TABLE `PROJECT_ID\.DATASET_ID\.(\w+)`([\s\S]*?);/g)) {
    const [, table, body] = match;
    for (const add of body.matchAll(/ADD COLUMN IF NOT EXISTS (\w+) (\w+)/g)) {
      (tables[table] ??= new Set()).add(add[1]);
    }
  }
  return tables;
}

test("manifest が schema.sql と一致する（再生成漏れの検出）", () => {
  const parsed = parseSchema();
  const manifestNames = new Set(manifestTables());

  for (const table of Object.keys(parsed)) {
    assert.ok(manifestNames.has(table), `schema.sql の ${table} が manifest に無い。npm run schema:manifest を実行してください`);
    const expected = [...parsed[table]].sort();
    const actual = manifestColumns(table).sort();
    assert.deepEqual(actual, expected, `${table} の列が manifest とずれている。npm run schema:manifest を実行してください`);
  }
  for (const table of manifestNames) {
    assert.ok(table in parsed, `manifest の ${table} が schema.sql に無い（削除された表が残っている）`);
  }
});

// 文中の説明文にマッチしないよう、行頭のステートメントだけを対象にする。
const statementLines = (keyword: string) =>
  sql.split("\n").map((line, index) => ({ line, index })).filter(({ line }) => line.startsWith(keyword)).map(({ index }) => index);

test("schema.sql の適用順序が壊れていない（ALTER がビューより前）", () => {
  const views = statementLines("CREATE OR REPLACE VIEW");
  const alters = statementLines("ALTER TABLE");
  assert.ok(views.length > 0 && alters.length > 0);
  assert.ok(Math.max(...alters) < Math.min(...views), "ALTER TABLE がビュー定義より後にある。ビューが未作成の列を参照して失敗する");
});

test("schema.sql の CREATE TABLE がすべて ALTER より前にある", () => {
  const creates = statementLines("CREATE TABLE IF NOT EXISTS");
  const alters = statementLines("ALTER TABLE");
  assert.ok(creates.length > 0 && alters.length > 0);
  assert.ok(Math.max(...creates) < Math.min(...alters), "CREATE TABLE が ALTER より後にある。未作成の表へ ALTER して失敗する");
});
