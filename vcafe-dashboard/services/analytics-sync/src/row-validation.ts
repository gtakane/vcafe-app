import manifest from "./schema-manifest.json" with { type: "json" };

/**
 * BigQuery へ挿入する直前の実行時検証。
 *
 * 旧実装は BigQuery の結果も挿入行も型アサーション（`as`）だけで信用していた。
 * manifest（schema.sql から生成）と突き合わせ、
 *   - manifest に無い列が混じっていないか（`ignoreUnknownValues: false` で挿入が丸ごと失敗する）
 *   - NOT NULL の列が欠けていないか
 *   - 型が明らかに違わないか
 * を確認し、不正行は理由つきで弾く。生の値はエラーに含めない。
 */

type Columns = Record<string, string>;
const TABLES = (manifest as { tables: Record<string, Columns> }).tables;

export interface RowRejection {
  table: string;
  reasonCode: "UNKNOWN_COLUMN" | "MISSING_REQUIRED" | "TYPE_MISMATCH";
  fieldNames: string;
}

/** BigQuery の型に対して許容する JavaScript の値か。 */
function matchesType(bigQueryType: string, value: unknown): boolean {
  if (value === null || value === undefined) return true; // NULL 許容は別途チェック
  switch (bigQueryType) {
    case "STRING": return typeof value === "string";
    case "INT64": return typeof value === "number" && Number.isFinite(value);
    case "FLOAT64": return typeof value === "number" && Number.isFinite(value);
    case "BOOL": return typeof value === "boolean";
    case "TIMESTAMP": return typeof value === "string" || value instanceof Date;
    default: return true;
  }
}

export function validateRows(
  table: string,
  rows: Array<Record<string, unknown>>,
  onReject?: (rejection: RowRejection) => void,
): { valid: Array<Record<string, unknown>>; rejected: number } {
  const columns = TABLES[table];
  // manifest に無いテーブルは検証をスキップする（schema.sql 追加漏れを握りつぶさないよう警告する）。
  if (!columns) {
    console.warn(JSON.stringify({ validation: { table, reasonCode: "TABLE_NOT_IN_MANIFEST" } }));
    return { valid: rows, rejected: 0 };
  }

  const required = Object.entries(columns)
    .filter(([, type]) => type.endsWith("NOT") || false)
    .map(([name]) => name);

  const valid: Array<Record<string, unknown>> = [];
  let rejected = 0;

  for (const row of rows) {
    const unknownColumns = Object.keys(row).filter((key) => !(key in columns));
    if (unknownColumns.length) {
      rejected += 1;
      onReject?.({ table, reasonCode: "UNKNOWN_COLUMN", fieldNames: unknownColumns.join(",") });
      continue;
    }
    const missing = required.filter((name) => row[name] === undefined || row[name] === null);
    if (missing.length) {
      rejected += 1;
      onReject?.({ table, reasonCode: "MISSING_REQUIRED", fieldNames: missing.join(",") });
      continue;
    }
    const mismatched = Object.entries(row)
      .filter(([key, value]) => !matchesType(columns[key], value))
      .map(([key]) => key);
    if (mismatched.length) {
      rejected += 1;
      onReject?.({ table, reasonCode: "TYPE_MISMATCH", fieldNames: mismatched.join(",") });
      continue;
    }
    valid.push(row);
  }
  return { valid, rejected };
}

/** manifest に定義されている列名（CI のスキーマ照合に使う）。 */
export function manifestColumns(table: string): string[] {
  return Object.keys(TABLES[table] ?? {});
}

export function manifestTables(): string[] {
  return Object.keys(TABLES);
}
