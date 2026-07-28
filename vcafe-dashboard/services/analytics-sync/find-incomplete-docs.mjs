// コレクション内で「他の大多数が持っているのに欠けている／空になっている」ドキュメントを洗い出す。
// フィールド名が分からなくても異常レコードを特定できる（読み取り専用・本番は変更しない）。
//
// 使い方（Cloud Shell）:
//   cd services/analytics-sync && npm install
//   node find-incomplete-docs.mjs maidWorkReport
//   node find-incomplete-docs.mjs maids
//   node find-incomplete-docs.mjs assetMaids
//   node find-incomplete-docs.mjs maids 5000 0.8   # 走査件数と「共通フィールド」とみなす割合
//
// 出力: 共通フィールド一覧と、それを欠く/空にしているドキュメントのパス。

import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = (process.env.PRODUCTION_PROJECT_ID || "v-athome-cafe-app").trim();
const name = process.argv[2];
const limit = Number(process.argv[3]) || 5000;
const threshold = Number(process.argv[4]) || 0.8;
if (!name) { console.error("使い方: node find-incomplete-docs.mjs <コレクション名> [走査件数] [共通とみなす割合]"); process.exit(1); }

const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId }));

// 空とみなす値（未設定・空文字・空配列）。0 や false は正当な値なので空扱いしない。
const isEmpty = (value) =>
  value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);

const snapshot = await db.collection(name).limit(limit).get();
if (snapshot.empty) { console.log(`(0件) コレクション "${name}" が見つかりません。`); process.exit(0); }

const total = snapshot.size;
const present = new Map();
for (const doc of snapshot.docs) {
  const data = doc.data();
  for (const [key, value] of Object.entries(data)) {
    if (!isEmpty(value)) present.set(key, (present.get(key) || 0) + 1);
  }
}
const common = [...present.entries()]
  .filter(([, count]) => count / total >= threshold)
  .map(([key]) => key)
  .sort();

console.log(`# project=${projectId} collection=${name} 走査=${total}件`);
console.log(`# 共通フィールド(${Math.round(threshold * 100)}%以上が保持): ${common.join(", ") || "なし"}`);
console.log(`# 出現率: ${[...present.entries()].sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k}=${Math.round(c / total * 100)}%`).join(", ")}`);

const bad = [];
for (const doc of snapshot.docs) {
  const data = doc.data();
  const missing = common.filter((key) => isEmpty(data[key]));
  if (missing.length) bad.push({ path: doc.ref.path, missing, nickname: data.nickname || data.name || "" });
}

console.log(`\n## 欠損のあるドキュメント: ${bad.length}件 / ${total}件`);
for (const row of bad.slice(0, 50)) {
  console.log(`- ${row.path}${row.nickname ? ` (${row.nickname})` : ""}  欠落: ${row.missing.join(", ")}`);
}
if (bad.length > 50) console.log(`  …ほか ${bad.length - 50} 件`);
if (!bad.length) console.log("（欠損なし。別のコレクションを調べてください）");
process.exit(0);
