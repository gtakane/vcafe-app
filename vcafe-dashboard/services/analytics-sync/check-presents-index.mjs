// アイテム使用(userRecordPresents)の同期に必要な collection group インデックスの有無を確認する。
// 読み取り専用。未作成の場合は「そのまま開けば1クリックで作成できるURL」を表示する。
//
// 使い方（Cloud Shell）:
//   cd services/analytics-sync && npm install
//   node check-presents-index.mjs
//
// 既にあれば "OK" と直近の件数を表示する。無ければ作成URLを表示するので、
// ブラウザで開いて「インデックスを作成」を押す（数分で作成完了。データは変更されない）。

import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const projectId = (process.env.PRODUCTION_PROJECT_ID || "v-athome-cafe-app").trim();
const group = process.argv[2] || "userRecordPresents";
const field = process.argv[3] || "presentDateTime";

const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId }));
const end = new Date();
const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

try {
  const snapshot = await db.collectionGroup(group)
    .where(field, ">=", Timestamp.fromDate(start))
    .where(field, "<", Timestamp.fromDate(end))
    .limit(5)
    .get();
  console.log(`OK: collectionGroup("${group}").${field} の範囲クエリが実行できました（直近30日で ${snapshot.size} 件取得）。`);
  console.log("インデックスは作成済みです。バックフィルを実行するとアイテム使用が取り込まれます。");
} catch (error) {
  const message = String(error?.message || error);
  console.log(`未作成: collectionGroup("${group}").${field} のインデックスが必要です。`);
  const url = message.match(/https:\/\/\S+/)?.[0];
  if (url) {
    console.log("\n▼ 下のURLをブラウザで開き「インデックスを作成」を押してください（データは変更されません）");
    console.log(url);
  } else {
    console.log(message);
  }
  console.log("\n※ 作成せずに進めても他の同期は止まりません（アイテム使用の列が空欄になるだけです）。");
}
process.exit(0);
