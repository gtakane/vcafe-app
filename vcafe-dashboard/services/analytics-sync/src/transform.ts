import { createHmac } from "node:crypto";
import { firestoreTimestampToIso, mapFirestoreUser } from "../../../lib/user-mapping.ts";
import { classifyVisit, COIN_TO_YEN, DEFAULT_INITIAL_TIME, visitRevenue, visitWeight } from "../../../lib/metrics.ts";
import type { Customer, Present, Shift, Visit } from "../../../lib/types.ts";

export interface SourceDocument {
  id: string;
  parentId?: string;
  /** Firestore のフルパス（例: users/{uid}/userRecordVisits/{id}）。recordKey の材料。 */
  path?: string;
  data: Record<string, unknown>;
  updatedAt?: string;
}

/**
 * 分析側の重複排除キー。
 *
 * collection group の document.id はグローバル一意ではなく、親が違えば重複し得る。
 * 旧実装は id を一意前提に insertId と ROW_NUMBER(PARTITION BY id) を組んでいたため、
 * 別ユーザー配下の同名ドキュメントが衝突し片方が消える可能性があった。
 *
 * フルパスの HMAC を使うことで親が違えば必ず別キーになる。
 * 生のパスやユーザーIDは分析側に保存しない（不可逆変換した結果だけを持つ）。
 */
export function recordKeyOf(path: string, secret: string): string {
  return createHmac("sha256", secret).update(path, "utf8").digest("hex");
}

/** path が無い場合の代替。コレクション名を含めて衝突を避ける。 */
function keyFor(document: SourceDocument, collection: string, secret: string): string {
  return recordKeyOf(document.path || `${collection}/${document.id}`, secret);
}

/** 同期内部の共通列。recordKey は分析側の重複排除キーで、ブラウザへは渡さない。 */
export interface SyncRowMeta {
  recordKey: string;
  sourceUpdatedAt: string | null;
}

export type VisitRow = Visit & SyncRowMeta;
export type PresentRow = Present & SyncRowMeta;

export interface ChekiRow {
  id: string;
  recordKey: string;
  customerId: string;
  maidId: string;
  at: string;
  syncedAt: string;
  sourceUpdatedAt: string | null;
}

export interface ShiftRow extends Shift {
  maidName: string;
  recordKey: string;
  sourceUpdatedAt: string | null;
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

/**
 * 正規 maidId を解決する。確定できない場合は null を返し、呼び出し側で reject させる。
 * 旧実装は `nickname:${...}` というフォールバックIDを作っていたが、
 * それを通常集計に混ぜると同一メイドが2つのIDに分裂し、実績が二分される。
 */
function maidId(document: SourceDocument, maidIdsByNickname: Map<string, string>): string | null {
  const explicit = String(document.data.maidId || "").trim();
  if (explicit) return explicit;
  const nickname = String(document.data.maidNickname || "").trim();
  if (!nickname) return null;
  return maidIdsByNickname.get(nickname) ?? null;
}

export function mapVisit(document: SourceDocument, secret: string, maidIdsByNickname: Map<string, string>): VisitRow | null {
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
  // メイドを確定できない行は集計へ混ぜず reject する（nickname:* による分裂を防ぐ）。
  const resolvedMaidId = maidId(document, maidIdsByNickname);
  if (!resolvedMaidId) return null;
  return {
    id: document.id,
    recordKey: keyFor(document, "userRecordVisits", secret),
    sourceUpdatedAt: document.updatedAt ?? null,
    at, maidId: resolvedMaidId,
    customerId: pseudonymizeCustomerId(document.parentId, secret),
    type, revenue, cheki: 0, weight,
    // 明細表示用（どのチケットで何分、コイン払いか）。
    ticketId, minutes, billedCoin, billedRewardPoint: billedReward,
  };
}

// users/{id}/userRecordPresents/{id} = メイドへのアイテムプレゼント（アイテム使用実績）。
export function mapPresent(document: SourceDocument, secret: string, maidIdsByNickname: Map<string, string>): PresentRow | null {
  if (!document.parentId) return null;
  const at = firestoreTimestampToIso(document.data.presentDateTime);
  if (!at) return null;
  const resolvedMaidId = maidId(document, maidIdsByNickname);
  if (!resolvedMaidId) return null;
  return {
    id: document.id,
    recordKey: keyFor(document, "userRecordPresents", secret),
    sourceUpdatedAt: document.updatedAt ?? null,
    customerId: pseudonymizeCustomerId(document.parentId, secret),
    maidId: resolvedMaidId,
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
  const resolvedMaidId = maidId(document, maidIdsByNickname);
  if (!resolvedMaidId) return null;
  return { id: document.id, recordKey: keyFor(document, "userAlbum", secret), customerId: pseudonymizeCustomerId(document.parentId, secret), maidId: resolvedMaidId, at, syncedAt, sourceUpdatedAt: document.updatedAt || null };
}

export function mapShift(document: SourceDocument, maidIdsByNickname: Map<string, string> = new Map(), secret = ""): ShiftRow | null {
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

  // シフトもメイドを確定できなければ reject する（maids_current に nickname:* を作らない）。
  const resolvedMaidId = maidId(document, maidIdsByNickname);
  if (!resolvedMaidId) return null;
  return {
    id: document.id,
    recordKey: keyFor(document, "workshifts", secret),
    sourceUpdatedAt: document.updatedAt ?? null,
    maidId: resolvedMaidId,
    maidName: String(document.data.maidNickname || "名称未設定"),
    scheduledStart,
    scheduledEnd,
    actualStart: actualStart ? actualStart.toISOString() : null,
    actualEnd: actualEnd ? actualEnd.toISOString() : null,
  };
}

export interface PaymentRowOut {
  id: string;
  recordKey: string;
  sourceUpdatedAt: string | null;
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
    recordKey: keyFor(document, "payments", secret),
    sourceUpdatedAt: document.updatedAt ?? null,
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
    recordKey: keyFor(document, "purchaseLog", secret),
    sourceUpdatedAt: document.updatedAt ?? null,
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
    // 一意性は recordKey（フルパスのHMAC）で担保するため、id は本来の値のままでよい。
    id: document.id,
    recordKey: keyFor(document, "userPayments", secret),
    sourceUpdatedAt: document.updatedAt ?? null,
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

/**
 * ニックネーム→正規maidId の解決表を、メイド名簿(maidWorkReport)から作る。
 *
 * 旧実装 buildMaidMap() は「その同期窓に含まれた workshifts」からしか作れなかったため、
 * 19時開始のシフトが窓外になる増分同期（既定90分窓）では翌1時の訪問を解決できず、
 * 同一メイドが正規IDと nickname:* に分裂していた。名簿は小規模なので毎回全件取得してよい。
 *
 * 同名が複数ある場合（改名・重複登録）はニックネームだけでは確定できないため、
 * **意図的に解決しない**。呼び出し側で reject させ、誤ったメイドへ計上されるのを防ぐ。
 */
export function buildMaidDirectory(profiles: Array<{ id: string; nickname: string }>) {
  const byNickname = new Map<string, string | null>(); // null = 曖昧（複数該当）
  for (const profile of profiles) {
    const nickname = String(profile.nickname || "").trim();
    const id = String(profile.id || "").trim();
    if (!nickname || !id) continue;
    if (byNickname.has(nickname) && byNickname.get(nickname) !== id) {
      byNickname.set(nickname, null); // 同名別IDが出た時点で確定不能にする
    } else {
      byNickname.set(nickname, id);
    }
  }
  const resolved = new Map<string, string>();
  for (const [nickname, id] of byNickname) {
    if (id) resolved.set(nickname, id);
  }
  return resolved;
}

/** 旧名。シフト由来の解決表（フォールバック用途にのみ残す）。 */
export function buildMaidMap(shifts: SourceDocument[]) {
  return buildMaidDirectory(shifts.map((document) => ({
    id: String(document.data.maidId || "").trim(),
    nickname: String(document.data.maidNickname || "").trim(),
  })));
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
