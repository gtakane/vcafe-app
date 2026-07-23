import { createServer } from "node:http";
import { Client, GatewayIntentBits } from "discord.js";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { parseShiftTemplate } from "./parser.ts";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const managementProjectId = required("MANAGEMENT_PROJECT_ID");
const productionProjectId = process.env.PRODUCTION_PROJECT_ID;
if (productionProjectId && managementProjectId === productionProjectId) {
  throw new Error("安全のため、管理用プロジェクトと本番プロジェクトを同一にはできません");
}

const app = initializeApp({ credential: applicationDefault(), projectId: managementProjectId });
const db = getFirestore(app);
const channelId = required("DISCORD_CHANNEL_ID");
const guildId = process.env.DISCORD_GUILD_ID;
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

async function persistMessage(message: import("discord.js").Message) {
  if (message.author.bot || message.channelId !== channelId || (guildId && message.guildId !== guildId)) return;
  const parsed = parseShiftTemplate(message.content, message.createdAt);
  if (!parsed) {
    await message.react("⚠️").catch(() => undefined);
    return;
  }
  await db.collection("discordShiftSubmissions").doc(message.id).set({
    ...parsed,
    discordMessageId: message.id,
    discordUserId: message.author.id,
    discordChannelId: message.channelId,
    source: "discord",
    status: "received",
    messageCreatedAt: message.createdAt,
    messageEditedAt: message.editedAt,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await message.react("✅").catch(() => undefined);
}

client.on("messageCreate", persistMessage);
client.on("messageUpdate", async (_oldMessage, newMessage) => {
  const message = newMessage.partial ? await newMessage.fetch() : newMessage;
  await persistMessage(message);
});

client.once("ready", () => console.info(`Discord attendance bot ready: ${client.user?.tag}`));
createServer((_request, response) => { response.writeHead(200); response.end("ok"); }).listen(Number(process.env.PORT || 8080));
await client.login(required("DISCORD_BOT_TOKEN"));
