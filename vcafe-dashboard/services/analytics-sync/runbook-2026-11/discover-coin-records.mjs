// コインが消費される記録（予約・アイテム購入など）がどこにあるかを調べる（本番Firestore・読み取りのみ）。
// 10月にご帰宅したユーザーのサブコレクション名を集め、各コレクションの項目名と値の種類を数える。
// 個人名・ID・メール等の項目は値を表示しない。
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId: "v-athome-cafe-app" }));
const SKIP = /name|nick|uid|userid|author|mail|token|address|phone|birth|^id$|Id$/i;

const visits = await db.collectionGroup("userRecordVisits")
  .where("enterDateTime", ">=", Timestamp.fromDate(new Date("2026-10-01T00:00:00Z")))
  .where("enterDateTime", "<", Timestamp.fromDate(new Date("2026-10-08T00:00:00Z"))).limit(400).get();
const users = [...new Set(visits.docs.map((d) => d.ref.parent.parent.id))].slice(0, 40);

const subNames = new Map();
for (const id of users) {
  for (const col of await db.doc(`users/${id}`).listCollections()) subNames.set(col.id, (subNames.get(col.id) || 0) + 1);
}
console.log("=== 10月にご帰宅したユーザー40人が持つサブコレクション（持っている人数） ===");
for (const [name, n] of [...subNames].sort((a, b) => b[1] - a[1])) console.log(`  ${name}: ${n}人`);

const topCols = await db.listCollections();
console.log("\n=== 最上位のコレクション ===");
console.log("  " + topCols.map((c) => c.id).join(", "));

function tally(docs, title) {
  const presence = new Map(), values = new Map();
  for (const d of docs) for (const [k, v] of Object.entries(d)) {
    presence.set(k, (presence.get(k) || 0) + 1);
    if (SKIP.test(k) || v === null || typeof v === "object") continue;
    const m = values.get(k) || new Map(); const key = String(v).slice(0, 40);
    m.set(key, (m.get(key) || 0) + 1); values.set(k, m);
  }
  console.log(`\n##### ${title}（${docs.length}件）`);
  for (const k of [...presence.keys()].sort()) {
    const m = values.get(k);
    const shown = m && m.size <= 12 ? " 値: " + [...m].sort((a, b) => b[1] - a[1]).map(([x, n]) => `${x}=${n}`).join(", ") : (m ? ` (値の種類 ${m.size})` : "");
    console.log(`  ${k}: ${presence.get(k)}件${shown}`);
  }
}
const SKIP_COLS = new Set(["userRecordVisits", "userPayments"]); // 既に把握済み
for (const name of subNames.keys()) {
  if (SKIP_COLS.has(name)) continue;
  const snap = await db.collectionGroup(name).limit(300).get();
  tally(snap.docs.map((d) => d.data()), `サブコレクション ${name}（先頭300件）`);
}
for (const name of ["reservations", "reservationTable"]) {
  if (!topCols.some((c) => c.id === name)) continue;
  const snap = await db.collection(name).where("rsvStatus", "==", true).limit(300).get();
  tally(snap.docs.map((d) => d.data()), `${name}（予約済みの枠・先頭300件）`);
}
process.exit(0);
