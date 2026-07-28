import { recordKeyOf, type SourceDocument } from "./transform.ts";

/**
 * 1件の壊れた文書で窓全体を落とさないための変換ラッパー。
 *
 * 本番には想定外の形が実在する（終了打刻が1件足りない配列、空文字の日付、
 * toDate() が例外を投げるオブジェクト等）。`.map()` の中で例外が出ると
 * その窓の同期が丸ごと失敗し、正常な行まで取り込めなくなる。
 *
 * ここでは文書ごとに try/catch し、落ちた分は理由コードとともに数える。
 * **reject には生データ・UID・パス・例外メッセージを残さない**
 * （分析側に本番の識別子や値を持ち込まないため）。
 */

export interface RejectEntry {
  source: string;
  reasonCode: "MAPPER_THREW" | "MAPPER_RETURNED_NULL";
  /** recordKey と同じ HMAC。生パスではないため逆引きできない。 */
  hashedPath: string | null;
  /** 例外の種類だけ（メッセージ本文は含めない）。 */
  errorName: string | null;
}

export interface SafeMapOptions {
  source: string;
  secret: string;
  onReject: (entry: RejectEntry) => void;
}

export interface SafeMapResult<T> {
  accepted: T[];
  rejected: number;
  rejectRate: number;
}

export function mapSafely<T>(
  documents: SourceDocument[],
  mapper: (document: SourceDocument) => T | null | undefined,
  options: SafeMapOptions,
): SafeMapResult<T> {
  const accepted: T[] = [];
  let rejected = 0;

  const hashed = (document: SourceDocument) =>
    document.path ? recordKeyOf(document.path, options.secret) : null;

  for (const document of documents) {
    try {
      const row = mapper(document);
      if (row === null || row === undefined) {
        rejected += 1;
        options.onReject({ source: options.source, reasonCode: "MAPPER_RETURNED_NULL", hashedPath: hashed(document), errorName: null });
        continue;
      }
      accepted.push(row);
    } catch (error) {
      rejected += 1;
      // メッセージ本文は生の値を含み得るので保存しない。例外の種類だけ残す。
      options.onReject({
        source: options.source,
        reasonCode: "MAPPER_THREW",
        hashedPath: hashed(document),
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  const total = documents.length;
  return { accepted, rejected, rejectRate: total ? rejected / total : 0 };
}

/**
 * reject 率が閾値を超えていないか判定する。
 * 大量に落ちている＝ソース側の形が変わった可能性が高く、
 * 静かに欠損したまま成功扱いにするとダッシュボードが黙って間違う。
 */
export function assertRejectRate(results: Array<{ source: string; rejectRate: number; rejected: number }>, threshold: number) {
  const over = results.filter((r) => r.rejected > 0 && r.rejectRate > threshold);
  if (over.length) {
    const detail = over.map((r) => `${r.source}=${(r.rejectRate * 100).toFixed(1)}%`).join(", ");
    throw new Error(`変換の棄却率が閾値(${(threshold * 100).toFixed(0)}%)を超えました: ${detail}`);
  }
}
