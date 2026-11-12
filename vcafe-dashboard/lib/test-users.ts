// ダッシュボード全体の「テストユーザーを含める／含めない」の切り替え（2026-11-12〜）。
//
// テストユーザー（users.testUser / testUesrFlag）の記録は、分析用BigQueryに isTestUser=true で入っている。
// 2026-11-12 より前に取り込んだ行は isTestUser が NULL で、これは「テストユーザーではない」として扱う
// （当時はテストユーザーを取り込んでいなかったため）。既定は含めない。

/** URL のクエリ名。?testUsers=include で含める。 */
export const TEST_USERS_PARAM = "testUsers";

/** クエリの値から「含めるか」を決める。管理者以外は常に含めない（メイド画面の数値は変えない）。 */
export function includeTestUsersFrom(value: string | null | undefined, role?: string): boolean {
  if (role !== undefined && role !== "admin") return false;
  return value === "include";
}

/**
 * SQL の条件。@includeTestUsers（BOOL）を渡したクエリで使う。
 * 例: WHERE ${testUserCondition("v")} → (@includeTestUsers OR NOT COALESCE(v.isTestUser, FALSE))
 */
export function testUserCondition(alias?: string): string {
  const column = alias ? `${alias}.isTestUser` : "isTestUser";
  return `(@includeTestUsers OR NOT COALESCE(${column}, FALSE))`;
}

/** 画面の表示用の短い説明。 */
export function testUserScopeLabel(include: boolean): string {
  return include ? "テストユーザーを含む" : "テストユーザーを除く";
}
