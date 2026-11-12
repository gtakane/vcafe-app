// メイドお給仕ポータル（app-vmaid-mgr）の「ご帰宅枠数」を、本番の記録から同じ考え方で数え直して並べる（読み取りのみ）。
// 使い方: node visit-slots.mjs
//
// ポータルの計算（2026-11-12 に画面のプログラムを読んで確認）:
//   - 1日は 5:00〜翌4:59（JST）
//   - ご帰宅枠数 = 通常ご帰宅（roomType=workshift で、無料・お試しでないもの）の visitPoints の合計
//       無料: entryType が newUserFree / freshMaidFree / freeTicket、または isFreeEntry=true、または visitPoints=0
//       お試し: entryType が無く serviceIndex=3
//   - 予約（roomType=reservation）の visitPoints は別の項目（totalReservation）で、ご帰宅枠数には入らない
//   - テストユーザーも含む。メイドのシフト時間（終了+15分まで）の中のご帰宅だけを数える（ここでは省略）
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId: "v-athome-cafe-app" }));

// ポータルの「お給仕実績取得履歴」2026年11月の「ご帰宅枠数」
const PORTAL = {
  "2026-11-01": 104, "2026-11-02": 140.5, "2026-11-03": 82, "2026-11-04": 93, "2026-11-05": 117.5, "2026-11-06": 191,
  "2026-11-07": 75.5, "2026-11-08": 92.5, "2026-11-09": 130.5, "2026-11-10": 132, "2026-11-11": 121.5,
};

const testUsers = new Set();
for (const field of ["testUser", "testUesrFlag"]) for (const value of [true, "true"]) {
  (await db.collection("users").where(field, "==", value).select().get()).docs.forEach((d) => testUsers.add(d.id));
}

const start = new Date("2026-11-01T05:00:00+09:00");
const end = new Date("2026-11-12T05:00:00+09:00");
const snapshot = await db.collectionGroup("userRecordVisits")
  .where("enterDateTime", ">=", Timestamp.fromDate(start)).where("enterDateTime", "<", Timestamp.fromDate(end)).get();

const FREE = new Set(["newUserFree", "freshMaidFree", "freeTicket"]);
const kindOf = (v) => {
  const points = v.visitPoints ?? v.visitPoint;
  if (FREE.has(v.entryType)) return "free";
  if (!v.entryType && v.serviceIndex === 3) return "trial";
  if (v.isFreeEntry === true || (v.roomType === "workshift" && points === 0)) return "free";
  if (v.roomType === "reservation") return "reservation";
  if (v.roomType === "workshift") return "normal";
  return "other";
};
const dayOf = (date, hours) => new Date(date.getTime() + (9 - hours) * 3600000).toISOString().slice(0, 10);
const minutesRule = (v) => { const m = Number(v.initialTime) > 0 ? Number(v.initialTime) : 20; return m < 20 ? 0.5 : m / 20; };

const rows = new Map();
const pairs = new Map();
for (const document of snapshot.docs) {
  const v = document.data();
  const at = v.enterDateTime.toDate();
  const kind = kindOf(v);
  const isTest = testUsers.has(document.ref.parent.parent?.id);
  const points = Number(v.visitPoints ?? v.visitPoint ?? 0) || 0;
  const key5 = dayOf(at, 5), key2 = dayOf(at, 2);
  for (const [key, label] of [[key5, "d5"], [key2, "d2"]]) {
    const r = rows.get(key) || { d5: { all: 0, noTest: 0, minutes: 0, reservation: 0, trial: 0, free: 0, other: 0, count: 0 }, d2: { all: 0, noTest: 0, minutes: 0 } };
    const slot = r[label];
    if (kind === "normal") { slot.all += points; if (!isTest) slot.noTest += points; slot.minutes += minutesRule(v); if (label === "d5") slot.count += 1; }
    if (label === "d5" && kind !== "normal") slot[kind] += kind === "reservation" ? points : 1;
    rows.set(key, r);
  }
  if (kind === "normal") { const k = `initialTime=${v.initialTime ?? "なし"} → visitPoints=${points}`; pairs.set(k, (pairs.get(k) || 0) + 1); }
}

const f = (n) => (n == null ? "" : String(Math.round(n * 10) / 10)).padStart(8);
console.log("日付(5時区切り)   ポータル  ①枠数     ②テスト除く ③時間÷20分  ④2時区切り  通常の回数  予約の枠   お試し   無料");
for (const day of Object.keys(PORTAL)) {
  const r = rows.get(day);
  if (!r) { console.log(`${day}  ${f(PORTAL[day])}  （記録なし）`); continue; }
  console.log(`${day}  ${f(PORTAL[day])}  ${f(r.d5.all)}  ${f(r.d5.noTest)}  ${f(r.d5.minutes)}  ${f(r.d2.all)}  ${f(r.d5.count)}  ${f(r.d5.reservation)}  ${f(r.d5.trial)}  ${f(r.d5.free)}`);
}
const sum = (pick) => Object.keys(PORTAL).reduce((s, d) => s + (rows.get(d) ? pick(rows.get(d)) : 0), 0);
console.log(`合計        ${f(Object.values(PORTAL).reduce((a, b) => a + b, 0))}  ${f(sum((r) => r.d5.all))}  ${f(sum((r) => r.d5.noTest))}  ${f(sum((r) => r.d5.minutes))}  ${f(sum((r) => r.d2.all))}`);
console.log("\n① 通常ご帰宅の visitPoints の合計（ポータルと同じ考え方）／② ①からテストユーザーを除いたもの／③ 滞在時間÷20分で数えたもの／④ ①を2時区切りで数えたもの");
console.log("\n=== 通常ご帰宅の滞在時間と visitPoints の組み合わせ（件数） ===");
for (const [k, n] of [...pairs.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);
process.exit(0);
