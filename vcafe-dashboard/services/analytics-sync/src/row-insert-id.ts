// BigQuery ストリーミング挿入の重複排除キー(insertId)を組み立てる。
// 同じ insertId の行が複数あると、BigQuery は1件を残して残りを黙って重複破棄する。

/**
 * recordKey（フルパスのHMAC）や id を持たない行（sync_runs / sync_rejects）は、
 * 2026-07-29 まで一律 "row" にフォールバックしていた。その結果、同一実行
 * （syncedAt が同じ）内の全窓・全ソースの行が同一 insertId になり、
 * BigQuery のストリーミング重複排除でほぼ全行が黙って欠落していた
 * （バックフィルで本来数千行入るはずが24行しか記録されていなかった）。
 * sync_runs は source+windowStart+windowEnd、sync_rejects は
 * source+reasonCode+rejectedAt まで含めれば、この行群の中で一意になる。
 */
export function rowInsertId(row: object, fallbackTimestamp: string): string {
  const r = row as Record<string, unknown>;
  if (r.recordKey != null) return `${String(r.recordKey)}:${String(r.sourceUpdatedAt || fallbackTimestamp)}`;
  if (r.id != null) return `${String(r.id)}:${String(r.sourceUpdatedAt || fallbackTimestamp)}`;
  if (r.maidId != null && r.month != null) return `${r.maidId}:${r.month}:${String(r.sourceUpdatedAt || fallbackTimestamp)}`;
  // sync_runs の行（source, windowStart, windowEnd を持つ）。
  if (r.windowStart != null && r.windowEnd != null && r.source != null) {
    return `${String(r.runId)}:${String(r.source)}:${String(r.windowStart)}:${String(r.windowEnd)}`;
  }
  // sync_rejects の行（source, reasonCode, rejectedAt を持つ）。
  if (r.rejectedAt != null && r.source != null && r.reasonCode != null) {
    return `${String(r.runId)}:${String(r.source)}:${String(r.reasonCode)}:${String(r.rejectedAt)}`;
  }
  return `row:${String(r.sourceUpdatedAt || fallbackTimestamp)}`;
}
