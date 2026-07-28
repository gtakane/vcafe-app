import type { AnalyticsData, Customer, Maid, MaidReportsResult, Shift, Visit } from "./types";
import { visitWeight } from "./metrics.ts";

export const maids: Maid[] = [
  { id: "maid-01", name: "こはる", avatar: "こ", status: "active" },
  { id: "maid-02", name: "みるく", avatar: "み", status: "active" },
  { id: "maid-03", name: "しずく", avatar: "し", status: "active" },
  { id: "maid-04", name: "るな", avatar: "る", status: "active" },
  { id: "maid-05", name: "もも", avatar: "も", status: "active" },
];

// デモ用。本番同期時は users ドキュメント由来の値が入る。
function mockCustomer(id: string, name: string, rank: string, registeredAt: string, gender: string, index: number): Customer {
  return {
    id, name, rank, registeredAt, gender,
    birthYear: 1988 + index,
    active: true,
    lastVisitAt: `2026-07-${String(14 + (index % 8)).padStart(2, "0")}T12:00:00Z`,
    lastPaymentAt: index % 3 === 2 ? null : `2026-07-${String(2 + index).padStart(2, "0")}T09:00:00Z`,
    lastPurchasedItemAt: index % 2 === 0 ? `2026-06-${String(10 + index).padStart(2, "0")}T09:00:00Z` : null,
    lastPresentAt: index % 4 === 0 ? `2026-07-${String(5 + index).padStart(2, "0")}T09:00:00Z` : null,
    purchasedItemCoin: index * 300,
    purchasedItemRewardPoint: index * 30,
    purchasedItemQuantity: index,
    presentAmount: index % 4 === 0 ? index : 0,
    coin: 500 * ((index % 5) + 1),
    rewardPoint: 100 * index,
    totalVisitAmount: 20 + index * 3,
    consecutiveVisitDays: (index % 3) + 1,
    maxConsecutiveVisitDays: (index % 5) + 2,
    paymentCount: index % 3 === 2 ? 0 : (index % 4) + 1,
    paymentAmount: index % 3 === 2 ? 0 : 840 * ((index % 4) + 1),
  };
}

export const customers: Customer[] = [
  mockCustomer("usr-001", "あおい", "プラチナ", "2024-02-12", "female", 0),
  mockCustomer("usr-002", "はる", "ゴールド", "2024-08-03", "male", 1),
  mockCustomer("usr-003", "ゆう", "シルバー", "2025-01-18", "male", 2),
  mockCustomer("usr-004", "そら", "ゴールド", "2025-03-27", "female", 3),
  mockCustomer("usr-005", "なつ", "ブロンズ", "2025-10-05", "male", 4),
  mockCustomer("usr-006", "れん", "プラチナ", "2023-11-22", "female", 5),
  mockCustomer("usr-007", "ひなた", "シルバー", "2026-02-15", "male", 6),
  mockCustomer("usr-008", "かい", "ブロンズ", "2026-05-10", "female", 7),
];

function iso(day: number, hour: number, minute = 0) {
  return new Date(Date.UTC(2026, 6, day, hour - 9, minute)).toISOString();
}

const visits: Visit[] = [];
let visitId = 1;
for (let day = 1; day <= 21; day += 1) {
  const count = 3 + ((day * 7) % 8);
  for (let i = 0; i < count; i += 1) {
    const maidIndex = (day + i * 2) % maids.length;
    const customerIndex = (day * 3 + i) % customers.length;
    const kind = (day + i) % 9;
    // classifyVisit と同じ種別体系（無料=trial のみ、他は予約/有料）。
    const type: Visit["type"] = kind === 0 ? "trial" : kind === 1 ? "reservation" : "paid";
    // initialTime を擬似的に変化させ、滞在40分相当(=重み2)を混在させる。
    const initialTime = i % 4 === 0 ? 40 : 20;
    // 支払い手段を混在させる（コイン払い / チケット / お試し / 予約）。
    const ticketId = type === "trial" ? "trial10minutes" : type === "reservation" ? "ATCOIN" : i % 3 === 0 ? "gokitaku30minutes" : "ATCOIN";
    const usesCoin = ticketId === "ATCOIN" && type === "paid";
    visits.push({
      id: `visit-${visitId++}`,
      at: iso(day, 19 + (i % 6), (i * 11) % 60),
      maidId: maids[maidIndex].id,
      customerId: customers[customerIndex].id,
      type,
      revenue: type === "reservation" ? 3920 : type === "paid" ? 840 + (i % 3) * 120 : 0,
      cheki: (day + i) % 4 === 0 ? 1 : 0,
      weight: visitWeight(initialTime),
      ticketId,
      minutes: initialTime,
      billedCoin: usesCoin ? 600 + (i % 3) * 100 : 0,
      billedRewardPoint: usesCoin && i % 5 === 0 ? 200 : 0,
    });
  }
}

const shifts: Shift[] = [];
let shiftId = 1;
for (let day = 1; day <= 21; day += 1) {
  maids.forEach((maid, index) => {
    if ((day + index) % 3 === 0) return;
    const late = (day * (index + 2)) % 8 === 0 ? 12 : 0;
    shifts.push({
      id: `shift-${shiftId++}`,
      maidId: maid.id,
      scheduledStart: iso(day, 19),
      scheduledEnd: iso(day, 23, 30),
      actualStart: iso(day, 19, late),
      actualEnd: iso(day, 23, 30),
    });
  });
}

export const mockAnalyticsData: AnalyticsData = {
  generatedAt: new Date(Date.UTC(2026, 6, 21, 7, 30)).toISOString(),
  maids,
  customers,
  visits,
  shifts,
};

// デモ用の月次メイド実績（架空値）。
export function mockMaidReports(requestedMonth?: string, maidId?: string): MaidReportsResult {
  const months = ["202607", "202606"];
  const month = requestedMonth && months.includes(requestedMonth) ? requestedMonth : months[0];
  const seasonal = month === "202606" ? 6 : 0;
  const reports = maids.map((maid, index) => {
    const hasReserve = index % 2 === 0;
    return {
      maidId: maid.id,
      month,
      nickname: maid.name,
      attendance: 8 + index,
      totalWorkTimes: 20 + index * 3,
      late: index % 3 === 0 ? 1 : 0,
      latetime: index % 3 === 0 ? 0.05 : 0,
      totalReservation: hasReserve ? 1.5 * (index + 1) : 0,
      totalWorkTimesReserve: hasReserve ? 0.517 * (index + 1) : 0,
      presumeTotalWorkTimeReserve: hasReserve ? 0.667 * (index + 1) : 0,
      lateReservation: 0,
      latetimeReservation: 0,
      totalVisits: 100 - index * 12 + seasonal,
      totalOtameshi: index % 4 === 0 ? 1 : 0,
      totalPresents: index * 3,
      totalPresentsPrice: index * 3 * 200,
      totalPhoto: 30 - index * 3,
    };
  });
  const filtered = maidId ? reports.filter((report) => report.maidId === maidId) : reports;
  return { months, month, reports: filtered };
}
