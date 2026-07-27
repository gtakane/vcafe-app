import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { Client, GatewayIntentBits } from "discord.js";
import { loadNotifyConfig } from "./config.ts";
import { readReservations } from "./reservations.ts";
import { loadMaidDiscordMapping } from "./mapping.ts";
import { businessDayWindowJst, formatMaidMessage, groupByMaid, notificationDocId, resolveDiscordId, windowForBusinessDay } from "./core.ts";

process.on("unhandledRejection", (error) => {
  const err = error as { name?: string; message?: string };
  console.error(`UNHANDLED_REJECTION name=${err?.name} message=${err?.message}`);
  process.exit(1);
});

async function main() {
  const config = loadNotifyConfig(process.env);
  // TARGET_DATE 指定時はその営業日、無ければ 今日+offset。
  const window = config.targetDate ? windowForBusinessDay(config.targetDate) : businessDayWindowJst(new Date(), config.targetOffsetDays);
  console.info(`[reservation-notify] day=${window.day} window=${window.start.toISOString()}..${window.end.toISOString()} dryRun=${config.dryRun}`);

  // 本番は読み取り専用アプリ、管理用は書き込み用アプリとして分離する。
  const productionApp = initializeApp({ credential: applicationDefault(), projectId: config.productionProjectId }, "production-readonly");
  const managementApp = initializeApp({ credential: applicationDefault(), projectId: config.managementProjectId }, "management");
  const productionDb = getFirestore(productionApp);
  const managementDb = getFirestore(managementApp);

  const [entries, mapping] = await Promise.all([
    readReservations(productionDb, config.source, window.day),
    loadMaidDiscordMapping(managementDb, config),
  ]);
  const groups = groupByMaid(entries);
  console.info(`[reservation-notify] reservations=${entries.length} maids=${groups.length}`);

  // 送信対象を決める（冪等: 送信済みはスキップ／未対応メイドは記録して通知）。
  const notifications = managementDb.collection(config.notificationsCollection);
  const pending: Array<{ discordUserId: string; message: string; docId: string; maidNickname: string; count: number }> = [];
  const unmapped: string[] = [];
  let alreadySent = 0;
  for (const group of groups) {
    const docId = notificationDocId(window.day, group.key);
    const existing = await notifications.doc(docId).get();
    if (existing.exists && existing.get("status") === "sent") { alreadySent += 1; continue; }
    const discordUserId = resolveDiscordId(group, mapping);
    if (!discordUserId) { unmapped.push(`${group.maidNickname || "?"}(maidId=${group.maidId || "-"})`); continue; }
    pending.push({ discordUserId, message: formatMaidMessage(window.day, group, config.showCustomer), docId, maidNickname: group.maidNickname, count: group.entries.length });
  }

  if (unmapped.length) console.warn(`[reservation-notify] Discord未対応のメイド(${unmapped.length}): ${unmapped.join(", ")}`);

  if (config.dryRun) {
    for (const item of pending) console.info(`[DRY-RUN] DM→${item.maidNickname}(${item.discordUserId}) ${item.count}件\n${item.message}`);
    console.info(`[reservation-notify] DRY-RUN 完了: 送信予定=${pending.length} 済=${alreadySent} 未対応=${unmapped.length}`);
    return;
  }

  if (!pending.length) { console.info("[reservation-notify] 送信対象なし"); return; }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(config.botToken);
  let sent = 0;
  try {
    for (const item of pending) {
      try {
        const user = await client.users.fetch(item.discordUserId);
        await user.send(item.message);
        await notifications.doc(item.docId).set({
          day: window.day, maidNickname: item.maidNickname, discordUserId: item.discordUserId,
          count: item.count, status: "sent", sentAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        sent += 1;
      } catch (error) {
        console.error(`[reservation-notify] 送信失敗 maid=${item.maidNickname} user=${item.discordUserId}: ${(error as Error).message}`);
      }
    }
  } finally {
    await client.destroy();
  }
  console.info(`[reservation-notify] 送信完了: sent=${sent}/${pending.length} 済=${alreadySent} 未対応=${unmapped.length}`);
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
