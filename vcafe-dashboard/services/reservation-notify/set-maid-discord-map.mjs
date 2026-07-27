// メイド↔Discordユーザーの対応表(maidDiscordMap)を管理用Firestoreに投入する補助スクリプト。
// 書き込み先は管理用プロジェクト(既定 vcafe-admin-analytics)のみ。本番には一切触れない。
//
// 使い方（Cloud Shell）:
//   cd services/reservation-notify && npm install
//   # 1件ずつ（ニックネーム or maidId のどちらかを指定）
//   node set-maid-discord-map.mjs --nickname "星ノ異イ" --discord 123456789012345678
//   node set-maid-discord-map.mjs --maidId DHjCZRskkAVKFeAZkRxDajFbwBC3 --discord 123456789012345678
//   # まとめて（JSON配列: [{ "nickname"|"maidId", "discordUserId" }, ...]）
//   node set-maid-discord-map.mjs --file map.json
//   # 現在の登録内容を一覧
//   node set-maid-discord-map.mjs --list
//
// DiscordユーザーIDの調べ方: Discordの設定→詳細設定→開発者モードON →
//   対象ユーザーを右クリック→「ユーザーIDをコピー」。

import { readFileSync } from "node:fs";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const KNOWN_PRODUCTION = new Set(["v-athome-cafe-app"]);
const projectId = (process.env.MANAGEMENT_PROJECT_ID || "vcafe-admin-analytics").trim();
if (KNOWN_PRODUCTION.has(projectId)) { console.error(`安全のため本番プロジェクト(${projectId})には書き込めません`); process.exit(1); }
const collection = (process.env.MAID_DISCORD_MAP_COLLECTION || "maidDiscordMap").trim();

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
const has = (name) => process.argv.includes(name);

const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId }));
const col = db.collection(collection);

function docIdFor(entry) {
  if (entry.maidId) return String(entry.maidId);
  if (entry.nickname) return `nick:${entry.nickname}`;
  throw new Error("maidId か nickname のどちらかが必要です");
}

async function upsert(entry) {
  const discordUserId = String(entry.discordUserId || "").trim();
  if (!discordUserId) throw new Error("discordUserId が必要です");
  const data = { discordUserId };
  if (entry.maidId) data.maidId = String(entry.maidId);
  if (entry.nickname) data.nickname = String(entry.nickname);
  await col.doc(docIdFor(entry)).set(data, { merge: true });
  console.log(`upsert: ${docIdFor(entry)} -> ${discordUserId}`);
}

if (has("--list")) {
  const snap = await col.limit(1000).get();
  console.log(`# ${collection} (${snap.size}件)`);
  snap.forEach((d) => console.log(`- ${d.id}: ${JSON.stringify(d.data())}`));
  process.exit(0);
}

const file = arg("--file");
if (file) {
  const entries = JSON.parse(readFileSync(file, "utf8"));
  for (const entry of entries) await upsert(entry);
} else {
  await upsert({ maidId: arg("--maidId"), nickname: arg("--nickname"), discordUserId: arg("--discord") });
}
console.log("完了。ジョブ実行時に自動で参照されます（手動表が勤怠Botより優先）。");
process.exit(0);
