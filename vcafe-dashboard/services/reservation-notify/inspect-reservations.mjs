// 本番Firestoreの予約データの在り処とフィールド名を調べる読み取り専用スクリプト。
// Cloud Shell（本番read権限のあるSA/ユーザー）で実行する:
//   cd services/reservation-notify && npm install
//   PRODUCTION_PROJECT_ID=v-athome-cafe-app node inspect-reservations.mjs [collectionGroup]
// 例: node inspect-reservations.mjs reservations
// 何も書き込まない。予約コレクション名と主要フィールド（担当メイド/予約日時/顧客/作成時刻）を確認する用途。

import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.PRODUCTION_PROJECT_ID || "v-athome-cafe-app";
const group = process.argv[2] || process.env.RESERVATION_COLLECTION_GROUP || "userRecordVisits";
const app = initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore(app);

const preview = (value) => {
  if (value && typeof value === "object") {
    if (typeof value.toDate === "function") return `Timestamp(${value.toDate().toISOString()})`;
    if (Array.isArray(value)) return `Array(${value.length})`;
    return "Object";
  }
  const s = String(value);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
};

console.log(`# project=${projectId}`);
console.log("\n## トップレベルのコレクション一覧（予約コレクション名の当たりを付ける）");
for (const col of await db.listCollections()) console.log(`- ${col.id}`);

function printFields(data, indent) {
  for (const key of Object.keys(data).sort()) console.log(`${indent}${key}: ${preview(data[key])}`);
}

// 予約は workshiftGroups/{availabledate順} 配下の "reservations" サブコレクションに入る想定。
// availabledate 降順で最新日を見て、reservations サブコレクションの有無と中身を検証する。
const orderField = process.argv[3] || "availabledate";
let snap;
try {
  snap = await db.collection(group).orderBy(orderField, "desc").limit(8).get();
  console.log(`\n## collection("${group}").orderBy("${orderField}","desc") のサンプル（最大8件・サブコレクションも確認）`);
} catch (error) {
  console.log(`\n## "${orderField}" で並び替えできなかったため未ソートで表示: ${error.message}`);
  snap = await db.collection(group).limit(8).get();
}

if (snap.empty) {
  console.log(`(0件) collection "${group}" が見つかりません。名前を引数で指定して再実行してください。`);
} else {
  for (const [i, doc] of snap.docs.entries()) {
    const data = doc.data();
    console.log(`\n[${i + 1}] path=${doc.ref.path}  ${orderField}=${preview(data[orderField])}`);
    printFields(data, "    ");
    const subs = await doc.ref.listCollections();
    console.log(`    (subcollections: ${subs.map((c) => c.id).join(", ") || "なし"})`);
    for (const sub of subs) {
      const subSnap = await sub.limit(3).get();
      console.log(`    └ "${sub.id}" のサンプル(${subSnap.size}件):`);
      subSnap.docs.forEach((sd, j) => {
        console.log(`      (${j + 1}) path=${sd.ref.path}`);
        printFields(sd.data(), "        ");
      });
    }
  }
}
process.exit(0);
