// 新人メイド無料（entryType=freshMaidFree）のご帰宅を1件ずつ表示する（本番Firestore・読み取りのみ）。
// 画面に表示するだけで、どこにも保存・送信しない。
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId: "v-athome-cafe-app" }));
const isTrue = (v) => v === true || v === "true";
const jst = (ts) => ts?.toDate ? new Date(ts.toDate().getTime() + 9 * 3600e3).toISOString().replace("T", " ").slice(0, 19) : "—";
const start = Timestamp.fromDate(new Date("2026-11-05T17:00:00Z"));
const snap = await db.collectionGroup("userRecordVisits").where("enterDateTime", ">=", start).get();
const rows = snap.docs.filter((d) => d.get("entryType") === "freshMaidFree")
  .sort((a, b) => a.get("enterDateTime").toMillis() - b.get("enterDateTime").toMillis());

const maidCache = new Map();
async function maidInfo(id) {
  if (!id) return null;
  if (!maidCache.has(id)) {
    const m = await db.doc(`maids/${id}`).get();
    const data = m.exists ? m.data() : {};
    // 新人判定に使われていそうな項目（fresh / debut / new / free を含む名前）とランク・登録日
    const hints = Object.entries(data)
      .filter(([k]) => /fresh|debut|new|free|rookie/i.test(k))
      .map(([k, v]) => `${k}=${v?.toDate ? jst(v) : JSON.stringify(v)}`);
    maidCache.set(id, { rank: data.rank ?? "—", registered: jst(data.registrationDate), hints });
  }
  return maidCache.get(id);
}

console.log(`新人メイド無料: ${rows.length}件（営業日11/6以降）\n`);
let i = 0;
for (const d of rows) {
  const user = await d.ref.parent.parent.get();
  const u = user.exists ? user.data() : {};
  const test = isTrue(u.testUser) || isTrue(u.testUesrFlag);
  const maid = await maidInfo(d.get("maidId"));
  console.log(`[${++i}] ${jst(d.get("enterDateTime"))}（JST）`);
  console.log(`    メイド    : ${d.get("maidNickname") ?? "—"}（ランク ${maid?.rank ?? "—"}・メイド登録 ${maid?.registered ?? "—"}）`);
  if (maid?.hints.length) console.log(`    メイド側の新人関連項目: ${maid.hints.join(" / ")}`);
  console.log(`    ユーザー  : ${u.nickname ?? "—"}${test ? "【テストユーザー】" : ""}（会員登録 ${jst(u.registrationDate)}）`);
  console.log(`    時間      : ${d.get("durationMinutes") ?? d.get("initialTime") ?? "—"}分 / 部屋種別 ${d.get("roomType") ?? "—"} / 退室 ${jst(d.get("exitDateTime"))}`);
  console.log(`    無料履歴ID: ${d.get("freeEntryHistoryId") ?? "—"}`);
  console.log("");
}
process.exit(0);
