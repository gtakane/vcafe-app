// 本番Firestoreの任意コレクションのフィールド名を調べる読み取り専用スクリプト。
// ユーザーDBの拡張（課金履歴・アイテム購入/使用履歴・性別など）に必要なフィールド名を特定する用途。
// 何も書き込まない。
//
// 使い方（Cloud Shell）:
//   cd services/analytics-sync && npm install
//   node inspect-collection.mjs users        # 会員情報（性別・最終課金日などの有無を確認）
//   node inspect-collection.mjs payments     # 課金ログ
//   node inspect-collection.mjs purchaseLog  # 購入ログ
//   node inspect-collection.mjs items        # アイテム定義
//   node inspect-collection.mjs users --sub  # サブコレクション（購入/使用履歴）も1階層見る

import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = (process.env.PRODUCTION_PROJECT_ID || "v-athome-cafe-app").trim();
const name = process.argv[2];
const withSub = process.argv.includes("--sub");
const limit = Number(process.argv.find((a) => /^\d+$/.test(a)) || 3);
if (!name) { console.error("使い方: node inspect-collection.mjs <コレクション名> [--sub] [件数]"); process.exit(1); }

const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId }));

const preview = (value) => {
  if (value && typeof value === "object") {
    if (typeof value.toDate === "function") return `Timestamp(${value.toDate().toISOString()})`;
    if (Array.isArray(value)) return `Array(${value.length})${value.length ? ` 例:${JSON.stringify(value[0]).slice(0, 60)}` : ""}`;
    return `Object{${Object.keys(value).slice(0, 8).join(",")}}`;
  }
  const s = String(value);
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
};
const printFields = (data, indent) => {
  for (const key of Object.keys(data).sort()) console.log(`${indent}${key}: ${preview(data[key])}`);
};

// 引数に "コレクション/ドキュメントID" を渡した場合は、その1件だけを表示する。
if (name.includes("/")) {
  const doc = await db.doc(name).get();
  console.log(`# project=${projectId} doc=${name}`);
  if (!doc.exists) {
    console.log("★ このドキュメントは存在しません（アプリが undefined を掴む直接の原因になり得ます）");
    process.exit(0);
  }
  printFields(doc.data(), "    ");
  const subs = await doc.ref.listCollections();
  console.log(`    (subcollections: ${subs.map((c) => c.id).join(", ") || "なし"})`);
  process.exit(0);
}

// --latest を付けると、日付らしいフィールドを自動検出して新しい順に表示する。
const wantLatest = process.argv.includes("--latest");
const orderArg = (process.argv.find((a) => a.startsWith("--order=")) || "").split("=")[1];

console.log(`# project=${projectId} collection=${name}`);
let snapshot = null;
if (wantLatest || orderArg) {
  // 並び替え候補: 明示指定 → 1件目の日付らしいフィールド
  const probe = await db.collection(name).limit(1).get();
  const keys = probe.empty ? [] : Object.keys(probe.docs[0].data());
  const candidates = [orderArg, ...keys.filter((k) => /date|time|at$|created|updated/i.test(k))].filter(Boolean);
  for (const field of candidates) {
    try {
      const s = await db.collection(name).orderBy(field, "desc").limit(limit).get();
      if (!s.empty) { snapshot = s; console.log(`# 並び替え: ${field} 降順（新しい順）`); break; }
    } catch { /* このフィールドでは並び替え不可。次を試す */ }
  }
  if (!snapshot) console.log("# 並び替えできるフィールドが見つからなかったため未ソートで表示します");
}
if (!snapshot) snapshot = await db.collection(name).limit(limit).get();
if (snapshot.empty) {
  console.log("(0件) コレクション名を確認してください。トップレベル一覧:");
  for (const col of await db.listCollections()) console.log(`- ${col.id}`);
  process.exit(0);
}

// 全サンプルに出現したフィールド名の一覧も出す（ドキュメントごとに項目が違う場合の把握用）。
const allKeys = new Set();
for (const [i, doc] of snapshot.docs.entries()) {
  const data = doc.data();
  Object.keys(data).forEach((k) => allKeys.add(k));
  console.log(`\n[${i + 1}] path=${doc.ref.path}`);
  printFields(data, "    ");
  if (withSub) {
    const subs = await doc.ref.listCollections();
    console.log(`    (subcollections: ${subs.map((c) => c.id).join(", ") || "なし"})`);
    for (const sub of subs) {
      const subSnap = await sub.limit(2).get();
      console.log(`    └ "${sub.id}" のサンプル(${subSnap.size}件):`);
      subSnap.docs.forEach((sd, j) => {
        console.log(`      (${j + 1}) path=${sd.ref.path}`);
        printFields(sd.data(), "        ");
      });
    }
  }
}
console.log(`\n## 出現したフィールド名: ${[...allKeys].sort().join(", ")}`);
process.exit(0);
