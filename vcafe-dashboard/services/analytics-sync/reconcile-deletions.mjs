// 分析側に存在するが本番Firestoreには無いレコード（＝削除された行）を検出する。
//
// *_raw は追記型なので、Firestore で削除されたドキュメントは分析側に残り続ける。
// 増分同期はイベント時刻で範囲選択するため、削除は原理的に検知できない。
// ここでは「本番の recordKey 集合」と「分析側の recordKey 集合」を突き合わせ、
// 分析側にのみ存在するキーを洗い出す。
//
// **読み取り専用。** 本番Firestoreにも BigQuery にも書き込まない（--record 指定時のみ
// dq_results へ件数を記録する。生の識別子は記録しない）。
//
// 使い方（Cloud Shell）:
//   cd services/analytics-sync && npm install
//   node reconcile-deletions.mjs userRecordVisits enterDateTime 2026-07-01 2026-07-28
//   node reconcile-deletions.mjs userRecordVisits enterDateTime 2026-07-01 2026-07-28 --record

import { createHmac } from "node:crypto";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { BigQuery } from "@google-cloud/bigquery";

const [group, dateField, startDate, endDate] = process.argv.slice(2);
const shouldRecord = process.argv.includes("--record");

if (!group || !dateField || !startDate || !endDate) {
  console.error("使い方: node reconcile-deletions.mjs <コレクショングループ> <日付フィールド> <開始日> <終了日> [--record]");
  console.error("例: node reconcile-deletions.mjs userRecordVisits enterDateTime 2026-07-01 2026-07-28");
  process.exit(1);
}

const TABLE_BY_GROUP = {
  userRecordVisits: "visits_raw",
  userAlbum: "cheki_raw",
  workshifts: "shifts_raw",
  userRecordPresents: "presents_raw",
  userPayments: "payments_raw",
};
const table = TABLE_BY_GROUP[group];
if (!table) {
  console.error(`未対応のコレクショングループです: ${group}（対応: ${Object.keys(TABLE_BY_GROUP).join(", ")}）`);
  process.exit(1);
}

const productionProjectId = (process.env.PRODUCTION_PROJECT_ID || "v-athome-cafe-app").trim();
const analyticsProjectId = (process.env.ANALYTICS_PROJECT_ID || "vcafe-admin-analytics").trim();
const dataset = (process.env.BIGQUERY_DATASET || "vcafe_analytics").trim();
const secret = (process.env.CUSTOMER_ID_HMAC_SECRET || "").trim();
if (secret.length < 32) {
  console.error("CUSTOMER_ID_HMAC_SECRET が未設定です（recordKey の再計算に必要）。");
  console.error("  export CUSTOMER_ID_HMAC_SECRET=\"$(gcloud secrets versions access latest --secret=vcafe-customer-id-hmac --project=vcafe-admin-analytics)\"");
  process.exit(1);
}

const recordKeyOf = (path) => createHmac("sha256", secret).update(path, "utf8").digest("hex");

const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId: productionProjectId }));
const bigquery = new BigQuery({ projectId: analyticsProjectId });

const start = new Date(`${startDate}T00:00:00Z`);
const end = new Date(`${endDate}T23:59:59.999Z`);

console.log(`# 本番=${productionProjectId} 分析=${analyticsProjectId}.${dataset}`);
console.log(`# group=${group} field=${dateField} 期間=${startDate}〜${endDate}`);

// --- 本番側の recordKey 集合（select() で値を読まず、パスだけ取得して読み取りを最小化） ---
const sourceKeys = new Set();
let cursor = null;
let read = 0;
for (;;) {
  let query = db.collectionGroup(group)
    .where(dateField, ">=", Timestamp.fromDate(start))
    .where(dateField, "<", Timestamp.fromDate(end))
    .orderBy(dateField)
    .orderBy("__name__")
    .select()
    .limit(2000);
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.get();
  if (snapshot.empty) break;
  for (const doc of snapshot.docs) sourceKeys.add(recordKeyOf(doc.ref.path));
  read += snapshot.size;
  process.stdout.write(`\r  本番から取得: ${read}件`);
  if (snapshot.size < 2000) break;
  cursor = snapshot.docs[snapshot.docs.length - 1];
}
console.log(`\n本番: ${sourceKeys.size}件`);

// --- 分析側の recordKey 集合 ---
const timeColumn = table === "shifts_raw" ? "scheduledStart" : "`at`";
const [rows] = await bigquery.query({
  location: process.env.BIGQUERY_LOCATION || "asia-northeast1",
  query: `
    SELECT DISTINCT recordKey
    FROM \`${analyticsProjectId}.${dataset}.${table}\`
    WHERE recordKey IS NOT NULL
      AND ${timeColumn} >= TIMESTAMP(@start) AND ${timeColumn} < TIMESTAMP(@end)
  `,
  params: { start: start.toISOString(), end: end.toISOString() },
});
const analyticsKeys = new Set(rows.map((row) => String(row.recordKey)));
console.log(`分析: ${analyticsKeys.size}件`);

// --- 差分 ---
const deletedInSource = [...analyticsKeys].filter((key) => !sourceKeys.has(key));
const missingInAnalytics = [...sourceKeys].filter((key) => !analyticsKeys.has(key));

console.log(`\n★ 分析側にのみ存在（本番で削除された可能性）: ${deletedInSource.length}件`);
console.log(`★ 本番にのみ存在（同期漏れ）: ${missingInAnalytics.length}件`);

// recordKey は HMAC なので逆引きできない。特定が必要な場合は
// 本番側でパスを列挙して同じ HMAC を計算し、突き合わせること。
if (deletedInSource.length) {
  console.log("\n削除候補の recordKey（先頭5件・HMACのため逆引き不可）:");
  for (const key of deletedInSource.slice(0, 5)) console.log(`  ${key}`);
}

if (shouldRecord) {
  const runId = `reconcile-${new Date().toISOString()}`;
  await bigquery.dataset(dataset).table("dq_results").insert([
    { runId, checkName: `reconcile_deleted_${group}`, status: deletedInSource.length ? "warn" : "pass",
      observedValue: deletedInSource.length, threshold: 0,
      details: `${startDate}〜${endDate} 分析側にのみ存在`, checkedAt: new Date().toISOString() },
    { runId, checkName: `reconcile_missing_${group}`, status: missingInAnalytics.length ? "fail" : "pass",
      observedValue: missingInAnalytics.length, threshold: 0,
      details: `${startDate}〜${endDate} 本番にのみ存在（同期漏れ）`, checkedAt: new Date().toISOString() },
  ]);
  console.log("\ndq_results へ記録しました（件数のみ。識別子は記録しません）");
}

console.log("\n----");
console.log("読み方:");
console.log("・「分析側にのみ存在」→ 本番で削除された行。集計から除くには *_raw に tombstone 列が必要（未実装）");
console.log("・「本番にのみ存在」→ 同期漏れ。バックフィルで解消するはず。解消しなければ調査対象");
process.exit(deletedInSource.length || missingInAnalytics.length ? 1 : 0);
