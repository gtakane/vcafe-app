// 送信済み記録(reservationNotifications)を消して再送できるようにする補助スクリプト。
// 書き込み先は管理用プロジェクト(既定 vcafe-admin-analytics)のみ。本番には触れない。
//
// 使い方（Cloud Shell）:
//   cd services/reservation-notify && npm install
//   node reset-notifications.mjs --day 2026-07-30   # その営業日の送信済み記録を削除
//   node reset-notifications.mjs --all              # 全削除（注意）
//   node reset-notifications.mjs --list             # 現在の記録を一覧

import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const KNOWN_PRODUCTION = new Set(["v-athome-cafe-app"]);
const projectId = (process.env.MANAGEMENT_PROJECT_ID || "vcafe-admin-analytics").trim();
if (KNOWN_PRODUCTION.has(projectId)) { console.error(`安全のため本番プロジェクト(${projectId})には触れません`); process.exit(1); }
const collection = (process.env.NOTIFICATIONS_COLLECTION || "reservationNotifications").trim();

const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const has = (name) => process.argv.includes(name);

const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId }));
const col = db.collection(collection);
const snap = await col.get();

if (has("--list")) {
  console.log(`# ${collection} (${snap.size}件)`);
  snap.forEach((d) => console.log(`- ${d.id}: ${JSON.stringify(d.data())}`));
  process.exit(0);
}

const day = arg("--day");
const all = has("--all");
if (!day && !all) { console.error("使い方: --day YYYY-MM-DD / --all / --list"); process.exit(1); }

let deleted = 0;
for (const doc of snap.docs) {
  if (all || (day && doc.id.startsWith(`${day}__`))) {
    await doc.ref.delete();
    deleted += 1;
    console.log(`deleted: ${doc.id}`);
  }
}
console.log(`完了。${deleted}件削除しました。次回実行時に再送されます。`);
process.exit(0);
