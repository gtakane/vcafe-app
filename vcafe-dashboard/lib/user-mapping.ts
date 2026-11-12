import type { Customer } from "./types";

export const USER_FIELD_MAP = {
  nickname: "nickname",
  rank: "rank",
  registrationDate: "registrationDate",
  testFlags: ["testUser", "testUesrFlag"],
} as const;

type TimestampLike = { toDate?: () => Date; seconds?: number; _seconds?: number };

function flagIsTrue(value: unknown) {
  return value === true || value === 1 || (typeof value === "string" && value.toLowerCase() === "true");
}

export function firestoreTimestampToIso(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (value && typeof value === "object") {
    const timestamp = value as TimestampLike;
    if (typeof timestamp.toDate === "function") {
      const date = timestamp.toDate();
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    const seconds = timestamp.seconds ?? timestamp._seconds;
    if (typeof seconds === "number") return new Date(seconds * 1000).toISOString();
  }
  return null;
}

/** 数値フィールド。未設定は null（0と区別する）。 */
function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** birthdate は [年, 月, 日] の配列。年のみ利用する（年代分析用）。 */
function birthYearOf(value: unknown): number | null {
  if (!Array.isArray(value) || !value.length) return null;
  const year = Number(value[0]);
  return Number.isInteger(year) && year > 1900 && year < 2100 ? year : null;
}

/** テストユーザー（users.testUser / testUesrFlag が真）か。 */
export function isTestUserSource(source: Record<string, unknown>): boolean {
  return USER_FIELD_MAP.testFlags.some((field) => flagIsTrue(source[field]));
}

/** テストユーザーは null（旧来の挙動。テストユーザーを扱わない呼び出し元向け）。 */
export function mapFirestoreUser(documentId: string, source: Record<string, unknown>): Customer | null {
  if (isTestUserSource(source)) return null;
  return mapFirestoreUserWithFlag(documentId, source);
}

/**
 * テストユーザーも含めて変換し、isTestUser で区別する（2026-11-12〜）。
 * ダッシュボードで「テストユーザーを含める／含めない」を切り替えるため、分析側には両方を保存する。
 */
export function mapFirestoreUserWithFlag(documentId: string, source: Record<string, unknown>): Customer {
  const registeredAt = firestoreTimestampToIso(source[USER_FIELD_MAP.registrationDate]);
  const name = String(source[USER_FIELD_MAP.nickname] ?? "").trim() || "名称未設定";
  const rank = String(source[USER_FIELD_MAP.rank] ?? "").trim() || "未設定";
  const gender = String(source.gender ?? "").trim() || null;
  return {
    id: documentId,
    name,
    rank,
    registeredAt,
    gender,
    birthYear: birthYearOf(source.birthdate),
    active: typeof source.active === "boolean" ? source.active : null,
    lastVisitAt: firestoreTimestampToIso(source.lastVisitDate),
    lastPaymentAt: firestoreTimestampToIso(source.lastPaymentDate),
    lastPurchasedItemAt: firestoreTimestampToIso(source.lastPurchasedItemDate),
    lastPresentAt: firestoreTimestampToIso(source.lastPresentDate),
    purchasedItemCoin: numberOrNull(source.purchasedItemAmountCoin),
    purchasedItemRewardPoint: numberOrNull(source.purchasedItemAmountRewardPoint),
    purchasedItemQuantity: numberOrNull(source.purchasedItemTotalQuantity),
    presentAmount: numberOrNull(source.presentAmount),
    // coin は旧SBペイメント経由の残高（現在はほぼ0）。アプリ内で購入したコインは coinApple / coinGoogle。
    coin: numberOrNull(source.coin),
    coinApple: numberOrNull(source.coinApple),
    coinGoogle: numberOrNull(source.coinGoogle),
    rewardPoint: numberOrNull(source.rewardPoint),
    totalVisitAmount: numberOrNull(source.visitAmount),
    consecutiveVisitDays: numberOrNull(source.consecutiveVisitDays),
    maxConsecutiveVisitDays: numberOrNull(source.maxConsecutiveVisitDays),
    isTestUser: isTestUserSource(source),
  };
}
