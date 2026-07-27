import { type Firestore, Timestamp } from "firebase-admin/firestore";
import type { ReservationEntry } from "./core.ts";
import type { ReservationSourceConfig } from "./config.ts";

// Firestore Timestamp / Date / 文字列 / 数値 を ISO 文字列へ。
function toIso(value: unknown): string | null {
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

/**
 * 本番Firestoreから対象ウィンドウ内の予約を読み取る（読み取り専用）。
 * roomType 等のフィルタは複合インデックスを避けるためクライアント側で適用する。
 * コレクション名・フィールド名は設定で差し替え可能（本番スキーマ確定後に環境変数で調整）。
 */
export async function readReservations(
  sourceDb: Firestore,
  source: ReservationSourceConfig,
  window: { start: Date; end: Date },
): Promise<ReservationEntry[]> {
  const snapshot = await sourceDb
    .collectionGroup(source.collectionGroup)
    .where(source.dateField, ">=", Timestamp.fromDate(window.start))
    .where(source.dateField, "<", Timestamp.fromDate(window.end))
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
