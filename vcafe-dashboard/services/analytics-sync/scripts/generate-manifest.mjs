// schema.sql から列 manifest を生成する。手で編集せずこのスクリプトで再生成する。
//   node services/analytics-sync/scripts/generate-manifest.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(path.join(here, "..", "schema.sql"), "utf8");
const manifest = {};

for (const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS `PROJECT_ID\.DATASET_ID\.(\w+)` \(([\s\S]*?)\n\)/g)) {
  const [, table, body] = match;
  const columns = {};
  for (const raw of body.split("\n")) {
    const line = raw.trim().replace(/,$/, "");
    if (!line || line.startsWith("--")) continue;
    const parts = line.replaceAll("`", "").split(/\s+/);
    if (parts.length >= 2) columns[parts[0]] = parts[1];
  }
  manifest[table] = columns;
}
for (const match of sql.matchAll(/ALTER TABLE `PROJECT_ID\.DATASET_ID\.(\w+)`([\s\S]*?);/g)) {
  const [, table, body] = match;
  for (const add of body.matchAll(/ADD COLUMN IF NOT EXISTS (\w+) (\w+)/g)) {
    manifest[table] ??= {};
    manifest[table][add[1]] = add[2];
  }
}

const target = path.join(here, "..", "src", "schema-manifest.json");
writeFileSync(target, JSON.stringify({
  __doc__: "schema.sql から生成した列定義。手で編集せず scripts/generate-manifest.mjs で再生成する。",
  tables: manifest,
}, null, 2) + "\n");
console.log(`${Object.keys(manifest).length} テーブルの列定義を書き出しました`);
