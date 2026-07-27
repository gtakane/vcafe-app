import { type Firestore, Timestamp } from "firebase-admin/firestore";
import type { ReservationEntry } from "./core.ts";
import type { ReservationSourceConfig } from "./config.ts";

// Firestore Timestamp / Date / 文字列 / 数値 を ISO 文字列へ。
export function toIso(value: unknown): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (value && typeof value === "object") {
    const ts = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
    if (typeof ts.toDate === "function") return ts.toDate().toISOString();
    const seconds = ts.seconds ?? ts._seconds;
    if (typeof seconds === "number") return new Date(seconds * 1000).toISOString();
  }
  return null;
}

// 'YYYY-MM-DD' → 'YYYYMMDD'（workshiftGroups のドキュメントID）。
export function dayId(day: string): string {
  return day.replace(/-/g, "");
}

/**
 * 対象営業日のグループ配下 reservations を直接読み取る（読み取り専用）。
 * 予約は workshiftGroups/{YYYYMMDD}/reservations に日付ごとに格納されるため、
 * コレクショングループ横断＋範囲検索（＝要インデックス）を避けて該当グループだけ読む。
 * rsvStatus 等のフィルタはインデックス不要にするためクライアント側で適用する。
 */
export async function readReservations(
  sourceDb: Firestore,
  source: ReservationSourceConfig,
  day: string,
): Promise<ReservationEntry[]> {
  const snapshot = await sourceDb
    .collection(source.parentCollection)
    .doc(dayId(day))
    .collection(source.subCollection)
    .limit(source.maxDocuments)
    .get();

  const entries: ReservationEntry[] = [];
  for (const document of snapshot.docs) {
    const data = document.data();
    if (source.filterField && String(data[source.filterField] ?? "") !== source.filterValue) continue;
    const at = toIso(data[source.dateField]);
    if (!at) continue;
    entries.push({
      id: document.id,
      maidId: String(data[source.maidIdField] ?? "").trim(),
      maidNickname: String(data[source.maidNicknameField] ?? "").trim(),
      at,
      customerLabel: source.customerLabelField ? String(data[source.customerLabelField] ?? "").trim() || undefined : undefined,
    });
  }
  return entries;
}
