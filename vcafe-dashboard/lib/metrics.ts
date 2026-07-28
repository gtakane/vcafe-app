// 収益・訪問分類・営業日・稼働時間の共通ロジック（TypeScript側の単一の正典 = SoT）。
//
// 既存Streamlit実装 `core.py` と「同じ本番データから同じ数値」を出すことを目的とする。
// 対応関係（core.py → 本ファイル）:
//   TICKET_PRICES / RESERVATION_PRICE / CHEKI_PRICE / 係数1.4  → 下記定数
//   _calc_revenue                                            → visitRevenue()
//   _classify_type（無料=trialのみ, それ以外=有料）           → classifyVisit() / isPaid()
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

export const TICKET_PRICES: Record<string, number> = {
  gokitaku30minutes: 840,
  premiumGokitaku1: 960,
  luckyGokitaku: 650,
};
export const RESERVATION_PRICE = 3920;
export const CHEKI_PRICE = 500;
export const COIN_TO_YEN = 1.4; // フォールバック係数（core.py と一致）
export const FREE_TICKET_IDS = new Set(["trial10minutes"]);
export const DEFAULT_INITIAL_TIME = 20; // core.py: initialTime 既定値

export type VisitType = Visit["type"];

/** 滞在時間による重み。core.py: weight = max(1, round(initialTime/20))。 */
export function visitWeight(initialTime: number | null | undefined): number {
  const raw = Number(initialTime ?? DEFAULT_INITIAL_TIME);
  const safe = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INITIAL_TIME;
  return Math.max(1, Math.round(safe / DEFAULT_INITIAL_TIME));
}

/** 訪問種別。core.py: 無料=trialチケットのみ、予約はroomType、それ以外は有料。 */
export function classifyVisit(ticketId: string, roomType: string): VisitType {
  if (FREE_TICKET_IDS.has(ticketId)) return "trial";
  if (roomType === "reservation") return "reservation";
  return "paid";
}

/** 収益。core.py _calc_revenue と一致（予約=3920、既知チケット=定価、他=round((coin+reward)*1.4)）。 */
export function visitRevenue(type: VisitType, ticketId: string, billedCoin: number, billedReward: number): number {
  if (type === "trial" || type === "free") return 0;
  if (type === "reservation") return RESERVATION_PRICE;
  if (ticketId in TICKET_PRICES) return TICKET_PRICES[ticketId];
  return Math.round((billedCoin + billedReward) * COIN_TO_YEN);
}

/** 有料判定。core.py: 有料=非trial（予約も有料に含む）。 */
export function isPaid(type: VisitType): boolean {
  return type !== "trial" && type !== "free";
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

/** ご帰宅数（重み付き）。core.py: agg_daily/agg_by_maid の visitWeight 合算。 */
export function weightedVisitCount(visits: Visit[]): number {
  return visits.reduce((sum, v) => sum + (v.weight ?? 1), 0);
}

/** 有料数（重み付き）。core.py: paid_weight = visitWeight * (type=='有料')。 */
export function weightedPaidCount(visits: Visit[]): number {
  return visits.reduce((sum, v) => sum + (isPaid(v.type) ? v.weight ?? 1 : 0), 0);
}
