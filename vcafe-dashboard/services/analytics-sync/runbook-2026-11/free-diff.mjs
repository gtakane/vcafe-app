// 11/6以降の無料ご帰宅を本番Firestoreで種類別に数え、テストユーザー分を分けて表示する（読み取りのみ）。
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId: "v-athome-cafe-app" }));
const start = Timestamp.fromDate(new Date("2026-11-05T17:00:00Z")); // 営業日 11/6 の開始（JST 2:00）
const snap = await db.collectionGroup("userRecordVisits").where("enterDateTime", ">=", start).get();
const isTrue = (v) => v === true || v === "true";
const visits = snap.docs.filter((d) => isTrue(d.get("isFreeEntry")) || d.get("usedTicketItemId") === "trial10minutes");
const userIds = [...new Set(visits.map((d) => d.ref.parent.parent.id))];
const testUsers = new Set();
for (let i = 0; i < userIds.length; i += 100) {
  const refs = userIds.slice(i, i + 100).map((id) => db.doc(`users/${id}`));
  for (const u of await db.getAll(...refs)) {
    if (u.exists && (isTrue(u.get("testUser")) || isTrue(u.get("testUesrFlag")))) testUsers.add(u.id);
  }
}
const rows = new Map();
for (const d of visits) {
  const kind = d.get("entryType") || (d.get("usedTicketItemId") === "trial10minutes" ? "trial" : "(種類なし)");
  const r = rows.get(kind) || { all: 0, test: 0 };
  r.all += 1;
  if (testUsers.has(d.ref.parent.parent.id)) r.test += 1;
  rows.set(kind, r);
}
console.log("種類            全件  うちテストユーザー  テスト除く");
for (const [kind, r] of [...rows].sort()) console.log(`${kind.padEnd(15)} ${String(r.all).padStart(4)}  ${String(r.test).padStart(16)}  ${String(r.all - r.test).padStart(9)}`);
process.exit(0);
