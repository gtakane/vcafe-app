import { createHmac } from "node:crypto";
import { firestoreTimestampToIso, mapFirestoreUser } from "../../../lib/user-mapping.ts";
import type { Customer, Shift, Visit } from "../../../lib/types.ts";

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
  const isTrial = ticketId === "trial10minutes";
  const prices: Record<string, number> = { gokitaku30minutes: 840, premiumGokitaku1: 960, luckyGokitaku: 650 };
  const type: Visit["type"] = isTrial ? "trial" : roomType === "reservation" ? "reservation" : billedCoin + billedReward <= 0 ? "free" : "paid";
  const revenue = isTrial || type === "free" ? 0 : type === "reservation" ? 3920 : prices[ticketId] ?? Math.round((billedCoin + billedReward) * 1.4);
  return { id: document.id, at, maidId: maidId(document, maidIdsByNickname), customerId: pseudonymizeCustomerId(document.parentId, secret), type, revenue, cheki: 0 };
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
  return {
    id: document.id,
    maidId: String(document.data.maidId || `nickname:${String(document.data.maidNickname || "unknown")}`),
    maidName: String(document.data.maidNickname || "名称未設定"),
    scheduledStart,
    scheduledEnd,
    actualStart: starts.length ? firestoreTimestampToIso(starts[0]) : null,
    actualEnd: ends.length ? firestoreTimestampToIso(ends.at(-1)) : null,
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
