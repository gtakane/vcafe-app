export type Role = "admin" | "maid";
export type Granularity = "hour" | "day" | "week" | "month";

export interface Viewer {
  uid: string;
  name: string;
  role: Role;
  maidId?: string;
}

export interface Maid {
  id: string;
  name: string;
  avatar: string;
  status: "active" | "inactive";
}

export interface Customer {
  id: string;
  name: string;
  rank: string;
  registeredAt: string | null;
  // --- 以下は本番 users ドキュメント由来の付加情報（未同期環境では undefined/null）---
  gender?: string | null; // "male" | "female" | その他
  birthYear?: number | null; // birthdate[0]（年）
  active?: boolean | null;
  lastVisitAt?: string | null; // 最終ご帰宅日
  lastPaymentAt?: string | null; // 最終課金日
  lastPurchasedItemAt?: string | null; // 最終アイテム購入日
  lastPresentAt?: string | null; // 最終プレゼント日
  purchasedItemCoin?: number | null; // アイテム購入額（コイン）
  purchasedItemRewardPoint?: number | null; // アイテム購入額（リワードP）
  purchasedItemQuantity?: number | null; // アイテム購入数
  presentAmount?: number | null; // プレゼント（アイテム使用）回数
  coin?: number | null; // コイン残高
  rewardPoint?: number | null; // リワードポイント残高
  totalVisitAmount?: number | null; // 累計ご帰宅数（本番集計値）
  consecutiveVisitDays?: number | null;
  maxConsecutiveVisitDays?: number | null;
  // 期間内の課金集計（payments + purchaseLog から算出。BigQuery接続時のみ）
  paymentCount?: number | null;
  paymentAmount?: number | null;
}

// 課金ログ（Stripe/Webstore = payments、アプリ内課金 = purchaseLog）を1件に正規化したもの。
export interface PaymentRow {
  id: string;
  customerId: string;
  at: string;
  amount: number; // 円。アプリ内課金はコイン額を保持し amount は0
  coin: number;
  channel: "webstore" | "inapp";
  productId: string;
  status: string;
}

export interface Visit {
  id: string;
  at: string;
  maidId: string;
  customerId: string;
  type: "paid" | "trial" | "free" | "reservation";
  revenue: number;
  cheki: number;
  // 滞在時間による重み（core.py: max(1, round(initialTime/20))）。ご帰宅数の集計に使用。
  weight: number;
  // --- 明細表示用（メイド個別ログ）。未同期の古い行では undefined ---
  ticketId?: string | null; // 使用チケット（ATCOIN = あっとコイン払い）
  minutes?: number | null; // 滞在時間(分) = initialTime
  billedCoin?: number | null; // 消費コイン
  billedRewardPoint?: number | null; // 消費リワードポイント
}

// メイドへのアイテムプレゼント（userRecordPresents）。
export interface Present {
  id: string;
  customerId: string;
  maidId: string;
  at: string;
  itemName: string;
  category: string;
  quantity: number;
  variationName: string;
}

// メイド個別のご帰宅明細（1行 = 1ご帰宅）。
export interface MaidVisitLog {
  id: string;
  at: string;
  customerId: string;
  customerName: string;
  maidId: string;
  maidName: string;
  type: Visit["type"];
  typeLabel: string;
  minutes: number;
  ticketId: string;
  ticketLabel: string;
  payment: string; // "あっとコイン" / "チケット" / "予約" / "無料"
  billedCoin: number;
  billedRewardPoint: number;
  revenue: number;
  cheki: number;
  presents: number;
  presentNames: string;
}

export interface Shift {
  id: string;
  maidId: string;
  scheduledStart: string;
  scheduledEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
}

export interface AttendanceSubmission {
  id: string;
  eventType: "absence" | "shift_change" | "shift_add" | "late" | "early_leave";
  eventLabel: string;
  maidName: string;
  reason: string;
  status: string;
  targetDate: string | null;
  targetTime: string | null;
  receivedAt: string | null;
}

export interface AnalyticsData {
  generatedAt: string;
  maids: Maid[];
  customers: Customer[];
  visits: Visit[];
  shifts: Shift[];
}

// 本番 maidWorkReport/{maidId}/monthlyReport/{YYYYMM} 由来の月次メイド実績（正データ）。
export interface MaidMonthlyReport {
  maidId: string;
  month: string; // "YYYYMM"
  nickname: string;
  attendance: number; // お給仕回数
  totalWorkTimes: number; // お給仕時間
  late: number; // 遅刻回数
  latetime: number; // 遅刻時間
  totalReservation: number; // 予約ご帰宅回数
  totalWorkTimesReserve: number; // お給仕時間(予約)
  presumeTotalWorkTimeReserve: number; // 見なしお給仕時間(予約)
  lateReservation: number; // 遅刻回数(予約)
  latetimeReservation: number; // 遅刻時間(予約)
  totalVisits: number; // ご帰宅数
  totalOtameshi: number; // お試しご帰宅回数
  totalPresents: number; // プレゼント数
  totalPresentsPrice: number; // プレゼント売上
  totalPhoto: number; // 記念撮影回数
}

export interface MaidReportsResult {
  months: string[]; // 利用可能な月（降順）
  month: string; // 実際に返した月
  reports: MaidMonthlyReport[];
}


/** プレゼント（アイテム使用）の結合用の最小形。customerId は元のHMAC ID。 */
export interface PresentLike {
  customerId: string;
  maidId: string;
  at: string;
  itemName: string;
  quantity: number;
}

/**
 * 閲覧者スコープ適用後の分析データ。
 * admin は Customer 全列、maid は allowlist 済みの最小列（rank 等を持たない）。
 * 画面はこの union を受け取り、欠損列に依存しない実装にする。
 */
export type ViewerScopedCustomer = Customer | { id: string; name: string; registeredAt: string | null };

export interface ViewerScopedData extends Omit<AnalyticsData, "customers"> {
  customers: ViewerScopedCustomer[];
  rankBreakdown?: Array<{ rank: string; customers: number }>;
}

/** 同期の鮮度。UIの「最終同期」はこれを使う（API応答時刻ではない）。 */
export interface SyncFreshness {
  lastSyncedAt: string | null;
  lastEventAt: string | null;
  lastStatus: string | null;
  freshnessLagMinutes: number | null;
}
