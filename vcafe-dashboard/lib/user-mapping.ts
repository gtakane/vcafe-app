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

export function mapFirestoreUser(documentId: string, source: Record<string, unknown>): Customer | null {
  if (USER_FIELD_MAP.testFlags.some((field) => flagIsTrue(source[field]))) return null;
  const registeredAt = firestoreTimestampToIso(source[USER_FIELD_MAP.registrationDate]);
  const name = String(source[USER_FIELD_MAP.nickname] ?? "").trim() || "名称未設定";
  const rank = String(source[USER_FIELD_MAP.rank] ?? "").trim() || "未設定";
  return { id: documentId, name, rank, registeredAt };
}
