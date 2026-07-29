import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { manifestColumns, manifestTables } from "../src/row-validation.ts";

// check-bigquery-schema.sh の誤報告の再現テスト。
//
// 何が起きたか:
//   配備手順1（apply-schema.sh）を正しく実行したあとに検証したのに、
//   11テーブルすべてが「BigQuery に存在しない（schema.sql 未適用の可能性）」と
//   報告された。BigQuery は正常で、壊れていたのは検証スクリプトのほうだった。
//
// 原因:
//   スクリプトは以下のように書かれていた。
//
//       echo "${ACTUAL}" | python3 - manifest.json <<'PY' ... PY
//
//   `python3 -` は **プログラムを標準入力から読む**。ヒアドキュメントが標準入力を
//   占有するため、パイプで渡した CSV は Python に届かない。
//   sys.stdin.read() は常に空文字列を返し、比較対象0件のまま
//   「manifest の全テーブルが存在しない」と結論していた。
//
// ここで固定する契約:
//   1. 比較対象が0件なら、それを「差分」ではなく「比較できていない」と報告する。
//   2. 実データを渡せば正しく判定できる。
//   3. シェルスクリプトで同じヒアドキュメント誤用を再発させない。

const SYNC_DIR = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(SYNC_DIR, "scripts", "compare-schema.py");
const MANIFEST = join(SYNC_DIR, "src", "schema-manifest.json");

function runCompare(csv: string) {
  const dir = mkdtempSync(join(tmpdir(), "vcafe-schema-"));
  const file = join(dir, "actual.csv");
  writeFileSync(file, csv, "utf8");
  const result = spawnSync("python3", [SCRIPT, MANIFEST, file], { encoding: "utf8" });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

/** BigQuery が manifest どおりの列を返した場合の CSV。 */
function csvFromManifest(): string {
  return manifestTables()
    .flatMap((table) => manifestColumns(table).map((column) => `${table},${column}`))
    .join("\n");
}

test("再現: 比較対象が0件のとき「全テーブルが無い」と報告しない", () => {
  const { status, out } = runCompare("");
  assert.notEqual(status, 0, "0件でも成功扱いになっている");
  // 事故時の誤ったメッセージが出ないこと。
  assert.ok(!out.includes("BigQuery に存在しない"), `比較0件を差分として報告している:\n${out}`);
  assert.ok(!out.includes("差分 11 件"), `比較0件を差分として報告している:\n${out}`);
  // 代わりに「比較できていない」と分かること。
  assert.match(out, /列情報を1件も受け取れませんでした/);
  assert.match(out, /比較そのものが行えていません/);
});

test("manifest どおりの実スキーマなら一致と判定する", () => {
  const { status, out } = runCompare(csvFromManifest());
  assert.equal(status, 0, out);
  assert.match(out, /manifest と BigQuery のスキーマは一致しています。/);
});

test("列が欠けていれば、その列名を挙げて失敗する", () => {
  const csv = csvFromManifest()
    .split("\n")
    .filter((line) => line !== "visits_raw,recordKey")
    .join("\n");
  const { status, out } = runCompare(csv);
  assert.notEqual(status, 0);
  assert.match(out, /visits_raw: BigQuery に無い列 \['recordKey'\]/);
});

test("ヘッダ行が残っていても誤判定しない", () => {
  const { status, out } = runCompare(`table_name,column_name\n${csvFromManifest()}`);
  assert.equal(status, 0, out);
});

test("bq のエラー文言を列情報として飲み込まない", () => {
  // 2>/dev/null をすり抜けて stdout にエラーが出た場合、
  // それを「1件の列情報」として扱うと 0件チェックもすり抜けてしまう。
  const { status, out } = runCompare("BigQuery error in query operation: Not found: Dataset");
  assert.notEqual(status, 0);
  assert.match(out, /想定外の行を受け取りました/);
});

test("check-bigquery-schema.sh は bq query に --location と --max_rows を指定している", () => {
  // 2026-07-29 の再発防止。
  // --location を省略すると既定ロケーション(US)で探しに行き、asia-northeast1 の
  // データセットが「見つからない」扱いになる。
  // --max_rows を省略すると既定の100行までしか取れず、テーブル数×列数がそれを
  // 超えると後半のテーブルが黙って欠落し、実在するテーブルを
  // 「BigQuery に存在しない」と誤報告する（schema.sql は適用済みだった）。
  const source = readFileSync(join(SYNC_DIR, "check-bigquery-schema.sh"), "utf8");
  const line = source.split("\n").find((l) => l.trimStart().startsWith('ACTUAL="$(bq'));
  assert.ok(line, "INFORMATION_SCHEMA.COLUMNS を取得する bq query 行が見つからない");
  assert.match(line!, /--location="\$\{LOCATION\}"/, "--location が指定されていない");
  assert.match(line!, /--max_rows=\d{4,}/, "--max_rows が指定されていない（既定100行では大規模スキーマで欠落する）");
});

test("シェルスクリプトが閾値判定に `bc` を使っていない", () => {
  // 2026-07-29 の再発防止。
  // `bc` が入っていない環境（実際に発生）では `$(... | bc -l)` が空文字を返し、
  // `(( "" ))` は構文エラーで常に偽になる。つまり閾値超過があっても常に「pass」に
  // 落ち、しかもエラーはstderrに流れるだけで status には出ない。
  // analytics-audit.sh はこの誤判定のまま dq_results に10件記録していた
  // （orphan_maid_ids=31, revenue_outliers=46 がいずれも閾値0超過なのに pass 扱い）。
  // awk はどこにでもあるので、閾値比較には awk を使う。
  const scripts = readdirSync(SYNC_DIR).filter((name) => name.endsWith(".sh"));
  assert.ok(scripts.length > 0, "検査対象のシェルスクリプトが見つからない");
  for (const name of scripts) {
    const source = readFileSync(join(SYNC_DIR, name), "utf8");
    const codeLines = source.split("\n").filter((l) => !l.trimStart().startsWith("#"));
    for (const line of codeLines) {
      assert.ok(
        !/\bbc\s+-l\b|\|\s*bc\b/.test(line),
        `${name}: bc に依存した比較がある。bc が無い環境では常に「pass」に落ちる:\n  ${line.trim()}`,
      );
    }
  }
});

test("シェルスクリプトが `python3 -` とヒアドキュメントでデータを渡していない", () => {
  // 同じ誤用の再発防止。`python3 -` はプログラムを標準入力から読むため、
  // ヒアドキュメントと同時にパイプでデータを渡すと、データは必ず失われる。
  const scripts = readdirSync(SYNC_DIR).filter((name) => name.endsWith(".sh"));
  assert.ok(scripts.length > 0, "検査対象のシェルスクリプトが見つからない");
  for (const name of scripts) {
    const source = readFileSync(join(SYNC_DIR, name), "utf8");
    for (const line of source.split("\n")) {
      const pipesIntoStdinPython = /\|\s*python3\s+-\s/.test(line);
      const hasHeredoc = /<<-?\s*['"]?\w+['"]?/.test(line);
      assert.ok(
        !(pipesIntoStdinPython && hasHeredoc),
        `${name}: パイプで渡したデータがヒアドキュメントに奪われる:\n  ${line.trim()}`,
      );
    }
  }
});
