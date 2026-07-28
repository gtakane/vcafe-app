import { manifestColumns } from "./row-validation.ts";

/**
 * 起動時のスキーマ事前検査。
 *
 * `row-validation.ts` は「挿入する行」を manifest と突き合わせる。
 * ここで見るのはその一段外側、**manifest と実際の BigQuery テーブル**のずれである。
 *
 * 2026-07-27、apply-schema.sh（配備手順1）を実行しないまま新しい同期ジョブを走らせ、
 * recordKey / runId 列が無いテーブルへ挿入して全6テーブルが PartialFailureError で
 * 失敗した。行も manifest も recordKey を持っていたため validateRows は通り、
 * 実体とのずれは挿入時まで表面化しなかった。しかも BigQuery が返すのは
 * `name=PartialFailureError message=` だけで、原因も対処も分からなかった。
 *
 * そこで、窓を1つも処理しないうちに INFORMATION_SCHEMA と突き合わせ、
 * 不足があれば「どのテーブルのどの列が足りないか」「何を実行すればよいか」を
 * 添えて停止する。
 */

/**
 * 同期ジョブが挿入するテーブル。事前検査の対象。
 * `tests/schema-precheck.test.ts` が index.ts の insertRows 呼び出しと突き合わせ、
 * 対象漏れが起きないよう固定している。
 */
export const INSERT_TABLES = [
  "customers_raw",
  "visits_raw",
  "cheki_raw",
  "shifts_raw",
  "payments_raw",
  "presents_raw",
  "maid_profiles_raw",
  "maid_monthly_raw",
  "sync_runs",
  "sync_rejects",
] as const;

/** INFORMATION_SCHEMA.COLUMNS から得た実テーブルの列。 */
export interface LiveColumn {
  table: string;
  column: string;
}

export interface SchemaGap {
  table: string;
  /** テーブルそのものが存在しない場合に true。 */
  tableMissing: boolean;
  /** manifest にあって実テーブルに無い列。 */
  missing: string[];
}

/**
 * manifest の列が実テーブルに揃っているかを調べる。
 *
 * **余分な列は問題としない。** 挿入が失敗するのは「manifest にあって実体に無い」
 * 場合だけであり、手作業で足された列や先行追加された列で同期を止めるのは過剰。
 * 逆向きのずれ（実体にあって manifest に無い）は check-bigquery-schema.sh が扱う。
 */
export function findSchemaGaps(
  live: LiveColumn[],
  tables: readonly string[] = INSERT_TABLES,
): SchemaGap[] {
  // BigQuery の列名照合に合わせ、比較は大文字小文字を無視する。
  const byTable = new Map<string, Set<string>>();
  for (const { table, column } of live) {
    const key = table.toLowerCase();
    if (!byTable.has(key)) byTable.set(key, new Set());
    byTable.get(key)!.add(column.toLowerCase());
  }

  const gaps: SchemaGap[] = [];
  for (const table of tables) {
    const expected = manifestColumns(table);
    // manifest に無いテーブルは検査しようがない（schema.sql への追加漏れは
    // schema-manifest.test.ts が検出する）。
    if (!expected.length) continue;

    const actual = byTable.get(table.toLowerCase());
    if (!actual) {
      gaps.push({ table, tableMissing: true, missing: [...expected].sort() });
      continue;
    }
    const missing = expected.filter((column) => !actual.has(column.toLowerCase())).sort();
    if (missing.length) gaps.push({ table, tableMissing: false, missing });
  }
  return gaps;
}

/** 不足があれば、原因と対処を添えて例外を投げる。 */
export function assertLiveSchema(live: LiveColumn[], tables: readonly string[] = INSERT_TABLES): void {
  const gaps = findSchemaGaps(live, tables);
  if (!gaps.length) return;

  const details = gaps.map((gap) =>
    gap.tableMissing
      ? `  ${gap.table}: テーブルがありません`
      : `  ${gap.table}: 不足列: ${gap.missing.join(", ")}`,
  );
  throw new Error(
    [
      "SCHEMA_PRECHECK_FAILED BigQuery のスキーマが古いため同期を開始できません（1行も挿入していません）。",
      ...details,
      "対処: bash services/analytics-sync/apply-schema.sh を実行してから再実行してください（配備手順1）。",
    ].join("\n"),
  );
}

/** INFORMATION_SCHEMA.COLUMNS を引く SQL。データは読まないため課金はほぼ発生しない。 */
export function liveColumnsSql(projectId: string, dataset: string): string {
  return `SELECT table_name AS \`table\`, column_name AS \`column\`
    FROM \`${projectId}.${dataset}.INFORMATION_SCHEMA.COLUMNS\``;
}
