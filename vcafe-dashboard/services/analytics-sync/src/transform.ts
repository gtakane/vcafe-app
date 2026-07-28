import { createHmac } from "node:crypto";
import { firestoreTimestampToIso, mapFirestoreUser } from "../../../lib/user-mapping.ts";
import { classifyVisit, COIN_TO_YEN, DEFAULT_INITIAL_TIME, visitRevenue, visitWeight } from "../../../lib/metrics.ts";
import type { Customer, Present, Shift, Visit } from "../../../lib/types.ts";

export interface SourceDocument {
  id: string;
  parentId?: string;
  data: Record<string, unknown>;
  updatedAt?: string;
}

export interface ChekiRow {
  id: string;
  customerId: string;
  maidId: string;
  at: string;
  syncedAt: string;
  sourceUpdatedAt: string | null;
}

export interface ShiftRow extends Shift {
  maidName: string;
}

export function pseudonymizeCustomerId(customerId: string, secret: string) {
  return createHmac("sha256", secret).update(customerId, "utf8").digest("hex");
}

function numberValue(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

export function mapUser(document: SourceDocument, secret: string): Customer | null {
  const customer = mapFirestoreUser(document.id, document.data);
  return customer ? { ...customer, id: pseudonymizeCustomerId(customer.id, secret) } : null;
}

function maidId(document: SourceDocument, maidIdsByNickname: Map<string, string>) {
  const explicit = String(document.data.maidId || "").trim();
  const nickname = String(document.data.maidNickname || "").trim();
  return explicit || maidIdsByNickname.get(nickname) || `nickname:${nickname || "unknown"}`;
}

export function mapVisit(document: SourceDocument, secret: string, maidIdsByNickname: Map<string, string>): Visit | null {
  if (!document.parentId) return null;
  const at = firestoreTimestampToIso(document.data.enterDateTime);
  if (!at) return null;
  const ticketId = String(document.data.usedTicketItemId || "ATCOIN");
  const roomType = String(document.data.roomType || "");
  const billedCoin = numberValue(document.data.billedCoin);
  const billedReward = numberValue(document.data.billedRewardPoint);
  // 分類・収益・重みは lib/metrics.ts（core.py と一致する単一の正典）に委譲する。
  const type = classifyVisit(ticketId, roomType);
  const revenue = visitRevenue(type, ticketId, billedCoin, billedReward);
  const minutes = numberValue(document.data.initialTime) || DEFAULT_INITIAL_TIME;
  const weight = visitWeight(minutes);
  return {
    id: document.id, at, maidId: maidId(document, maidIdsByNickname),
    customerId: pseudonymizeCustomerId(document.parentId, secret),
    type, revenue, cheki: 0, weight,
    // 明細表示用（どのチケットで何分、コイン払いか）。
    ticketId, minutes, billedCoin, billedRewardPoint: billedReward,
  };
}

// users/{id}/userRecordPresents/{id} = メイドへのアイテムプレゼント（アイテム使用実績）。
export function mapPresent(document: SourceDocument, secret: string, maidIdsByNickname: Map<string, string>): Present | null {
  if (!document.parentId) return null;
  const at = firestoreTimestampToIso(document.data.presentDateTime);
  if (!at) return null;
  return {
    id: document.id,
    customerId: pseudonymizeCustomerId(document.parentId, secret),
    maidId: maidId(document, maidIdsByNickname),
    at,
    itemName: String(document.data.itemName || "").trim() || "アイテム",
    category: String(document.data.category || ""),
    quantity: numberValue(document.data.quantity) || 1,
    variationName: String(document.data.variationName || ""),
  };
}

export function mapCheki(document: SourceDocument, secret: string, maidIdsByNickname: Map<string, string>, syncedAt: string): ChekiRow | null {
  if (!document.parentId) return null;
  const at = firestoreTimestampToIso(document.data.date);
  if (!at) return null;
  return { id: document.id, customerId: pseudonymizeCustomerId(document.parentId, secret), maidId: maidId(document, maidIdsByNickname), at, syncedAt, sourceUpdatedAt: document.updatedAt || null };
}

export function mapShift(document: SourceDocument): ShiftRow | null {
  const scheduledStart = firestoreTimestampToIso(document.data.openTime);
  const scheduledEnd = firestoreTimestampToIso(document.data.closeTime);
  if (!scheduledStart || !scheduledEnd) return null;
  const starts = Array.isArray(document.data.serveStartTime) ? document.data.serveStartTime : [];
  const ends = Array.isArray(document.data.serveEndTime) ? document.data.serveEndTime : [];

  // serveStartTime/serveEndTime は「お給仕セッションごと」の打刻の配列で、
  // 並び順も要素数も保証されない。本番には誤タップで数十秒だけ開閉した記録や、
  // 最後のセッションが閉じられず終了打刻が1件少ない行が存在する。
  // 添字([0] / at(-1))で取ると、そうした行で終了が開始の直後になり
  // お給仕時間が「26秒」のように潰れるため、最小・最大で取る。
  const toMillis = (value: unknown) => {
    const iso = firestoreTimestampToIso(value);
    const ms = iso ? Date.parse(iso) : Number.NaN;
    return Number.isFinite(ms) ? ms : null;
  };
  const startMillis = starts.map(toMillis).filter((v): v is number => v !== null);
  const endMillis = ends.map(toMillis).filter((v): v is number => v !== null);

  const actualStart = startMillis.length ? new Date(Math.min(...startMillis)) : null;
  // 終了打刻が開始打刻より少ない＝最後のセッションが閉じていない。
  // いつ終えたか分からないため未打刻として扱い、予定時刻で補完させる（core.py の fillna と同じ）。
  const closed = endMillis.length > 0 && endMillis.length >= startMillis.length;
  const endCandidate = closed ? new Date(Math.max(...endMillis)) : null;
  // 終了が開始以前の記録は使わない（誤タップ等）。
  const actualEnd = endCandidate && actualStart && endCandidate <= actualStart ? null : endCandidate;

  return {
    id: document.id,
    maidId: String(document.data.maidId || `nickname:${String(document.data.maidNickname || "unknown")}`),
    maidName: String(document.data.maidNickname || "名称未設定"),
    scheduledStart,
    scheduledEnd,
    actualStart: actualStart ? actualStart.toISOString() : null,
    actualEnd: actualEnd ? actualEnd.toISOString() : null,
  };
}

export interface PaymentRowOut {
  id: string;
  customerId: string;
  at: string;
  amount: number;
  coin: number;
  channel: string;
  productId: string;
  status: string;
  // 取り込み元コレクション。userPayments が全時代の台帳（正）で、
  // payments/purchaseLog 由来の行は検証用に raw へ残すが集計からは除外する。
  source: string;
}

// payments/{id} = Stripe/Webstore の課金ログ（author=ユーザーID、paymentAmount=円）。
export function mapPayment(document: SourceDocument, secret: string): PaymentRowOut | null {
  const author = String(document.data.author || "").trim();
  const at = firestoreTimestampToIso(document.data.requestDate) || firestoreTimestampToIso(document.data.stripeEventDate);
  if (!author || !at) return null;
  return {
    id: document.id,
    customerId: pseudonymizeCustomerId(author, secret),
    at,
    amount: numberValue(document.data.paymentAmount),
    coin: 0,
    channel: "webstore",
    productId: String(document.data.productId || document.data.itemId || ""),
    status: String(document.data.stripeStatus || ""),
    source: "payments",
  };
}

// purchaseLog/{id} = アプリ内課金ログ（userId、coinSendToChargeCoin=購入コイン数）。
// 金額(円)は保持していないため amount は 0 とし、コイン数で把握する。
export function mapPurchase(document: SourceDocument, secret: string): PaymentRowOut | null {
  const userId = String(document.data.userId || "").trim();
  const at = firestoreTimestampToIso(document.data.confirmPurchaseTime)
    || firestoreTimestampToIso(document.data.chargeCoinSucceedTime)
    || firestoreTimestampToIso(document.data.purchaseProcessingEndTime);
  if (!userId || !at) return null;
  return {
    id: document.id,
    customerId: pseudonymizeCustomerId(userId, secret),
    at,
    // アプリ内課金は円額を保持していないため、コイン数 × 1.4円 で円換算する（COIN_TO_YEN）。
    amount: Math.round(numberValue(document.data.coinSendToChargeCoin) * COIN_TO_YEN),
    coin: numberValue(document.data.coinSendToChargeCoin),
    channel: "inapp",
    productId: String(document.data.productId || ""),
    status: document.data.purchaseIsSuccessful === true ? "succeeded" : String(document.data.purchaseFailedReason || "failed"),
    source: "purchaseLog",
  };
}

// users/{uid}/userPayments/{id} = 全時代の課金台帳。
//   WEB版(2020-11〜): amount=実払い円 + requestDate/paymentDate（requestDateのみの行は未完了）
//   アプリ版(2023-10〜): coinVendor + chargeCoin + amount=ストア実払い円
// アプリ内課金も実払い円額を持つため、purchaseLog のコイン×1.4円換算より正確。
// payments/purchaseLog と重複するため、集計(payments_current)はこの source だけを使う。
export function mapUserPayment(document: SourceDocument, secret: string): PaymentRowOut | null {
  if (!document.parentId) return null;
  const at = firestoreTimestampToIso(document.data.paymentDate) || firestoreTimestampToIso(document.data.requestDate);
  const amount = numberValue(document.data.amount);
  const coin = numberValue(document.data.chargeCoin);
  // 金額もコインも無い行（決済リクエストのみで未完了）は数えない。
  if (!at || (amount <= 0 && coin <= 0)) return null;
  const customerId = pseudonymizeCustomerId(document.parentId, secret);
  return {
    // ドキュメントIDはユーザー配下でしか一意でないため、仮名化IDの先頭を付けて衝突を防ぐ。
    id: `${document.id}:${customerId.slice(0, 8)}`,
    customerId,
    at,
    amount,
    coin,
    channel: document.data.coinVendor ? "inapp" : "webstore",
    productId: String(document.data.productId || document.data.itemId || ""),
    status: document.data.paymentDate ? "succeeded" : "amount-only",
    source: "userPayments",
  };
}

export function buildMaidMap(shifts: SourceDocument[]) {
  const map = new Map<string, string>();
  shifts.forEach((document) => {
    const id = String(document.data.maidId || "").trim();
    const nickname = String(document.data.maidNickname || "").trim();
    if (id && nickname) map.set(nickname, id);
  });
  return map;
}

// ---- maidWorkReport（メイド名簿＋月次実績）: 顧客PIIを含まないため仮名化不要 ----

export interface MaidProfileRow {
  id: string;
  nickname: string;
  active: boolean;
  hourlyPay: number;
  registrationDate: string | null;
}

export interface MaidMonthlyRow {
  maidId: string;
  month: string;
  attendance: number;
  attendanceReserve: number;
  days: number;
  late: number;
  latetime: number;
  lateReservation: number;
  latetimeReservation: number;
  totalReservation: number;
  totalWorkTimes: number;
  totalWorkTimesReserve: number;
  presumeTotalWorkTimeReserve: number;
  totalVisits: number;
  totalOtameshi: number;
  totalPresents: number;
  totalPresentsPrice: number;
  totalPhoto: number;
  totalBirthdayPhotos: number;
}

// maidWorkReport/{maidId} = メイドのプロフィール。
export function mapMaidProfile(id: string, data: Record<string, unknown>): MaidProfileRow {
  return {
    id,
    nickname: String(data.nickname ?? "").trim() || "名称未設定",
    active: data.active === true,
    hourlyPay: numberValue(data.hourlyPay),
    registrationDate: firestoreTimestampToIso(data.registrationDate),
  };
}

// maidWorkReport/{maidId}/monthlyReport/{YYYYMM} = 月次実績（本番のフィールド名をそのまま保持）。
export function mapMonthlyReport(maidId: string, month: string, data: Record<string, unknown>): MaidMonthlyRow {
  return {
    maidId,
    month,
    attendance: numberValue(data.Attendance),
    attendanceReserve: numberValue(data.AttendanceReserve),
    days: numberValue(data.days),
    late: numberValue(data.late),
    latetime: numberValue(data.latetime),
    lateReservation: numberValue(data.lateReservation),
    latetimeReservation: numberValue(data.latetimeReservation),
    totalReservation: numberValue(data.totalReservation),
    totalWorkTimes: numberValue(data.totalWorkTimes),
    totalWorkTimesReserve: numberValue(data.totalWorkTimesReserve),
    presumeTotalWorkTimeReserve: numberValue(data.presumeTotalWorkTimeReserve),
    totalVisits: numberValue(data.totalVisits),
    totalOtameshi: numberValue(data.totalOtameshi),
    totalPresents: numberValue(data.totalPresents),
    totalPresentsPrice: numberValue(data.totalPresentsPrice),
    totalPhoto: numberValue(data.totalPhoto),
    totalBirthdayPhotos: numberValue(data.totalBirthdayPhotos),
  };
}
