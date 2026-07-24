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

