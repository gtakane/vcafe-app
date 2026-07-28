import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { INSERT_TABLES, assertLiveSchema, findSchemaGaps, type LiveColumn } from "../src/schema-precheck.ts";
import { manifestColumns } from "../src/row-validation.ts";

// 2026-07-27 の事故の再現テスト。
//
// 何が起きたか:
//   apply-schema.sh（配備手順1）を実行しないまま新しい同期ジョブを実行した。
//   新コードは recordKey / runId を含む行を送るが、BigQuery 側にその列が無く、
//   ignoreUnknownValues:false のため **全テーブル**の挿入が PartialFailureError で失敗した。
//   ログには `INSERT_FAILED table=shifts_raw name=PartialFailureError message=` としか出ず、
//   「どの列が足りないのか」も「apply-schema.sh を実行すればよい」も分からなかった。
//
// なぜ row-validation.ts では防げなかったか:
//   validateRows は **manifest**（schema.sql 由来）と行を突き合わせる。
//   行も manifest も recordKey を持っているので検証は通る。
//   ずれていたのは manifest と **実際の BigQuery テーブル**の間だった。
//   つまり「行 vs 定義」ではなく「定義 vs 実体」を見る検査が無かった。
//
// ここで固定する契約: 実テーブルに manifest の列が無ければ、
// 1件も挿入しないうちに、理由と対処つきで停止する。

/** 手順1適用後の BigQuery（manifest 通り）。 */
function liveSchemaFromManifest(): LiveColumn[] {
  return INSERT_TABLES.flatMap((table) =>
    manifestColumns(table).map((column) => ({ table, column })),
  );
}

/** 手順1を実行していない BigQuery（recordKey / runId が無い旧スキーマ）。 */
function liveSchemaBeforeMigration(): LiveColumn[] {
  const legacy = new Set(["recordKey", "runId"]);
  return liveSchemaFromManifest().filter(({ column }) => !legacy.has(column));
}

test("再現: recordKey/runId が無い BigQuery を不足として検出する", () => {
  const gaps = findSchemaGaps(liveSchemaBeforeMigration());
  assert.ok(gaps.length > 0, "旧スキーマを不足として検出できていない");

  const visits = gaps.find((gap) => gap.table === "visits_raw");
  assert.ok(visits, "visits_raw の不足を検出できていない");
  assert.deepEqual(visits.missing.sort(), ["recordKey", "runId"]);

  // 事故時は6テーブルすべてが失敗した。検出も全テーブルに及ぶこと。
  for (const table of ["visits_raw", "cheki_raw", "shifts_raw", "payments_raw", "presents_raw", "customers_raw"]) {
    assert.ok(gaps.some((gap) => gap.table === table), `${table} の不足を検出できていない`);
  }
});

test("再現: 停止時のメッセージに不足列と対処法が含まれる", () => {
  assert.throws(
    () => assertLiveSchema(liveSchemaBeforeMigration()),
    (error: Error) => {
      // ログを grep する運用のため、機械可読な接頭辞を必ず付ける。
      assert.match(error.message, /^SCHEMA_PRECHECK_FAILED/);
      // どの列が足りないのかが分かること（PartialFailureError には出ていなかった）。
      assert.match(error.message, /不足列: .*recordKey/);
      // 次に何をすればよいかが書いてあること。
      assert.match(error.message, /apply-schema\.sh/);
      return true;
    },
  );
});

test("手順1適用後のスキーマなら通過する", () => {
  assert.deepEqual(findSchemaGaps(liveSchemaFromManifest()), []);
  assert.doesNotThrow(() => assertLiveSchema(liveSchemaFromManifest()));
});

test("テーブルごと存在しない場合も理由つきで止める", () => {
  const live = liveSchemaFromManifest().filter(({ table }) => table !== "sync_runs");
  const gaps = findSchemaGaps(live);
  const gap = gaps.find((g) => g.table === "sync_runs");
  assert.ok(gap, "存在しないテーブルを検出できていない");
  assert.equal(gap.tableMissing, true);
  assert.throws(() => assertLiveSchema(live), /sync_runs: テーブルがありません/);
});

test("manifest に無い余分な列があっても止めない", () => {
  // 手作業で足された列や、先行して追加された列で同期を止めるのは過剰。
  // 「不足」だけを失敗条件にする（挿入が失敗するのは不足のときだけ）。
  const live = [...liveSchemaFromManifest(), { table: "visits_raw", column: "experimentalFlag" }];
  assert.deepEqual(findSchemaGaps(live), []);
});

test("大文字小文字は区別しない（BigQuery の列名照合に合わせる）", () => {
  const live = liveSchemaFromManifest().map(({ table, column }) => ({ table, column: column.toUpperCase() }));
  assert.deepEqual(findSchemaGaps(live), []);
});

test("insertRows が使う全テーブルが事前検査の対象に入っている", () => {
  // 検査対象の取りこぼしは「事故を防げない事前検査」になる。
  // index.ts の insertRows("...") 呼び出しを走査して、対象漏れが無いことを固定する。
  const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const used = [...source.matchAll(/insertRows\(\s*"([a-z_]+)"/g)].map((match) => match[1]);
  assert.ok(used.length >= 6, `insertRows の呼び出しを検出できていない (${used.length}件)`);
  for (const table of new Set(used)) {
    assert.ok(INSERT_TABLES.includes(table as (typeof INSERT_TABLES)[number]),
      `${table} が INSERT_TABLES に無い。事前検査の対象から漏れている`);
  }
});
