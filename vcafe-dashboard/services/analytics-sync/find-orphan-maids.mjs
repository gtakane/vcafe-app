// maidWorkReport（実績）と maids（プロフィール）で、片方にしか存在しないメイドIDを検出する。
// 「実績はあるがプロフィールが無い」メイドがいると、一覧表示で画像URLが assets/undefined になり
// 一覧全体の描画が止まることがある。読み取り専用（本番は変更しない）。
//
// 使い方（Cloud Shell）:
//   cd services/analytics-sync && npm install
//   node find-orphan-maids.mjs

import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = (process.env.PRODUCTION_PROJECT_ID || "v-athome-cafe-app").trim();
const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId }));

// IDだけあれば十分なので select() でフィールドを取得せず読み取りを最小化する。
const [reportSnap, maidSnap] = await Promise.all([
  db.collection("maidWorkReport").select().limit(5000).get(),
  db.collection("maids").select("nickname", "active", "thumbPreviewAssetId").limit(5000).get(),
]);

const reports = new Map(reportSnap.docs.map((d) => [d.id, true]));
const maids = new Map(maidSnap.docs.map((d) => [d.id, d.data()]));

console.log(`# project=${projectId}`);
console.log(`# maidWorkReport=${reports.size}件 / maids=${maids.size}件`);

const missingProfile = [...reports.keys()].filter((id) => !maids.has(id));
const missingReport = [...maids.keys()].filter((id) => !reports.has(id));

console.log(`\n## ★ 実績はあるがプロフィール(maids)が無い: ${missingProfile.length}件`);
console.log("   → 一覧表示で assets/undefined を要求し、全体が止まる原因になり得ます");
for (const id of missingProfile) console.log(`- maids/${id} が存在しない（maidWorkReport には存在）`);
if (!missingProfile.length) console.log("（なし）");

console.log(`\n## 参考: プロフィールはあるが実績(maidWorkReport)が無い: ${missingReport.length}件`);
for (const id of missingReport.slice(0, 30)) {
  const m = maids.get(id) || {};
  console.log(`- maids/${id} (${m.nickname || "?"}) active=${m.active}`);
}
if (missingReport.length > 30) console.log(`  …ほか ${missingReport.length - 30} 件`);
if (!missingReport.length) console.log("（なし）");

// 画像IDが空のプロフィールも念のため確認する。
const noThumb = [...maids.entries()].filter(([, m]) => !m.thumbPreviewAssetId);
console.log(`\n## 参考: thumbPreviewAssetId が空のメイド: ${noThumb.length}件`);
for (const [id, m] of noThumb) console.log(`- maids/${id} (${m.nickname || "?"})`);
if (!noThumb.length) console.log("（なし）");

process.exit(0);
