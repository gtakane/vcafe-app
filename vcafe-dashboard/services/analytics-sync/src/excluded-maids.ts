/**
 * 集計から除外するメイド（本番環境に作られたテスト用メイドなど）。
 *
 * テストユーザーは users の testUser フラグで除外しているが、メイド側には相当するフラグが無い。
 * そのため maidId を環境変数 EXCLUDED_MAID_IDS（カンマ区切り）で指定し、
 * そのメイドのご帰宅・チェキ・プレゼント・シフト・名簿・月次実績を取り込まない。
 *
 * 既に取り込まれた分は runbook-2026-11/purge-test-maid.sh で分析用BigQueryから削除する。
 */
export function excludedMaidIdsFrom(env: NodeJS.ProcessEnv): Set<string> {
  return new Set(
    String(env.EXCLUDED_MAID_IDS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

/** 除外対象のメイドの行を取り除く。 */
export function withoutExcludedMaids<T>(rows: T[], excluded: Set<string>, idOf: (row: T) => string): T[] {
  if (!excluded.size) return rows;
  return rows.filter((row) => !excluded.has(idOf(row)));
}
