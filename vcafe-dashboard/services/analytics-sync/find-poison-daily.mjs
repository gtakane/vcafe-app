// メイド実績管理アプリの All 表示を止めている「壊れた日次レポート」を特定する。
//
// アプリ側の変換処理は日次レポートの
//   workingStart[] / workingEnd[] / schedule_openTime[] / schedule_closeTime[]
// をペア前提で舐め、対応する要素が無いと be(undefined) で TypeError になり
// ローディングが永久に終わらなくなる。visits の enterDateTime が null の場合も同様。
// その条件に当てはまるドキュメントを全メイド分洗い出す（読み取り専用・本番は変更しない）。
//
// 使い方（Cloud Shell）:
//   cd services/analytics-sync && npm install
//   node find-poison-daily.mjs            # 直近2か月(当月・前月)を検査
//   node find-poison-daily.mjs 202607     # 月を明示
//   node find-poison-daily.mjs 202607 202606 202605

import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = (process.env.PRODUCTION_PROJECT_ID || "v-athome-cafe-app").trim();
const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId }));

const argMonths = process.argv.slice(2).filter((a) => /^\d{6}$/.test(a));
const months = argMonths.length
  ? argMonths
  : (() => {
      const now = new Date(Date.now() + 9 * 3600000); // JST
      const out = [];
      for (let i = 0; i < 2; i += 1) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
        out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
      }
      return out;
    })();

// アプリの be() が例外になる値: undefined / null（.seconds を読んで TypeError）。
// "" や文字列は Invalid Date になるだけで例外にはならないが、表示が壊れるので注意として報告。
const kills = (v) => v === undefined || v === null;
const warns = (v) => v === "" || (typeof v === "string" && v.length > 0);

const asArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

function checkPairs(name1, arr1raw, name2, arr2raw) {
  const issues = [];
  const a1 = asArray(arr1raw);
  const a2 = asArray(arr2raw);
  // アプリは a1 の添字で a2 を引くため、a2 が短いと be(undefined) で即死する。
  if (arr1raw && arr2raw !== undefined && arr2raw !== null && Array.isArray(arr2raw) && a1.length > a2.length) {
    issues.push(`★致命的: ${name1} が ${a1.length}件 / ${name2} が ${a2.length}件（不足分で be(undefined) → TypeError）`);
  }
  if ((arr1raw && kills(arr2raw)) || (arr2raw && kills(arr1raw))) {
    issues.push(`★致命的: ${name1}/${name2} の片方だけが null/未設定`);
  }
  for (const [nm, arr] of [[name1, a1], [name2, a2]]) {
    arr.forEach((v, i) => {
      if (kills(v)) issues.push(`★致命的: ${nm}[${i}] が null/undefined`);
      else if (warns(v)) issues.push(`注意: ${nm}[${i}] が文字列 "${v}"（Invalid Date になる）`);
    });
  }
  return issues;
}

console.log(`# project=${projectId}`);
console.log(`# 対象月: ${months.join(", ")}`);
console.log("# All表示は「全メイド × 対象月の daily × その日の visits」を読むため、");
console.log("# ここで★が1件でも出れば、それが All を止めている犯人です。\n");

const maidSnap = await db.collection("maidWorkReport").limit(5000).get();
console.log(`maidWorkReport: ${maidSnap.size}人`);

let dailyCount = 0;
let visitCount = 0;
const poison = [];

for (const maid of maidSnap.docs) {
  const nickname = maid.get("nickname") || "?";
  for (const month of months) {
    const dailyRef = db.collection(`maidWorkReport/${maid.id}/monthlyReport/${month}/daily`);
    let dailySnap;
    try {
      dailySnap = await dailyRef.limit(400).get();
    } catch (error) {
      poison.push({ path: `${dailyRef.path}`, nickname, issues: [`★致命的: 読み取り失敗 ${error.message}`] });
      continue;
    }
    for (const day of dailySnap.docs) {
      dailyCount += 1;
      const d = day.data();
      const issues = [
        ...checkPairs("workingStart", d.workingStart, "workingEnd", d.workingEnd),
        ...checkPairs("schedule_openTime", d.schedule_openTime, "schedule_closeTime", d.schedule_closeTime),
      ];
      if (issues.length) poison.push({ path: day.ref.path, nickname, issues });

      // その日の visits（Allはここまで読む）。enterDateTime が null だと be(null) で即死。
      let visitSnap;
      try {
        visitSnap = await day.ref.collection("visits").limit(500).get();
      } catch (error) {
        poison.push({ path: `${day.ref.path}/visits`, nickname, issues: [`★致命的: 読み取り失敗 ${error.message}`] });
        continue;
      }
      for (const visit of visitSnap.docs) {
        visitCount += 1;
        const v = visit.data();
        const vIssues = [];
        if (kills(v.enterDateTime)) vIssues.push("★致命的: enterDateTime が null/undefined");
        else if (warns(v.enterDateTime)) vIssues.push(`注意: enterDateTime が文字列 "${v.enterDateTime}"`);
        if (vIssues.length) poison.push({ path: visit.ref.path, nickname, issues: vIssues });
      }
    }
  }
}

console.log(`検査した daily: ${dailyCount}件 / visits: ${visitCount}件\n`);

const fatal = poison.filter((p) => p.issues.some((i) => i.startsWith("★")));
const warn = poison.filter((p) => !p.issues.some((i) => i.startsWith("★")));

console.log(`== ★致命的（Allを止めている候補）: ${fatal.length}件 ==`);
for (const p of fatal) {
  console.log(`\n- ${p.path} (${p.nickname})`);
  for (const i of p.issues) console.log(`    ${i}`);
}
if (!fatal.length) console.log("（なし）");

console.log(`\n== 注意（表示は乱れるが止まりはしない）: ${warn.length}件 ==`);
for (const p of warn.slice(0, 20)) {
  console.log(`- ${p.path} (${p.nickname}): ${p.issues.join(" / ")}`);
}
if (warn.length > 20) console.log(`  …ほか ${warn.length - 20} 件`);
if (!warn.length) console.log("（なし）");

console.log("\n----");
console.log("★が出た場合の復旧（そちらで実施をお願いします）:");
console.log("・配列の不足 → コンソールで該当ドキュメントを開き、足りない側に対応する時刻を追加");
console.log("  （例: workingEnd に close 時刻を1件追加）か、余分な要素を削除して長さを揃える");
console.log("・null の要素 → 正しい時刻に置き換えるか要素を削除");
console.log("・直したら All を再表示 → 復旧するはずです（デプロイ不要）");
process.exit(0);
