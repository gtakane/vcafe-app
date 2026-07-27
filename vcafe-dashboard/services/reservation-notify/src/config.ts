// 予約通知ジョブの設定と安全境界。
// - 本番Firestoreは「読み取り」のみ（予約の取得）。
// - 書き込みは管理用プロジェクトのFirestore（送信済み記録の冪等化）だけ。
// - 既定は DRY_RUN=true（実際にはDMを送らずログのみ）。

// 既知の本番プロジェクトID。管理用に指定させない（誤設定による本番書き込み防止）。
export const KNOWN_PRODUCTION_PROJECT_IDS = new Set<string>(["v-athome-cafe-app"]);

export interface ReservationSourceConfig {
  parentCollection: string; // workshiftGroups（日付グループの親）
  subCollection: string; // reservations（各グループ配下の予約）
  dateField: string; // お給仕時刻フィールド（表示・並び用）
  maidIdField: string;
  maidNicknameField: string;
  customerLabelField: string; // "" なら顧客ラベルを取得しない
  filterField: string; // "" ならフィルタしない
  filterValue: string;
  maxDocuments: number;
}

export interface NotifyConfig {
  productionProjectId: string;
  managementProjectId: string;
  botToken: string;
  guildId: string;
  mappingCollection: string;
  attendanceFallback: boolean;
  targetOffsetDays: number;
  targetDate: string; // "YYYY-MM-DD" 指定時はこの営業日を対象（offsetより優先）。テスト/再送用。
  showCustomer: boolean;
  dryRun: boolean;
  notificationsCollection: string;
  source: ReservationSourceConfig;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") return fallback;
  return value.trim().toLowerCase() === "true";
}

function intEnv(value: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (value == null || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name}は${min}〜${max}の整数で指定してください`);
  return n;
}

export function loadNotifyConfig(env: NodeJS.ProcessEnv): NotifyConfig {
  if (env.CONFIRM_READ_ONLY_PRODUCTION !== "I_UNDERSTAND_THIS_READS_PRODUCTION") {
    throw new Error("本番読み取り確認(CONFIRM_READ_ONLY_PRODUCTION)がないため実行しません");
  }
  const productionProjectId = required(env, "PRODUCTION_PROJECT_ID");
  const managementProjectId = required(env, "MANAGEMENT_PROJECT_ID");
  if (productionProjectId === managementProjectId) throw new Error("本番と管理用プロジェクトは分離してください");
  if (KNOWN_PRODUCTION_PROJECT_IDS.has(managementProjectId)) {
    throw new Error(`安全のため、既知の本番プロジェクト(${managementProjectId})を管理用に指定できません`);
  }
  const dryRun = boolEnv(env.DRY_RUN, true);
  return {
    productionProjectId,
    managementProjectId,
    // DMを送る本番実行時のみBotトークン必須。DRY_RUNではログのみなので不要。
    botToken: dryRun ? (env.DISCORD_BOT_TOKEN?.trim() || "") : required(env, "DISCORD_BOT_TOKEN"),
    guildId: env.DISCORD_GUILD_ID?.trim() || "",
    mappingCollection: env.MAID_DISCORD_MAP_COLLECTION?.trim() || "maidDiscordMap",
    attendanceFallback: boolEnv(env.ATTENDANCE_FALLBACK, true),
    targetOffsetDays: intEnv(env.TARGET_OFFSET_DAYS, 0, -7, 7, "TARGET_OFFSET_DAYS"),
    targetDate: (() => {
      const value = env.TARGET_DATE?.trim() || "";
      if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("TARGET_DATEはYYYY-MM-DD形式で指定してください");
      return value;
    })(),
    showCustomer: boolEnv(env.SHOW_CUSTOMER, false),
    dryRun,
    notificationsCollection: env.NOTIFICATIONS_COLLECTION?.trim() || "reservationNotifications",
    source: {
      parentCollection: env.RESERVATION_PARENT_COLLECTION?.trim() || "workshiftGroups",
      subCollection: env.RESERVATION_SUBCOLLECTION?.trim() || "reservations",
      dateField: env.RESERVATION_DATE_FIELD?.trim() || "openTime",
      maidIdField: env.RESERVATION_MAID_ID_FIELD?.trim() || "maidId",
      maidNicknameField: env.RESERVATION_MAID_NICKNAME_FIELD?.trim() || "maidNickname",
      customerLabelField: env.RESERVATION_CUSTOMER_LABEL_FIELD?.trim() || "",
      filterField: env.RESERVATION_FILTER_FIELD?.trim() ?? "roomType",
      filterValue: env.RESERVATION_FILTER_VALUE?.trim() ?? "reservation",
      maxDocuments: intEnv(env.MAX_DOCUMENTS, 5000, 1, 10000, "MAX_DOCUMENTS"),
    },
  };
}
