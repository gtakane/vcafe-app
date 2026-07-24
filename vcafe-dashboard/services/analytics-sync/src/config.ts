export interface SyncConfig {
  productionProjectId: string;
  analyticsProjectId: string;
  dataset: string;
  location: string;
  start: Date;
  end: Date;
  maxDocuments: number;
  hmacSecret: string;
  dryRun: boolean;
}

function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadSyncConfig(env: NodeJS.ProcessEnv, now = new Date()): SyncConfig {
  if (env.CONFIRM_READ_ONLY_SYNC !== "I_UNDERSTAND_THIS_READS_PRODUCTION") {
    throw new Error("本番読み取り確認がないため同期を開始しません");
  }
  const productionProjectId = required(env, "PRODUCTION_PROJECT_ID");
  const analyticsProjectId = required(env, "ANALYTICS_PROJECT_ID");
  if (productionProjectId === analyticsProjectId) throw new Error("本番と分析用プロジェクトは分離してください");
  const hasExplicitWindow = Boolean(env.SYNC_START || env.SYNC_END);
  if (hasExplicitWindow && (!env.SYNC_START || !env.SYNC_END)) throw new Error("SYNC_STARTとSYNC_ENDは両方指定してください");
  const lookbackMinutes = Number(env.SYNC_LOOKBACK_MINUTES || 90);
  if (!Number.isInteger(lookbackMinutes) || lookbackMinutes < 15 || lookbackMinutes > 1440) throw new Error("SYNC_LOOKBACK_MINUTESは15〜1440で指定してください");
  const end = hasExplicitWindow ? new Date(env.SYNC_END!) : now;
  const start = hasExplicitWindow ? new Date(env.SYNC_START!) : new Date(end.getTime() - lookbackMinutes * 60 * 1000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new Error("同期期間が不正です");
  if (end.getTime() - start.getTime() > 24 * 60 * 60 * 1000) throw new Error("1回の同期期間は24時間以内にしてください");
  const maxDocuments = Number(env.MAX_DOCUMENTS || 5000);
  if (!Number.isInteger(maxDocuments) || maxDocuments < 1 || maxDocuments > 10000) throw new Error("MAX_DOCUMENTSは1〜10000で指定してください");
  const hmacSecret = required(env, "CUSTOMER_ID_HMAC_SECRET");
  if (hmacSecret.length < 32) throw new Error("CUSTOMER_ID_HMAC_SECRETは32文字以上必要です");
  return {
    productionProjectId,
    analyticsProjectId,
    dataset: required(env, "BIGQUERY_DATASET"),
    location: env.BIGQUERY_LOCATION || "asia-northeast1",
    start,
    end,
    maxDocuments,
    hmacSecret,
    dryRun: env.DRY_RUN !== "false",
  };
}
