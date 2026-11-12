// 収益・訪問分類・営業日・稼働時間の共通ロジック（TypeScript側の単一の正典 = SoT）。
//
// 既存Streamlit実装 `core.py` と「同じ本番データから同じ数値」を出すことを目的とする。
// 対応関係（core.py → 本ファイル）:
//   TICKET_PRICES / RESERVATION_PRICE / CHEKI_PRICE / 係数1.4  → LEGACY_TICKET_PRICES ほか
//   _calc_revenue                                            → legacyVisitRevenue()
//     ※2026-11以降、ダッシュボードの売上は経理の計上ロジックに合わせた visitRevenue() を使う（下記）。
//   _classify_type（無料=trialのみ, それ以外=有料）           → classifyVisit() / isPaid()
//     ※2026-11-06以降の無料ご帰宅3種（isFreeEntry/entryType）は本ファイル側でのみ判定している。
//       core.py（Streamlit版）は未対応のため、11/6以降の有料件数はStreamlit版と一致しない。
//   visitWeight = max(1, round(initialTime/20))              → visitWeight()
//   _biz_date（0:00〜1:59を前日扱い）                          → businessDateJst()
//   calc_shift_detail（serve*.fillna(open/close)）           → shiftActualHours() / shiftLateMinutes()
//
// 定数を変更する場合は core.py 側も必ず合わせること（二重管理を避けたいが言語が異なるため相互参照コメントで担保）。

import type { Shift, Visit } from "./types";

// 座席モデル: 同時に最大3名着席可、1枠=20分（重みの単位と一致）。
// よってメイド1時間の稼働 = 3席 × 3枠/時 = 最大9名分の利用枠。
// クライアント(dashboard.tsx)からも参照するため、サーバー依存の無い本ファイルに置く。
export const SEATS_PER_MAID = 3;
export const SLOTS_PER_HOUR = 3; // 60分 / 20分
export const CAPACITY_PER_MAID_HOUR = SEATS_PER_MAID * SLOTS_PER_HOUR; // = 9

// ---------------------------------------------------------------------------
// 売上の単価（2026-11〜）。経理の計上ロジック「Vあっと売上計上関連（経営管理報告用）」と同じ円換算。
//   売上 = 購入額 + 前月末の未使用残高 − 当月末の未使用残高（税込）であり、未使用残高は次の単価で円換算される。
//   - Apple/Googleコイン … 1.19円（1.4円からストア手数料15%を控除した額）
//   - リワードポイント   … 1.1円（Stripeで購入したウェブコイン等）
//   - チケット           … ご帰宅850円 / プレミアム960円 / ランダム650円 / 記念撮影500円
// ご帰宅単位の売上はこの単価で「消費額」を出したもの。アイテム購入・失効・無償付与は含まれないため、
// 月の確定値は経理と同じ残高の差し引きで別途出す。
// ---------------------------------------------------------------------------
export const TICKET_PRICES: Record<string, number> = {
  gokitaku30minutes: 850,
  premiumGokitaku1: 960,
  luckyGokitaku: 650,
};
export const CHEKI_PRICE = 500;
export const COIN_YEN = 1.19; // Apple/Googleコイン1枚の円換算（手数料控除後）
export const REWARD_POINT_YEN = 1.1; // リワードポイント1点の円換算
// 無料のチェキ（売上にしない）。userAlbum.type の値。
export const FREE_CHEKI_TYPES = new Set(["birthdayGift", "birthdayGiftSigned"]);
export const TAX_RATE = 0.1;

// 旧定義（core.py との互換用。Streamlit版は引き続きこの値で計算している）。
export const LEGACY_TICKET_PRICES: Record<string, number> = { gokitaku30minutes: 840, premiumGokitaku1: 960, luckyGokitaku: 650 };
export const RESERVATION_PRICE = 3920;
export const COIN_TO_YEN = 1.4; // フォールバック係数（core.py と一致）
// お試しご帰宅（従来からある10分無料）。チケットIDで判定する。
export const FREE_TICKET_IDS = new Set(["trial10minutes"]);
// 2026-11-06（ver1.4.7/1.4.8）から始まった無料ご帰宅。ご帰宅記録の isFreeEntry=true と entryType で判定する。
//   freeTicket    … 無料ご帰宅券（10分・毎月1枚配布。usedTicketItemId=freeGokitaku）
//   newUserFree   … 新規ユーザー無料ご帰宅（20分・登録後14日以内・メイドごとに1回）
//   freshMaidFree … 新人メイド無料ご帰宅（20分・デビュー後の一定期間・1回）
export const FREE_ENTRY_TICKET_IDS = new Set(["freeGokitaku"]);
export type FreeKind = "trial" | "freeTicket" | "newUserFree" | "freshMaidFree" | "otherFree";
export const FREE_KINDS: FreeKind[] = ["trial", "freeTicket", "newUserFree", "freshMaidFree", "otherFree"];
export const FREE_KIND_LABELS: Record<FreeKind, string> = {
  trial: "お試し",
  freeTicket: "無料ご帰宅券",
  newUserFree: "新規ユーザー無料",
  freshMaidFree: "新人メイド無料",
  otherFree: "その他の無料",
};

/** ご帰宅記録の無料関連フィールド（Firestore の値そのまま）。 */
export interface FreeEntryFields {
  isFreeEntry?: unknown;
  entryType?: unknown;
}

function isTrue(value: unknown): boolean {
  return value === true || value === "true";
}
export const DEFAULT_INITIAL_TIME = 20; // core.py: initialTime 既定値

export type VisitType = Visit["type"];

/** 滞在時間による重み。core.py: weight = max(1, round(initialTime/20))。 */
export function visitWeight(initialTime: number | null | undefined): number {
  const raw = Number(initialTime ?? DEFAULT_INITIAL_TIME);
  const safe = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INITIAL_TIME;
  return Math.max(1, Math.round(safe / DEFAULT_INITIAL_TIME));
}

/**
 * 訪問種別。
 *   free        … 11/6以降の無料ご帰宅3種（isFreeEntry=true、または無料ご帰宅券のチケットID）
 *   trial       … お試しご帰宅（trial10minutes）
 *   reservation … 予約（roomType）
 *   paid        … それ以外
 * 無料の判定を予約より先に行う（無料枠での予約が来ても売上にしない）。
 */
export function classifyVisit(ticketId: string, roomType: string, entry: FreeEntryFields = {}): VisitType {
  if (isTrue(entry.isFreeEntry) || FREE_ENTRY_TICKET_IDS.has(ticketId)) return "free";
  if (FREE_TICKET_IDS.has(ticketId)) return "trial";
  if (roomType === "reservation") return "reservation";
  return "paid";
}

/** 旧定義の収益。core.py _calc_revenue と一致（予約=3920、既知チケット=定価840等、他=round((coin+reward)*1.4)）。 */
export function legacyVisitRevenue(type: VisitType, ticketId: string, billedCoin: number, billedReward: number): number {
  if (type === "trial" || type === "free") return 0;
  if (type === "reservation") return RESERVATION_PRICE;
  if (ticketId in LEGACY_TICKET_PRICES) return LEGACY_TICKET_PRICES[ticketId];
  return Math.round((billedCoin + billedReward) * COIN_TO_YEN);
}

/** 売上の内訳（税込・円）。Stripe側 = rewardPoint + ticket + cheki。 */
export interface RevenueParts {
  apple: number; // Appleコイン
  google: number; // Googleコイン
  coinUnknown: number; // 購入元を取得していない古い行のコイン（Apple/Googleどちらも1.19円なので合計は正しい）
  rewardPoint: number; // リワードポイント（ウェブコイン等）
  ticket: number; // チケット
  cheki: number; // 有料の記念撮影
}

export const EMPTY_REVENUE_PARTS: RevenueParts = { apple: 0, google: 0, coinUnknown: 0, rewardPoint: 0, ticket: 0, cheki: 0 };

export function addRevenueParts(a: RevenueParts, b: RevenueParts): RevenueParts {
  return {
    apple: a.apple + b.apple, google: a.google + b.google, coinUnknown: a.coinUnknown + b.coinUnknown,
    rewardPoint: a.rewardPoint + b.rewardPoint, ticket: a.ticket + b.ticket, cheki: a.cheki + b.cheki,
  };
}

export function totalOfParts(parts: RevenueParts): number {
  return parts.apple + parts.google + parts.coinUnknown + parts.rewardPoint + parts.ticket + parts.cheki;
}

/** コイン・リワードポイントの消費を購入元別の円に振り分ける（ご帰宅・予約・招待で共通）。 */
export function coinParts(coin: number, coinVendor: string | null | undefined, rewardPoint: number): RevenueParts {
  const coinYen = Math.round((Number(coin) || 0) * COIN_YEN);
  return {
    ...EMPTY_REVENUE_PARTS,
    apple: coinVendor === "apple" ? coinYen : 0,
    google: coinVendor === "google" ? coinYen : 0,
    coinUnknown: coinVendor === "apple" || coinVendor === "google" ? 0 : coinYen,
    rewardPoint: Math.round((Number(rewardPoint) || 0) * REWARD_POINT_YEN),
  };
}

/**
 * ご帰宅1件の売上の内訳（記念撮影を除く）。
 *   無料枠 … 0円
 *   予約   … 0円（コインは予約時に消費され、予約(userReservations)側で計上する。二重計上しない）
 *   チケット … 単価 × 使用枚数（40分=2枚など。枚数が未取得の古い行は1枚）
 *   コイン・リワードポイント … 消費量 × 単価（チケットと併用された場合も加算する）
 */
export function visitRevenueParts(visit: Pick<Visit, "type" | "ticketId" | "billedCoin" | "billedCoinVendor" | "billedRewardPoint" | "usedTicketCount">): RevenueParts {
  if (visit.type === "trial" || visit.type === "free" || visit.type === "reservation") return { ...EMPTY_REVENUE_PARTS };
  const ticketId = visit.ticketId || "";
  const count = visit.usedTicketCount == null ? 1 : Number(visit.usedTicketCount) || 0;
  const ticket = ticketId in TICKET_PRICES ? TICKET_PRICES[ticketId] * count : 0;
  return { ...coinParts(visit.billedCoin ?? 0, visit.billedCoinVendor, visit.billedRewardPoint ?? 0), ticket };
}

/** ご帰宅1件の売上（記念撮影を除く・税込・円）。同期時に visits_raw.revenue へ保存する値。 */
export function visitRevenue(
  type: VisitType, ticketId: string, billedCoin: number, billedReward: number,
  usedTicketCount?: number | null, billedCoinVendor?: string | null,
): number {
  return totalOfParts(visitRevenueParts({ type, ticketId, billedCoin, billedRewardPoint: billedReward, usedTicketCount, billedCoinVendor }));
}

/** 有料の記念撮影の枚数（誕生日プレゼント等の無料チェキを除く）。 */
export function paidChekiCount(visit: Pick<Visit, "cheki" | "freeCheki">): number {
  return Math.max(0, (visit.cheki ?? 0) - (visit.freeCheki ?? 0));
}

/** ご帰宅1件の売上（記念撮影を含む）。画面の売上集計はすべてこの関数を通す。 */
export function visitTotalRevenue(visit: Pick<Visit, "revenue" | "cheki" | "freeCheki">): number {
  return (visit.revenue ?? 0) + paidChekiCount(visit) * CHEKI_PRICE;
}

/** 税込の金額から税抜（10%）を出す。経理資料と同じく四捨五入。 */
export function excludingTax(amount: number): number {
  return Math.round(amount / (1 + TAX_RATE));
}

/** 有料判定。有料=無料枠（お試し・無料3種）以外。予約も有料に含む。 */
export function isPaid(type: VisitType): boolean {
  return type !== "trial" && type !== "free";
}

/** 無料枠（お試し＋無料3種）か。 */
export function isFree(type: VisitType): boolean {
  return !isPaid(type);
}

/**
 * 無料枠の内訳。有料なら null。
 * entryType が未知の値（今後の追加施策など）のときは otherFree に寄せ、件数を落とさない。
 */
export function freeKindOf(type: VisitType, ticketId?: string | null, entryType?: string | null): FreeKind | null {
  if (type === "trial") return "trial";
  if (type !== "free") return null;
  if (entryType === "freeTicket" || entryType === "newUserFree" || entryType === "freshMaidFree") return entryType;
  if (!entryType && ticketId && FREE_ENTRY_TICKET_IDS.has(ticketId)) return "freeTicket";
  return "otherFree";
}

/** 無料枠の内訳ごとの件数（重みなしの実件数）。 */
export function countFreeKinds(visits: Array<Pick<Visit, "type" | "ticketId" | "entryType">>): Record<FreeKind, number> {
  const counts = Object.fromEntries(FREE_KINDS.map((kind) => [kind, 0])) as Record<FreeKind, number>;
  for (const visit of visits) {
    const kind = freeKindOf(visit.type, visit.ticketId, visit.entryType);
    if (kind) counts[kind] += 1;
  }
  return counts;
}

/**
 * 営業日（JST, 'YYYY-MM-DD'）。core.py _biz_date: 営業時間19:00〜翌02:00のため
 * JSTで0:00〜1:59に発生したものは前日の営業日として扱う（= JSTから2時間引いた日付）。
 */
export function businessDateJst(atIso: string): string {
  const shifted = new Date(new Date(atIso).getTime() - 2 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 実働時間(h)。core.py calc_shift_detail: 実打刻が無ければ予定(open/close)で補完。 */
export function shiftActualHours(shift: Pick<Shift, "scheduledStart" | "scheduledEnd" | "actualStart" | "actualEnd">): number {
  const start = new Date(shift.actualStart ?? shift.scheduledStart).getTime();
  const end = new Date(shift.actualEnd ?? shift.scheduledEnd).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, end - start) / 3_600_000;
}

/** 遅刻分。core.py: 遅刻分 = max(0, actual_start - openTime)。未打刻(=予定で補完)なら0。 */
export function shiftLateMinutes(shift: Pick<Shift, "scheduledStart" | "actualStart">): number {
  const start = new Date(shift.actualStart ?? shift.scheduledStart).getTime();
  const scheduled = new Date(shift.scheduledStart).getTime();
  if (Number.isNaN(start) || Number.isNaN(scheduled)) return 0;
  return Math.max(0, start - scheduled) / 60_000;
}

/**
 * ご帰宅数の数え方（2026-11-12 に運営が指定。画面のすべての「ご帰宅数」と月次指標の「延べ客数」）。
 *   通常ご帰宅 … 滞在時間÷20分（20分=1件、40分=2件）。20分未満は0.5件
 *   予約ご帰宅・お試しご帰宅・無料ご帰宅（3種） … 滞在時間に関係なくそれぞれ1件で、別枠として数える
 *   合計ご帰宅数 … 上の4つの合計
 * 旧定義（core.py の visitWeight＝max(1, round(滞在時間/20))を全種別に適用）とは一致しない。
 */
export const VISIT_COUNT_DEFINITION =
  "通常ご帰宅は滞在時間÷20分で数えます（20分=1件、40分=2件、20分未満は0.5件）。予約・お試し・無料ご帰宅は滞在時間に関係なく1件ずつ、別枠で数えます。合計ご帰宅数はその合計です。";

/** 1件のご帰宅の滞在時間（分）。滞在時間を取り込む前の古い行は、旧定義の重み（20分=1）から戻す。 */
export function visitMinutes(visit: Pick<Visit, "minutes" | "weight">): number {
  const minutes = Number(visit.minutes);
  if (Number.isFinite(minutes) && minutes > 0) return minutes;
  const weight = Number(visit.weight);
  return Number.isFinite(weight) && weight > 0 ? weight * DEFAULT_INITIAL_TIME : DEFAULT_INITIAL_TIME;
}

/** 1件のご帰宅を何件と数えるか。 */
export function visitCount(visit: Pick<Visit, "type" | "minutes" | "weight">): number {
  if (visit.type !== "paid") return 1;
  const minutes = visitMinutes(visit);
  return minutes < DEFAULT_INITIAL_TIME ? 0.5 : minutes / DEFAULT_INITIAL_TIME;
}

export interface VisitCountBreakdown {
  normal: number; // 通常ご帰宅（換算後）
  normalVisits: number; // 通常ご帰宅の実回数
  reservation: number;
  trial: number;
  free: number; // 無料ご帰宅3種（無料ご帰宅券・新規ユーザー無料・新人メイド無料）
  total: number; // 合計ご帰宅数
}

export function visitCountBreakdown(visits: Array<Pick<Visit, "type" | "minutes" | "weight">>): VisitCountBreakdown {
  const result: VisitCountBreakdown = { normal: 0, normalVisits: 0, reservation: 0, trial: 0, free: 0, total: 0 };
  for (const visit of visits) {
    const count = visitCount(visit);
    if (visit.type === "paid") { result.normal += count; result.normalVisits += 1; }
    else result[visit.type] += count;
    result.total += count;
  }
  return result;
}

/** 合計ご帰宅数（visitCount の合計）。 */
export function weightedVisitCount(visits: Visit[]): number {
  return visits.reduce((sum, v) => sum + visitCount(v), 0);
}

/** 有料ご帰宅数＝通常（換算後）＋予約。お試し・無料3種は含めない。 */
export function weightedPaidCount(visits: Visit[]): number {
  return visits.reduce((sum, v) => sum + (isPaid(v.type) ? visitCount(v) : 0), 0);
}

/**
 * 重なりを除いた実接客時間（分）。
 *
 * 同時に最大3名が着席できるため、ユーザーごとの滞在分を単純に足した「延べ滞在」は
 * 実際の経過時間より大きくなる（3名同席の20分は延べ60分だが実時間は20分）。
 * ご帰宅を [開始, 終了) の区間とみなして重なりを結合し、実際に接客していた時間を返す。
 * この値はお給仕時間と直接比較でき、これを超えるなら重複計上か打刻漏れを疑える。
 */
export function mergedStayMinutes(logs: Array<{ at: string; minutes: number }>): number {
  const intervals = logs
    .map((log) => {
      const start = new Date(log.at).getTime();
      const minutes = Number(log.minutes);
      return { start, end: start + (Number.isFinite(minutes) ? Math.max(0, minutes) : 0) * 60000 };
    })
    .filter((i) => Number.isFinite(i.start) && i.end > i.start)
    .sort((a, b) => a.start - b.start);

  let total = 0;
  let currentStart = 0;
  let currentEnd = 0;
  for (const interval of intervals) {
    if (currentEnd === 0) { currentStart = interval.start; currentEnd = interval.end; continue; }
    if (interval.start <= currentEnd) {
      // 重なっている（または隣接）ので現在の区間を伸ばす。
      currentEnd = Math.max(currentEnd, interval.end);
    } else {
      total += currentEnd - currentStart;
      currentStart = interval.start;
      currentEnd = interval.end;
    }
  }
  if (currentEnd > currentStart) total += currentEnd - currentStart;
  return total / 60000;
}
