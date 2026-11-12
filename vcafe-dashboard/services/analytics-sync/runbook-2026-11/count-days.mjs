// 本番Firestoreの営業日別ご帰宅件数（読み取りのみ・個人情報は出さない）。
// 使い方: node count-days.mjs 2026-10-18 2026-10-28   （営業日・両端含む）
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const [from = "2026-10-18", to = "2026-10-28"] = process.argv.slice(2);
const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId: "v-athome-cafe-app" }));
// 営業日D = JST D 2:00 〜 D+1 2:00 = UTC D-1 17:00 〜 D 17:00
const start = new Date(`${from}T17:00:00Z`); start.setUTCDate(start.getUTCDate() - 1);
const end = new Date(`${to}T17:00:00Z`);
const snap = await db.collectionGroup("userRecordVisits")
  .where("enterDateTime", ">=", Timestamp.fromDate(start))
  .where("enterDateTime", "<", Timestamp.fromDate(end))
  .get();
const days = new Map();
for (const doc of snap.docs) {
  const t = doc.get("enterDateTime").toDate().getTime() + 7 * 3600e3; // JST(+9h)から2時間引く
  const key = new Date(t).toISOString().slice(0, 10);
  days.set(key, (days.get(key) || 0) + 1);
}
console.log("営業日       Firestore件数");
for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
  const key = d.toISOString().slice(0, 10);
  console.log(`${key}   ${days.get(key) || 0}`);
}
process.exit(0);
