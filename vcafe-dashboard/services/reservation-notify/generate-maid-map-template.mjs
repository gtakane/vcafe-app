// 本番のメイド名簿(maidWorkReport)を読み取り、一括投入用JSONのひな形を作る（読み取り専用）。
// 出力された JSON の discordUserId を埋めて set-maid-discord-map.mjs --file で一括登録する。
//
// 使い方（Cloud Shell）:
//   cd services/reservation-notify && npm install
//   node generate-maid-map-template.mjs > maid-map.json      # 全メイド（既定: 稼働中のみ）
//   node generate-maid-map-template.mjs --all > maid-map.json # 退職者も含めて全件
//   # → maid-map.json を編集して discordUserId を埋める（空のままの行は投入時にスキップ）
//   node set-maid-discord-map.mjs --file maid-map.json
//
// maidId は本番の不変IDなので、メイドがニックネームを変更しても紐づけは壊れません。

import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = (process.env.PRODUCTION_PROJECT_ID || "v-athome-cafe-app").trim();
const includeInactive = process.argv.includes("--all");

const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId }));
const snapshot = await db.collection("maidWorkReport").limit(5000).get();

const maids = snapshot.docs
  .map((doc) => {
    const data = doc.data();
    return { maidId: doc.id, nickname: String(data.nickname ?? "").trim() || "名称未設定", active: data.active === true };
  })
  .filter((maid) => includeInactive || maid.active)
  .sort((a, b) => a.nickname.localeCompare(b.nickname, "ja"))
  // discordUserId は空欄。運用側で各メイドのDiscordユーザーIDを記入する。
  .map((maid) => ({ maidId: maid.maidId, nickname: maid.nickname, discordUserId: "" }));

// 進捗メッセージは stderr へ（stdout はJSONのみにしてリダイレクトできるようにする）。
console.error(`# ${maids.length}名を出力しました（${includeInactive ? "全件" : "稼働中のみ"}）。discordUserId を埋めて set-maid-discord-map.mjs --file で投入してください。`);
console.log(JSON.stringify(maids, null, 2));
process.exit(0);
