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
