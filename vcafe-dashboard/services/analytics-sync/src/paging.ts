/**
 * カーソルページングと上限到達の検知。
 *
 * 旧実装は `.limit(config.maxDocuments)` を付けるだけで、上限に達したかを見ていなかった。
 * そのため件数が上限を超えた窓では**超過分が無言で欠落**し、ジョブは成功として終了していた。
 * ここでは
 *   - dateField + ドキュメントパスの複合カーソルで安定してページングする
 *   - ページサイズ（1回の取得件数）と実行全体の上限を別concept として扱う
 *   - 全体上限に到達したら limitReached を立て、呼び出し側で明示的に失敗させる
 * ことで、欠落が静かに起きないようにする。
 */

export interface PageCursor {
  /** 並べ替えに使った日付フィールドの値（次ページの開始位置）。 */
  dateValue: unknown;
  /** 同一時刻の重複を跨ぐためのドキュメントパス。 */
  path: string;
}

export interface Page<T> {
  documents: T[];
  cursor: PageCursor | null;
}

export interface PagedResult<T> {
  documents: T[];
  readCount: number;
  pages: number;
  /** 実行全体の上限に到達したか。true なら取りこぼしがある。 */
  limitReached: boolean;
}

export interface PagingOptions {
  /** 1回のクエリで取得する件数。 */
  pageSize: number;
  /** この取得で許容する総件数。到達したら limitReached を立てて止める。 */
  maxTotal: number;
}

/**
 * fetchPage を繰り返し呼んで全件を集める。
 *
 * fetchPage は cursor が null のとき先頭から、そうでなければ cursor の直後から
 * 最大 pageSize 件を返す実装であること。返却件数が pageSize 未満なら終端とみなす。
 */
export async function fetchAllPages<T>(
  fetchPage: (cursor: PageCursor | null, pageSize: number) => Promise<Page<T>>,
  options: PagingOptions,
): Promise<PagedResult<T>> {
  if (!Number.isInteger(options.pageSize) || options.pageSize < 1) {
    throw new Error("pageSize は1以上の整数で指定してください");
  }
  if (!Number.isInteger(options.maxTotal) || options.maxTotal < 1) {
    throw new Error("maxTotal は1以上の整数で指定してください");
  }

  const documents: T[] = [];
  let cursor: PageCursor | null = null;
  let pages = 0;

  for (;;) {
    const remaining = options.maxTotal - documents.length;
    if (remaining <= 0) {
      // ちょうど上限で終わったのか、まだ続きがあるのかを1件だけ先読みして判定する。
      // 判定しないと「ちょうど上限件」を取りこぼしと誤検知してしまう。
      const probe = await fetchPage(cursor, 1);
      pages += 1;
      return { documents, readCount: documents.length, pages, limitReached: probe.documents.length > 0 };
    }
    const size = Math.min(options.pageSize, remaining);
    const page = await fetchPage(cursor, size);
    pages += 1;
    documents.push(...page.documents);

    if (documents.length > options.maxTotal) {
      // 上限を超えた分は捨てるが、超過した事実を必ず返す。
      return { documents: documents.slice(0, options.maxTotal), readCount: options.maxTotal, pages, limitReached: true };
    }
    // ページが埋まらなかった＝終端。cursor が無い場合も終端として扱う。
    if (page.documents.length < size || !page.cursor) {
      return { documents, readCount: documents.length, pages, limitReached: false };
    }
    cursor = page.cursor;
  }
}
