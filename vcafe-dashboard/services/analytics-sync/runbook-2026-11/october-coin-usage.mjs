// 10月（JST暦月）にご帰宅以外で消費されたコイン・ポイントを数える（本番Firestore・読み取りのみ）。
//   予約(userReservations) / 招待(userInvitations) / 無料のチェキ(userAlbum の誕生日プレゼント等)
// テストユーザーは除外する。金額は経理と同じ単価（コイン1.19円・リワードポイント1.1円）で円換算する。
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId: "v-athome-cafe-app" }));
const FROM = new Date("2026-09-30T15:00:00Z"), TO = new Date("2026-10-31T15:00:00Z"); // JST 10/1 0:00 〜 11/1 0:00
const isTrue = (v) => v === true || v === "true";
const inOct = (ts) => { const t = ts?.toDate?.(); return t && t >= FROM && t < TO; };
const num = (v) => Number(v) || 0;

const testCache = new Map();
async function isTestUser(uid) {
  if (!testCache.has(uid)) {
    const u = await db.doc(`users/${uid}`).get();
    testCache.set(uid, u.exists && (isTrue(u.get("testUser")) || isTrue(u.get("testUesrFlag"))));
  }
  return testCache.get(uid);
}

async function summarize(group, dateField, title) {
  const snap = await db.collectionGroup(group)
    .select(dateField, "purchasedCoin", "purchasedCoinVendor", "purchasedRewardPoint", "canceledDate", "refundedAmountPrice", "active").get();
  const s = { n: 0, canceled: 0, apple: 0, google: 0, noVendor: 0, rp: 0, refundYen: 0 };
  for (const d of snap.docs) {
    if (!inOct(d.get(dateField))) continue;
    if (await isTestUser(d.ref.parent.parent.id)) continue;
    s.n += 1;
    if (d.get("canceledDate")) s.canceled += 1;
    const coin = num(d.get("purchasedCoin")), vendor = d.get("purchasedCoinVendor");
    if (vendor === "apple") s.apple += coin; else if (vendor === "google") s.google += coin; else s.noVendor += coin;
    s.rp += num(d.get("purchasedRewardPoint"));
    s.refundYen += num(d.get("refundedAmountPrice"));
  }
  const yen = (x, r) => Math.round(x * r).toLocaleString();
  console.log(`\n=== ${title}（${dateField} が10月・テスト除く） ${s.n}件（うちキャンセル ${s.canceled}件） ===`);
  console.log(`  Appleコイン  ${s.apple.toLocaleString()} → ${yen(s.apple, 1.19)}円`);
  console.log(`  Googleコイン ${s.google.toLocaleString()} → ${yen(s.google, 1.19)}円`);
  console.log(`  購入元なしのコイン ${s.noVendor.toLocaleString()} → ${yen(s.noVendor, 1.19)}円`);
  console.log(`  リワードP    ${s.rp.toLocaleString()} → ${yen(s.rp, 1.1)}円`);
  console.log(`  返金額(refundedAmountPrice) 合計 ${s.refundYen.toLocaleString()}`);
}

await summarize("userReservations", "reservedDate", "予約");
await summarize("userInvitations", "acceptedDate", "招待");

const album = await db.collectionGroup("userAlbum")
  .where("date", ">=", Timestamp.fromDate(FROM)).where("date", "<", Timestamp.fromDate(TO)).select("type").get();
const types = new Map();
for (const d of album.docs) {
  if (await isTestUser(d.ref.parent.parent.id)) continue;
  const t = d.get("type") || "（通常）";
  types.set(t, (types.get(t) || 0) + 1);
}
console.log("\n=== 10月のチェキ（userAlbum・テスト除く）の種類 ===");
for (const [t, n] of types) console.log(`  ${t}: ${n}枚`);
process.exit(0);
