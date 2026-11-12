import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { includeTestUsersFrom, testUserCondition } from "../lib/test-users.ts";

test("テストユーザーを含めるのは管理者が ?testUsers=include を付けたときだけ", () => {
  assert.equal(includeTestUsersFrom("include", "admin"), true);
  assert.equal(includeTestUsersFrom("exclude", "admin"), false);
  assert.equal(includeTestUsersFrom(null, "admin"), false);
  assert.equal(includeTestUsersFrom("include", "maid"), false); // メイド画面の数値は変えない
});

test("SQL条件: 取り込み前の行（isTestUser が NULL）はテストユーザーではない扱い", () => {
  assert.equal(testUserCondition("v"), "(@includeTestUsers OR NOT COALESCE(v.isTestUser, FALSE))");
  assert.equal(testUserCondition(), "(@includeTestUsers OR NOT COALESCE(isTestUser, FALSE))");
});

/** テンプレート文字列の終わり（エスケープされた \` と ${...} の中のバッククォートは飛ばす）。 */
function templateEnd(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\\") { i += 1; continue; }
    if (depth === 0 && ch === "$" && text[i + 1] === "{") { depth = 1; i += 1; continue; }
    if (depth > 0) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === "`") { const close = text.indexOf("`", i + 1); if (close < 0) return -1; i = close; }
      continue;
    }
    if (ch === "`") return i;
  }
  return -1;
}

test("会員ごとの記録を読むクエリは、すべてテストユーザーの条件を通している", () => {
  // 新しいクエリを足したときに切り替えを付け忘れないための確認。
  // 対象: 会員単位の記録（ご帰宅・撮影・課金・プレゼント・予約招待・会員）を読む行。
  const userTables = /(visits_current|visits_current_range|payments_current|payments_current_range|customers_current|bookings_current|presents_current|cheki_raw)\b/;
  const files = ["data-source.ts", "growth.ts", "growth-insights.ts", "balances.ts", "customers.ts", "maid-visits.ts"];
  for (const file of files) {
    const source = readFileSync(new URL(`../lib/${file}`, import.meta.url), "utf8");
    // クエリ文字列（バッククォート区切り）ごとに確認する。
    const queries = source.split(/query:\s*`|run\(`|const registered = `/).slice(1).map((chunk) => {
      const end = templateEnd(chunk);
      assert.ok(end > 0, `${file}: クエリの終わりを見つけられません`);
      return chunk.slice(0, end);
    });
    assert.ok(queries.length > 0, `${file}: クエリが見つかりません`);
    for (const query of queries) {
      if (!userTables.test(query)) continue;
      assert.ok(/testUserCondition\(|tu\(|test-users: filtered-in-code|test-users: only/.test(query), `${file}: テストユーザーの条件が無いクエリ: ${query.slice(0, 120).replace(/\s+/g, " ")}`);
    }
  }
});
