// userPayments（WEB版時代の課金置き場）の生データ構造を確認する（読み取り専用）。
// 同期改修（重複計上の回避・チャネル判定・期間カットオフ）の設計に使う。
//
//   node show-userpayments.mjs tbqGMM5wFYUV5ttfYFzlzKDJDcp2
//
// 出力: 最古3件 / 最新3件 / コイン系フィールドを持つ3件 / 2023-10以降の3件 の生JSON。

import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = (process.env.PRODUCTION_PROJECT_ID || "v-athome-cafe-app").trim();
const uid = process.argv[2];
if (!uid) { console.error("使い方: node show-userpayments.mjs <userId>"); process.exit(1); }

const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId }));

// Timestamp を ISO 文字列にして人間が読める形で出す。トークン類が万一あってもマスクする。
function plain(value) {
  if (value === null || value === undefined) return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = /token|secret|key/i.test(k) ? "(マスク)" : plain(v);
    }
    return out;
  }
  return value;
}

const show = (label, docs) => {
  console.log(`\n== ${label}: ${docs.length}件 ==`);
  for (const d of docs) {
    console.log(`--- ${d.id} ---`);
    console.log(JSON.stringify(plain(d.data()), null, 2));
  }
  if (!docs.length) console.log("（なし）");
};

const col = db.collection(`users/${uid}/userPayments`);
console.log(`# project=${projectId}  users/${uid}/userPayments`);

const all = await col.limit(3000).get();
console.log(`総件数(上限3000): ${all.size}`);

// paymentDate で並べる（無い doc もあるためクライアント側でソート）。
const rows = all.docs.map((d) => {
  const data = d.data();
  const ts = data.paymentDate?.toDate?.() || data.requestDate?.toDate?.() || null;
  return { doc: d, ts, data };
});
const dated = rows.filter((r) => r.ts).sort((a, b) => a.ts - b.ts);
const undated = rows.filter((r) => !r.ts);

show("最古3件", dated.slice(0, 3).map((r) => r.doc));
show("最新3件", dated.slice(-3).map((r) => r.doc));
show("日付フィールド(paymentDate/requestDate)が無い3件", undated.slice(0, 3).map((r) => r.doc));

const coinDocs = rows.filter((r) =>
  ["coin", "coinSendToChargeCoin", "chargeCoin", "purchaseCoin"].some((k) => typeof r.data[k] === "number"));
show("コイン系フィールドを持つ3件", coinDocs.slice(0, 3).map((r) => r.doc));

const cutoff = new Date("2023-10-01T00:00:00Z");
const recent = dated.filter((r) => r.ts >= cutoff);
show("2023-10-01以降の3件（アプリ移行後にも書かれているか）", recent.slice(0, 3).map((r) => r.doc));

// 年別の件数と金額で全体像も出す。
const byYear = new Map();
for (const r of dated) {
  const y = r.ts.getFullYear();
  const e = byYear.get(y) || { count: 0, amount: 0 };
  e.count += 1;
  e.amount += typeof r.data.amount === "number" ? r.data.amount : 0;
  byYear.set(y, e);
}
console.log("\n== 年別サマリ ==");
for (const [y, e] of [...byYear.entries()].sort()) {
  console.log(`${y}: ${e.count}件 ${Math.round(e.amount).toLocaleString("ja-JP")}円`);
}
console.log(`日付なし: ${undated.length}件`);
process.exit(0);
