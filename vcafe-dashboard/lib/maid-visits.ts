import type { AnalyticsData, MaidVisitLog, PresentLike, Viewer, Visit } from "./types";
import { businessDateJst, DEFAULT_INITIAL_TIME, FREE_TICKET_IDS, TICKET_PRICES } from "./metrics.ts";
// 実接客時間の算出は metrics.ts（サーバー依存なしの共通ロジック）にある。
export { mergedStayMinutes } from "./metrics.ts";

// メイド個別のご帰宅明細（何日の何時に・誰が・何分・何のチケットで・コイン払いか・
// チェキ有無・アイテムプレゼント有無）。

const TICKET_LABELS: Record<string, string> = {
  ATCOIN: "あっとコイン",
  gokitaku30minutes: "ご帰宅30分チケット",
  premiumGokitaku1: "プレミアムご帰宅チケット",
  luckyGokitaku: "ラッキーご帰宅チケット",
  trial10minutes: "お試しご帰宅チケット",
};

export function ticketLabel(ticketId: string): string {
  if (!ticketId) return "—";
  return TICKET_LABELS[ticketId] || ticketId;
}

export function typeLabel(type: Visit["type"]): string {
  if (type === "reservation") return "予約";
  if (type === "trial") return "お試し";
  if (type === "free") return "無料";
  return "有料";
}

/** 支払い手段。チケットIDが既知チケットならチケット、ATCOIN/未設定でコイン消費があればコイン払い。 */
export function paymentLabel(type: Visit["type"], ticketId: string, billedCoin: number, billedRewardPoint: number): string {
  if (type === "reservation") return "予約";
  if (FREE_TICKET_IDS.has(ticketId)) return "無料(お試し)";
  if (ticketId && ticketId !== "ATCOIN" && ticketId in TICKET_PRICES) return "チケット";
  if (billedCoin > 0 && billedRewardPoint > 0) return "あっとコイン+リワードP";
  if (billedCoin > 0) return "あっとコイン";
  if (billedRewardPoint > 0) return "リワードポイント";
  return ticketId && ticketId !== "ATCOIN" ? "チケット" : "—";
}

export type { PresentLike };

/**
 * ご帰宅明細を組み立てる純関数。プレゼントは営業日＋ユーザー＋メイドが一致するものを紐づける
 * （チェキと同じ突き合わせ方）。
 */
export function buildMaidVisitLogs(
  visits: Visit[],
  maids: Array<{ id: string; name: string }>,
  customers: Array<{ id: string; name: string }>,
  presents: PresentLike[],
): MaidVisitLog[] {
  const maidNames = new Map(maids.map((maid) => [maid.id, maid.name]));
  const customerNames = new Map(customers.map((customer) => [customer.id, customer.name]));
  const presentsByKey = new Map<string, { count: number; names: string[] }>();
  for (const present of presents) {
    const key = `${present.customerId}|${present.maidId}|${businessDateJst(present.at)}`;
    const entry = presentsByKey.get(key) || { count: 0, names: [] };
    entry.count += present.quantity || 1;
    if (present.itemName && !entry.names.includes(present.itemName)) entry.names.push(present.itemName);
    presentsByKey.set(key, entry);
  }
  // 同じ営業日に複数回ご帰宅した場合、プレゼントは最初の1件にだけ計上して二重集計を避ける。
  const usedPresentKeys = new Set<string>();
  return [...visits]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((visit) => {
      const key = `${visit.customerId}|${visit.maidId}|${businessDateJst(visit.at)}`;
      const present = !usedPresentKeys.has(key) ? presentsByKey.get(key) : undefined;
      if (present) usedPresentKeys.add(key);
      const ticketId = visit.ticketId || "";
      const billedCoin = visit.billedCoin ?? 0;
      const billedRewardPoint = visit.billedRewardPoint ?? 0;
      return {
        id: visit.id,
        at: visit.at,
        customerId: visit.customerId,
        customerName: customerNames.get(visit.customerId) || "非表示",
        maidId: visit.maidId,
        maidName: maidNames.get(visit.maidId) || "—",
        type: visit.type,
        typeLabel: typeLabel(visit.type),
        // リワードポイント払い等では initialTime に実測の小数分が入る（例 9.7757…）。
        // そのまま表示すると「9.776」が千区切りの 9,776 に見えるため、分は整数へ丸める。
        minutes: Math.round(visit.minutes ?? DEFAULT_INITIAL_TIME),
        ticketId,
        ticketLabel: ticketLabel(ticketId),
        payment: paymentLabel(visit.type, ticketId, billedCoin, billedRewardPoint),
        billedCoin,
        billedRewardPoint,
        revenue: visit.revenue,
        cheki: visit.cheki,
        presents: present?.count ?? 0,
        presentNames: present?.names.join("・") ?? "",
      };
    });
}

export interface MaidVisitQuery { maidId?: string; customerId?: string; start: string; end: string }

/** プレゼントを本番(BigQuery)から取得する。未同期・未作成なら空配列。 */
async function loadPresents(query: MaidVisitQuery): Promise<PresentLike[]> {
  const projectId = process.env.BIGQUERY_PROJECT_ID;
  const dataset = process.env.BIGQUERY_DATASET;
  if (!projectId || !dataset) return [];
  const { BigQuery } = await import("@google-cloud/bigquery");
  const bigquery = new BigQuery({ projectId });
  const params: Record<string, string> = { startDate: query.start, endDate: query.end };
  if (query.maidId) params.maidId = query.maidId;
  if (query.customerId) params.customerId = query.customerId;
  try {
    const [rows] = await bigquery.query({
      location: process.env.BIGQUERY_LOCATION || "asia-northeast1",
      params,
      maximumBytesBilled: process.env.BIGQUERY_MAX_BYTES_BILLED || "1073741824",
      query: `
        SELECT customerId, maidId, \`at\`, itemName, quantity
        FROM \`${projectId}.${dataset}.presents_current\`
        WHERE DATE(TIMESTAMP_SUB(\`at\`, INTERVAL 2 HOUR), "Asia/Tokyo") BETWEEN DATE(@startDate) AND DATE(@endDate)
        ${query.maidId ? "AND maidId = @maidId" : ""}
        ${query.customerId ? "AND customerId = @customerId" : ""}
      `,
    });
    return rows.map((row) => ({
      customerId: String(row.customerId),
      maidId: String(row.maidId),
      at: typeof row.at === "object" && row.at && "value" in row.at ? String((row.at as { value: unknown }).value) : String(row.at),
      itemName: String(row.itemName || "アイテム"),
      quantity: Number(row.quantity || 1),
    }));
  } catch (error) {
    // 取得失敗を空配列にすると「アイテム使用0件」と区別できず、障害が正常値として表示される。
    // 呼び出し側でエラーとして扱えるよう送出する。
    throw new Error(`プレゼントを取得できませんでした: ${(error as Error).message}`, { cause: error });
  }
}

/** 期間内のご帰宅明細を返す。data は既にスコープ済みの分析データ。 */
export async function loadMaidVisitLogs(data: AnalyticsData, query: MaidVisitQuery): Promise<MaidVisitLog[]> {
  const visits = data.visits.filter((visit) =>
    (!query.maidId || visit.maidId === query.maidId) && (!query.customerId || visit.customerId === query.customerId));
  const presents = process.env.ANALYTICS_BACKEND === "bigquery" ? await loadPresents(query) : mockPresents(visits);
  return buildMaidVisitLogs(visits, data.maids, data.customers, presents);
}

/**
 * 閲覧者に応じたご帰宅明細を返す。
 *
 * **順序が重要**: プレゼントは BigQuery から元のHMAC customerId で返るため、
 * 先に匿名化してしまうと結合キーが一致せず、maid には常に「アイテム使用0件」と表示される。
 * 元のIDでサーバー内結合を済ませてから、完成したログを匿名化する。
 * HMAC ID と実名は maid のブラウザへ渡さない。
 */
export async function buildScopedVisitLogs(
  data: AnalyticsData,
  query: MaidVisitQuery,
  viewer: Viewer,
  presentsOverride?: PresentLike[],
): Promise<MaidVisitLog[]> {
  const visits = data.visits.filter((visit) =>
    (!query.maidId || visit.maidId === query.maidId) && (!query.customerId || visit.customerId === query.customerId));
  const presents = presentsOverride
    ?? (process.env.ANALYTICS_BACKEND === "bigquery" ? await loadPresents(query) : mockPresents(visits));

  // ここまでは元のHMAC IDのまま。結合が成立する。
  const logs = buildMaidVisitLogs(visits, data.maids, data.customers, presents);
  if (viewer.role === "admin") return logs;

  // 完成したログを匿名化する。表示に必要な集計値は保持したまま、識別子だけ置き換える。
  const aliases = new Map<string, string>();
  for (const visit of visits) {
    if (!aliases.has(visit.customerId)) {
      aliases.set(visit.customerId, `segment-${String(aliases.size + 1).padStart(3, "0")}`);
    }
  }
  return logs.map((log) => ({
    ...log,
    customerId: aliases.get(log.customerId) ?? "segment-000",
    customerName: "非表示",
  }));
}

// デモ用: 4回に1回プレゼントがあったことにする。
function mockPresents(visits: Visit[]): PresentLike[] {
  return visits
    .filter((_, index) => index % 4 === 0)
    .map((visit) => ({ customerId: visit.customerId, maidId: visit.maidId, at: visit.at, itemName: "パステルパールブレスレット", quantity: 1 }));
}
