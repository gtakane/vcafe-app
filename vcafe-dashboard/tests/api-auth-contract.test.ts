import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// デプロイ後の確認項目「認証なしで機密データを取得できないこと」を、
// 実装側とスモークテスト側の両方から固定する。
//
// スモークテスト（smoke-test-revision.sh）は経路の一覧を手書きで持っている。
// 新しい API を足したときにその一覧へ追加し忘れると、
// 「スモークテストは全部OK、でも新しい経路は未認証で開いている」という
// 最悪の見落としが起きる。ここで実装とスモークテストを突き合わせて防ぐ。

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const API_DIR = join(ROOT, "app", "api");

/** app/api 以下の route.ts を再帰的に集め、URLパスへ変換する。 */
function findRoutes(dir: string, prefix = "/api"): Array<{ path: string; file: string }> {
  const found: Array<{ path: string; file: string }> = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...findRoutes(full, `${prefix}/${entry}`));
    } else if (entry === "route.ts") {
      found.push({ path: prefix, file: full });
    }
  }
  return found;
}

// ログイン経路そのものは未認証で叩けなければならない（セッションを作る側）。
const LOGIN_ROUTE = "/api/auth/session";

const routes = findRoutes(API_DIR);

test("APIルートを検出できている", () => {
  assert.ok(routes.length >= 6, `検出したルートが少なすぎる: ${routes.length}`);
  assert.ok(routes.some((route) => route.path === LOGIN_ROUTE), "ログイン経路を検出できていない");
});

test("ログイン以外の全APIが、データ取得より前に認証を確認している", () => {
  for (const route of routes) {
    if (route.path === LOGIN_ROUTE) continue;
    // import 文を除いた本体だけを見る。import は必ずファイル先頭にあるため、
    // 含めたまま位置を比べると「データ取得のほうが先」と誤判定する。
    const source = readFileSync(route.file, "utf8")
      .split("\n")
      .filter((line) => !/^\s*import\s/.test(line))
      .join("\n");

    const viewerAt = source.indexOf("getViewer()");
    assert.ok(viewerAt >= 0, `${route.path}: getViewer() を呼んでいない`);

    assert.match(source, /if \(!viewer\) return NextResponse\.json\([^)]*\{ status: 401 \}\)/,
      `${route.path}: 未認証で 401 を返していない`);

    // 認可の確認がデータ取得より前にあること。
    // 後ろにあると、認証エラーを返す前に BigQuery/Firestore を叩いてしまう。
    const dataAt = [
      source.indexOf("loadAnalyticsData"),
      source.indexOf("loadCustomers"),
      source.indexOf("loadGrowth"),
      source.indexOf("getFirestore"),
      source.indexOf("buildScopedVisitLogs"),
      source.indexOf("loadMaidReports"),
    ].filter((index) => index >= 0).sort((a, b) => a - b)[0];

    if (dataAt !== undefined) {
      assert.ok(viewerAt < dataAt,
        `${route.path}: 認証確認よりデータ取得が先に書かれている`);
    }
  }
});

test("スモークテストが全ての要認証APIを網羅している", () => {
  const smoke = readFileSync(join(ROOT, "smoke-test-revision.sh"), "utf8");
  const listed = new Set(
    [...smoke.matchAll(/^\s*"(\/api\/[a-z0-9/-]+)"\s*$/gm)].map((match) => match[1]),
  );
  assert.ok(listed.size > 0, "スモークテストから検査対象の経路を読み取れない");

  for (const route of routes) {
    if (route.path === LOGIN_ROUTE) continue;
    assert.ok(listed.has(route.path),
      `${route.path} が smoke-test-revision.sh の UNAUTH_401 に無い。追加してください`);
  }
});

test("スモークテストが存在しない経路を検査していない", () => {
  const smoke = readFileSync(join(ROOT, "smoke-test-revision.sh"), "utf8");
  const listed = [...smoke.matchAll(/^\s*"(\/api\/[a-z0-9/-]+)"\s*$/gm)].map((match) => match[1]);
  const actual = new Set(routes.map((route) => route.path));
  for (const path of listed) {
    assert.ok(actual.has(path), `smoke-test-revision.sh の ${path} は存在しない経路`);
  }
});

test("管理者専用APIが role を確認している", () => {
  // maid ロールで叩けてはいけない経路。403 を返すこと。
  const adminOnly = ["/api/customers", "/api/growth", "/api/attendance-submissions"];
  for (const path of adminOnly) {
    const route = routes.find((r) => r.path === path);
    assert.ok(route, `${path} が見つからない`);
    const source = readFileSync(route.file, "utf8");
    assert.match(source, /viewer\.role !== "admin"[\s\S]{0,120}\{ status: 403 \}/,
      `${path}: admin 以外を 403 で拒否していない`);
  }
});

test("デプロイスクリプトがIAMを変更しない", () => {
  // カナリア配備はIAMを触らない契約。--allow-unauthenticated も渡さない
  // （現行のIAMポリシーを保持する）。
  const deploy = readFileSync(join(ROOT, "deploy-revision-tokyo.sh"), "utf8");
  const statements = deploy.split("\n").filter((line) => !line.trim().startsWith("#"));
  const joined = statements.join("\n");
  assert.ok(!joined.includes("add-iam-policy-binding"), "IAMを変更している");
  assert.ok(!joined.includes("--allow-unauthenticated"), "--allow-unauthenticated を渡している");
  assert.ok(!joined.includes("--env-vars-file"), "環境変数を全置換している（--update-env-vars を使うこと）");
  assert.ok(joined.includes("--no-traffic"), "トラフィック0で配備していない");
  assert.ok(joined.includes("--revision-suffix"), "リビジョン名を固定していない");
  assert.ok(!joined.includes("firebase deploy"), "カナリア配備でHostingを切り替えている");
});
