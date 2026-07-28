// メイド実績管理アプリ(app-vmaid-mgr)の「ALL(全体実績)」がローディングから進まない原因を特定する。
// アプリのバンドル(maid-salary-calculate の t5)は
//   1. maidWorkReport を全件取得
//   2. その各メイドについて monthlyReport をクエリ
// という扇状の読み取りをしている。全件ループのうち1件でも型が違う／欠けていると
// Promise.all が reject し、ローディングが解除されない。その1件を探す。
//
// 読み取り専用。本番データは一切変更しない。
//
// 使い方（Cloud Shell）:
//   cd services/analytics-sync && npm install
//   node diagnose-maid-all-view.mjs              # 直近2か月分の monthlyReport を検査
//   node diagnose-maid-all-view.mjs 2026-07      # 月を明示
//   node diagnose-maid-all-view.mjs 2026-07 all  # monthlyReport を全件検査（読み取り多め）

import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = (process.env.PRODUCTION_PROJECT_ID || "v-athome-cafe-app").trim();
const targetMonth = /^\d{4}-\d{2}$/.test(process.argv[2] || "") ? process.argv[2] : null;
const scanAll = process.argv.includes("all");

const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId }));

// 値の「形」を返す。JS 側で .toDate() や .split() を呼んで落ちるのは、この形が他と違う行。
function shapeOf(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (value === "") return "empty-string";
  if (Array.isArray(value)) return value.length ? "array" : "empty-array";
  if (typeof value === "object") {
    if (typeof value.toDate === "function") return "timestamp";
    if (value.constructor?.name === "DocumentReference") return "reference";
    return "map";
  }
  return typeof value;
}

// フィールドごとに「多数派の形」を求め、そこから外れた行を返す。
function findOutliers(docs) {
  const shapes = new Map(); // field -> Map(shape -> count)
  for (const { data } of docs) {
    for (const [key, value] of Object.entries(data)) {
      if (!shapes.has(key)) shapes.set(key, new Map());
      const bucket = shapes.get(key);
      const shape = shapeOf(value);
      bucket.set(shape, (bucket.get(shape) || 0) + 1);
    }
  }
  const majority = new Map();
  for (const [key, bucket] of shapes) {
    const [shape, count] = [...bucket.entries()].sort((a, b) => b[1] - a[1])[0];
    // 全体の6割以上が同じ形のときだけ「正しい形」とみなす（任意項目を誤検出しないため）。
    if (count / docs.length >= 0.6) majority.set(key, shape);
  }

  const outliers = [];
  for (const { path, data, label } of docs) {
    const bad = [];
    for (const [key, expected] of majority) {
      const actual = shapeOf(data[key]);
      if (actual !== expected) bad.push(`${key}: ${actual}（他は ${expected}）`);
    }
    if (bad.length) outliers.push({ path, label, bad });
  }
  return { majority, outliers, shapes };
}

const months = targetMonth
  ? [targetMonth]
  : (() => {
      const now = new Date(Date.now() + 9 * 3600000); // JST
      const out = [];
      for (let i = 0; i < 2; i += 1) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
        out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
      }
      return out;
    })();

console.log(`# project=${projectId}`);
console.log(`# 対象月: ${scanAll ? "全件" : months.join(", ")}`);

// ---------------------------------------------------------------- 1) 生成ログ
console.log("\n== 1) maidWorkReportGenerateLog（レポート生成の最終実行） ==");
try {
  const logSnap = await db.collection("maidWorkReportGenerateLog").orderBy("date", "desc").limit(5).get();
  if (logSnap.empty) {
    console.log("★ 1件もありません。レポート生成バッチが動いていない可能性があります。");
  } else {
    for (const doc of logSnap.docs) {
      const value = doc.get("date");
      const shown = value?.toDate ? value.toDate().toISOString() : String(value);
      console.log(`- ${doc.id}: date=${shown} (${shapeOf(value)})`);
    }
  }
} catch (error) {
  console.log(`★ 取得に失敗: ${error.message}`);
  console.log("   （date の降順インデックスが無い場合もここで失敗します）");
}

// ------------------------------------------------------- 2) maidWorkReport 本体
console.log("\n== 2) maidWorkReport（ALLが全件読み込むコレクション） ==");
const reportSnap = await db.collection("maidWorkReport").limit(5000).get();
console.log(`件数: ${reportSnap.size}`);

const reportDocs = reportSnap.docs.map((d) => ({
  path: d.ref.path,
  data: d.data(),
  label: d.get("nickname") || "",
  id: d.id,
}));

const report = findOutliers(reportDocs);
console.log(`共通フィールドの形: ${[...report.majority].map(([k, v]) => `${k}=${v}`).join(", ") || "なし"}`);
console.log(`\n★ 形が他と違うドキュメント: ${report.outliers.length}件`);
for (const row of report.outliers.slice(0, 30)) {
  console.log(`- ${row.path} (${row.label})`);
  for (const b of row.bad) console.log(`    ${b}`);
}
if (report.outliers.length > 30) console.log(`  …ほか ${report.outliers.length - 30} 件`);
if (!report.outliers.length) console.log("（なし）");

// ------------------------------------------------- 3) monthlyReport をメイド単位で
console.log("\n== 3) monthlyReport（メイドごとのサブコレクション） ==");
console.log("   ※ ALL は各メイドについてここを1回ずつ引きます。1件でも壊れると全体が止まります。");

const monthlyDocs = [];
const allMonthlyDocs = []; // 月の判定が外れたときの保険（追加の読み取りは発生しない）
const perMaid = [];
let failures = 0;

// ドキュメントIDにも月フィールドにも月が入り得るので、両方を見て対象月を判定する。
function matchesMonth(doc) {
  const candidates = [doc.id, doc.get("month"), doc.get("yearMonth"), doc.get("targetMonth")]
    .map((v) => (v?.toDate ? v.toDate().toISOString() : String(v ?? "")))
    .join(" ")
    .replace(/\//g, "-");
  return months.some((m) => candidates.includes(m));
}

for (const doc of reportDocs) {
  const started = Date.now();
  try {
    const snap = await db.collection(`maidWorkReport/${doc.id}/monthlyReport`).limit(500).get();
    const elapsed = Date.now() - started;
    const picked = scanAll ? snap.docs : snap.docs.filter(matchesMonth);
    for (const d of picked) {
      monthlyDocs.push({ path: d.ref.path, data: d.data(), label: doc.label });
    }
    for (const d of snap.docs) {
      allMonthlyDocs.push({ path: d.ref.path, data: d.data(), label: doc.label });
    }
    perMaid.push({ id: doc.id, label: doc.label, total: snap.size, matched: picked.length, elapsed });
  } catch (error) {
    failures += 1;
    perMaid.push({ id: doc.id, label: doc.label, error: error.message, elapsed: Date.now() - started });
  }
}

const missing = perMaid.filter((m) => !m.error && m.matched === 0);
const slow = [...perMaid].sort((a, b) => b.elapsed - a.elapsed).slice(0, 5);

console.log(`検査した monthlyReport: ${monthlyDocs.length}件 / メイド ${perMaid.length}人`);
console.log(`読み取り失敗: ${failures}件`);
for (const m of perMaid.filter((x) => x.error)) console.log(`  ★ ${m.id} (${m.label}): ${m.error}`);

// 全員0件なら「欠損」ではなく月の判定が外れているだけなので、その旨だけ出す。
if (monthlyDocs.length) {
  console.log(`\n★ 対象月の monthlyReport が0件のメイド: ${missing.length}件`);
  for (const m of missing.slice(0, 40)) console.log(`- maidWorkReport/${m.id} (${m.label}) 全体=${m.total}件`);
  if (missing.length > 40) console.log(`  …ほか ${missing.length - 40} 件`);
  if (!missing.length) console.log("（なし）");
}

const emptyMaids = perMaid.filter((m) => !m.error && m.total === 0);
console.log(`\n★ monthlyReport が1件も無いメイド: ${emptyMaids.length}件`);
for (const m of emptyMaids.slice(0, 40)) console.log(`- maidWorkReport/${m.id} (${m.label})`);
if (emptyMaids.length > 40) console.log(`  …ほか ${emptyMaids.length - 40} 件`);
if (!emptyMaids.length) console.log("（なし）");

console.log("\n遅かった上位5件（ミリ秒）:");
for (const m of slow) console.log(`- ${m.id} (${m.label}): ${m.elapsed}ms`);

// 対象月に1件も当たらなかったときは月の持ち方が想定と違うだけなので、全件で判定に切り替える。
let inspectTarget = monthlyDocs;
if (!monthlyDocs.length && allMonthlyDocs.length) {
  console.log("\n（対象月に一致する行がありませんでした。月の持ち方が想定と異なるため全件で検査します）");
  inspectTarget = allMonthlyDocs;
}

if (inspectTarget.length) {
  const monthly = findOutliers(inspectTarget);
  console.log(`\n検査対象: ${inspectTarget.length}件`);
  console.log(`\n共通フィールドの形: ${[...monthly.majority].map(([k, v]) => `${k}=${v}`).join(", ") || "なし"}`);
  console.log(`\n★ 形が他と違う monthlyReport: ${monthly.outliers.length}件`);
  console.log("   → ここに出た行が ALL を止めている最有力候補です");
  for (const row of monthly.outliers.slice(0, 30)) {
    console.log(`- ${row.path} (${row.label})`);
    for (const b of row.bad) console.log(`    ${b}`);
  }
  if (monthly.outliers.length > 30) console.log(`  …ほか ${monthly.outliers.length - 30} 件`);
  if (!monthly.outliers.length) console.log("（なし）");
}

console.log("\n----");
console.log("読み方:");
console.log("・2) や 3) の「形が他と違う」に出た行 → その1件が JS で例外を投げ、ALL 全体が止まります");
console.log("・3) の「読み取り失敗」 → 権限またはインデックス不足。メッセージの URL からインデックスを作成");
console.log("・どこにも異常が無く合計時間だけ長い → 読み取り件数そのものが原因（タイムアウト）");
process.exit(0);
