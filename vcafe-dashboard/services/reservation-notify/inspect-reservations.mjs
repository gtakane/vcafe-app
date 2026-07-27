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

console.log(`\n## collectionGroup("${group}") のサンプル（最大5件・フィールド名確認）`);
const snap = await db.collectionGroup(group).limit(5).get();
if (snap.empty) {
  console.log("(0件) 別のコレクション名を引数で指定して再実行してください。例: node inspect-reservations.mjs reservations");
} else {
  snap.docs.forEach((doc, i) => {
    console.log(`\n[${i + 1}] path=${doc.ref.path}`);
    const data = doc.data();
    for (const key of Object.keys(data).sort()) console.log(`    ${key}: ${preview(data[key])}`);
  });
}
process.exit(0);
