// 「累計ご帰宅は多いのに課金額(通算)が少ない」ユーザーの原因を特定する（読み取り専用）。
//
// ダッシュボードの課金額は payments_current の合算で、同期元は
//   1. payments（Webstore/Stripe: paymentAmount 円）
//   2. purchaseLog（アプリ内課金: coinSendToChargeCoin × 1.4円）
// の2コレクションのみ。WEB版時代の課金が別の場所
// （users/{uid}/userPayments, userAdmin/userAdminPayment など）に残っていれば
// その分が丸ごと欠落する。このスクリプトは怪しいユーザーを自動抽出し、
// その人の課金の痕跡を全コレクションから探して「どこに・いつの・いくら」があるかを出す。
//
// 使い方（Cloud Shell）:
//   cd services/analytics-sync && npm install
//   node diagnose-payment-gap.mjs           # ご帰宅上位から自動抽出して10人検査
//   node diagnose-payment-gap.mjs 20        # 検査人数を指定
//   node diagnose-payment-gap.mjs <userId>  # 特定ユーザーを直接検査

import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = (process.env.PRODUCTION_PROJECT_ID || "v-athome-cafe-app").trim();
const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId }));

const arg = process.argv[2] || "";
const targetUser = /^\d+$/.test(arg) || arg === "" ? null : arg;
const sampleSize = targetUser ? 1 : Number(arg) || 10;

const fmt = (ts) => {
  if (!ts) return "-";
  if (ts.toDate) return ts.toDate().toISOString().slice(0, 10);
  return String(ts).slice(0, 10);
};
const yen = (n) => `${Math.round(n).toLocaleString("ja-JP")}円`;

// ドキュメント群から金額らしいフィールドを合算し、期間と代表フィールド名を返す。
function summarize(docs) {
  if (!docs.length) return null;
  const amountKeys = ["paymentAmount", "amount", "price", "totalAmount", "chargeAmount"];
  const coinKeys = ["coinSendToChargeCoin", "coin", "chargeCoin", "purchaseCoin"];
  const dateKeys = ["requestDate", "stripeEventDate", "confirmPurchaseTime", "chargeCoinSucceedTime", "paymentDateTime", "date", "createdAt", "purchaseDate"];
  let amountSum = 0;
  let coinSum = 0;
  const dates = [];
  const fieldSets = new Map();
  for (const d of docs) {
    const data = d.data();
    const keys = Object.keys(data).sort().join(",");
    fieldSets.set(keys, (fieldSets.get(keys) || 0) + 1);
    for (const k of amountKeys) if (typeof data[k] === "number") { amountSum += data[k]; break; }
    for (const k of coinKeys) if (typeof data[k] === "number") { coinSum += data[k]; break; }
    for (const k of dateKeys) if (data[k]) { dates.push(fmt(data[k])); break; }
  }
  dates.sort();
  const topFields = [...fieldSets.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  return {
    count: docs.length,
    amountSum,
    coinSum,
    first: dates[0] || "-",
    last: dates.at(-1) || "-",
    fields: topFields.split(",").slice(0, 12).join(", "),
  };
}

async function inspectUser(uid, userData) {
  console.log(`\n${"=".repeat(66)}`);
  console.log(`■ users/${uid}`);
  console.log(`  nickname=${userData?.nickname ?? "?"} 累計ご帰宅=${userData?.totalVisitAmount ?? "?"} 登録=${fmt(userData?.registrationDate)} lastPayment=${fmt(userData?.lastPaymentDateTime || userData?.lastPaymentAt)}`);

  // 1) 現在同期している2ソース
  const [pay, purchase] = await Promise.all([
    db.collection("payments").where("author", "==", uid).limit(2000).get(),
    db.collection("purchaseLog").where("userId", "==", uid).limit(2000).get(),
  ]);

  const paySummary = summarize(pay.docs);
  const purchaseSummary = summarize(purchase.docs);
  console.log(`\n  【同期済みソース】`);
  console.log(`  payments(author==uid)     : ${paySummary ? `${paySummary.count}件 ${yen(paySummary.amountSum)} 期間 ${paySummary.first}〜${paySummary.last}` : "0件"}`);
  console.log(`  purchaseLog(userId==uid)  : ${purchaseSummary ? `${purchaseSummary.count}件 ${purchaseSummary.coinSum.toLocaleString()}ac(≒${yen(purchaseSummary.coinSum * 1.4)}) 期間 ${purchaseSummary.first}〜${purchaseSummary.last}` : "0件"}`);

  // mapPayment が捨てる形（author/requestDate欠落）の件数も確認
  const dropped = pay.docs.filter((d) => {
    const v = d.data();
    return !v.author || (!v.requestDate && !v.stripeEventDate);
  });
  if (dropped.length) console.log(`  ★ payments のうち同期が捨てる形(author/requestDate欠落): ${dropped.length}件`);

  // 2) ユーザー配下のサブコレクションを列挙して課金の痕跡を探す
  const subs = await db.doc(`users/${uid}`).listCollections();
  console.log(`\n  【users/${uid} のサブコレクション】 ${subs.map((c) => c.id).join(", ") || "(なし)"}`);
  for (const sub of subs) {
    const lower = sub.id.toLowerCase();
    if (!/pay|purchase|charge|coin|billing/.test(lower)) continue;
    const snap = await sub.limit(2000).get();
    const s = summarize(snap.docs);
    if (s) {
      console.log(`  ★ users/${uid}/${sub.id}: ${s.count}件 金額計=${yen(s.amountSum)} コイン計=${s.coinSum.toLocaleString()}ac 期間 ${s.first}〜${s.last}`);
      console.log(`      フィールド例: ${s.fields}`);
    }
  }

  // 3) userAdmin/userAdminPayment（ルールに存在するWEB版時代の課金置き場）
  try {
    const adminPay = await db.collection(`users/${uid}/userAdmin/userAdminPayment/payments`).limit(2000).get()
      .catch(() => null);
    const adminDoc = await db.doc(`users/${uid}/userAdmin/userAdminPayment`).get().catch(() => null);
    if (adminPay && adminPay.size) {
      const s = summarize(adminPay.docs);
      console.log(`  ★ userAdmin/userAdminPayment/payments: ${s.count}件 ${yen(s.amountSum)} 期間 ${s.first}〜${s.last}`);
    } else if (adminDoc?.exists) {
      console.log(`  userAdmin/userAdminPayment (doc): ${JSON.stringify(adminDoc.data()).slice(0, 300)}`);
    }
  } catch { /* 形が違う場合は無視 */ }

  return { uid, pay: paySummary, purchase: purchaseSummary };
}

console.log(`# project=${projectId}`);

let targets = [];
if (targetUser) {
  const doc = await db.doc(`users/${targetUser}`).get();
  targets = [{ uid: targetUser, data: doc.exists ? doc.data() : null }];
} else {
  // ご帰宅上位のユーザーを取り、「課金の痕跡が薄い」人を選ぶ。
  const snap = await db.collection("users")
    .orderBy("totalVisitAmount", "desc")
    .limit(60)
    .get();
  console.log(`ご帰宅上位 ${snap.size}人 から課金額とのギャップが大きい人を抽出します…`);

  const rows = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    const [payCount, purchaseCount] = await Promise.all([
      db.collection("payments").where("author", "==", doc.id).count().get().then((r) => r.data().count).catch(() => -1),
      db.collection("purchaseLog").where("userId", "==", doc.id).count().get().then((r) => r.data().count).catch(() => -1),
    ]);
    rows.push({ uid: doc.id, data, visits: Number(data.totalVisitAmount) || 0, payCount, purchaseCount });
  }

  console.log(`\n  ${"ご帰宅".padStart(6)} ${"payments".padStart(9)} ${"purchase".padStart(9)}  uid / nickname`);
  for (const r of rows.slice(0, 30)) {
    console.log(`  ${String(r.visits).padStart(6)} ${String(r.payCount).padStart(9)} ${String(r.purchaseCount).padStart(9)}  ${r.uid} ${r.data.nickname || ""}`);
  }

  // ご帰宅が多いのに両ソース合計の件数が少ない順
  targets = rows
    .sort((a, b) => (a.payCount + a.purchaseCount) / (a.visits + 1) - (b.payCount + b.purchaseCount) / (b.visits + 1))
    .slice(0, sampleSize)
    .map((r) => ({ uid: r.uid, data: r.data }));
}

for (const t of targets) await inspectUser(t.uid, t.data);

console.log(`\n${"=".repeat(66)}`);
console.log("読み方:");
console.log("・【同期済みソース】が0件〜僅少なのにご帰宅が多い → その人の課金は別の場所にある");
console.log("・★ の行に出たサブコレクションが「欠けている課金ソース」= 同期に追加すべき対象");
console.log("・「同期が捨てる形」が多い → mapPayment のフィールド対応を旧形式に広げる改修が必要");
process.exit(0);
