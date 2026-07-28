/**
 * BigQuery のストリーミング挿入エラーを、ログ1行で原因が分かる形に要約する。
 *
 * `PartialFailureError` は「何行目のどの列が、なぜ弾かれたか」を持っているが、
 * `error.message` は空で、`error.errors` をそのまま出すと行数ぶんの巨大な JSON になり
 * Cloud Run のログで切り詰められて読めない（2026-07-27 の事故で実際にそうなった）。
 *
 * 行の値は本番データそのものなので、要約には**含めない**。
 * 出すのは件数・理由コード・列名・代表メッセージだけ。
 */

interface RowError {
  reason?: string;
  location?: string;
  message?: string;
}

interface InsertErrorEntry {
  errors?: RowError[];
}

export interface InsertErrorSummary {
  /** 失敗した行数。 */
  rowsFailed: number;
  /** 問題のあった列名（重複排除）。列不足ならここに欠けている列が出る。 */
  fields: string[];
  /** BigQuery の理由コード（invalid / stopped など、重複排除）。 */
  reasons: string[];
  /** 代表的なメッセージ。長さは抑える。 */
  sample: string;
}

export function summarizeInsertErrors(error: unknown): InsertErrorSummary {
  const err = error as {
    message?: string;
    errors?: InsertErrorEntry[];
    response?: { insertErrors?: InsertErrorEntry[] };
  };
  const entries = err?.errors ?? err?.response?.insertErrors ?? [];

  const fields = new Set<string>();
  const reasons = new Set<string>();
  const messages = new Set<string>();
  for (const entry of entries) {
    for (const rowError of entry?.errors ?? []) {
      if (rowError.location) fields.add(rowError.location);
      if (rowError.reason) reasons.add(rowError.reason);
      if (rowError.message) messages.add(rowError.message);
    }
  }

  // 行数が多くても要約は一定の長さに収める（ログの切り詰め対策）。
  const sample = messages.size
    ? [...messages].slice(0, 3).join(" / ").slice(0, 240)
    : String(err?.message ?? "");

  return {
    rowsFailed: entries.length,
    fields: [...fields].slice(0, 20),
    reasons: [...reasons].slice(0, 5),
    sample,
  };
}

/**
 * 列不足が原因か（＝ apply-schema.sh 未実行の可能性が高いか）。
 * 事前検査をすり抜けた場合でも、ログに次の一手を書けるようにする。
 */
export function looksLikeMissingColumn(summary: InsertErrorSummary): boolean {
  return /no such field/i.test(summary.sample);
}
