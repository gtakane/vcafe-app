import type { Firestore } from "firebase-admin/firestore";
import type { MaidDiscordMapping } from "./core.ts";
import type { NotifyConfig } from "./config.ts";

/**
 * メイド↔Discordユーザーの対応表を管理用Firestoreから作る。
 *   1. 手動マッピング（mappingCollection）: { maidId?, nickname?, discordUserId }
 *   2. 勤怠Botの記録（discordShiftSubmissions）: ニックネーム→discordUserId を補完（手動が優先）
 * どちらの持ち方にするかは運用で選べる。両方空なら未対応として送信をスキップする。
 */
export async function loadMaidDiscordMapping(managementDb: Firestore, config: NotifyConfig): Promise<MaidDiscordMapping> {
  const byMaidId = new Map<string, string>();
  const byNickname = new Map<string, string>();

  const mapSnapshot = await managementDb.collection(config.mappingCollection).limit(5000).get();
  mapSnapshot.forEach((document) => {
    const data = document.data();
    const discordUserId = String(data.discordUserId ?? "").trim();
    if (!discordUserId) return;
    const maidId = String(data.maidId ?? "").trim();
    const nickname = String(data.nickname ?? data.maidNickname ?? "").trim().normalize("NFC");
    if (maidId) byMaidId.set(maidId, discordUserId);
    if (nickname) byNickname.set(nickname, discordUserId);
  });

  if (config.attendanceFallback) {
    const submissions = await managementDb.collection("discordShiftSubmissions").limit(5000).get();
    submissions.forEach((document) => {
      const data = document.data();
      const nickname = String(data.maidNickname ?? data.maidName ?? data.nickname ?? data.name ?? "").trim().normalize("NFC");
      const discordUserId = String(data.discordUserId ?? "").trim();
      if (nickname && discordUserId && !byNickname.has(nickname)) byNickname.set(nickname, discordUserId);
    });
  }

  return { byMaidId, byNickname };
}
