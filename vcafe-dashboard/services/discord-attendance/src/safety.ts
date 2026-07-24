// Discord勤怠Botの安全境界。管理用Firestoreにのみ書き込み、本番プロジェクトへは絶対に接続しない。
// 純関数として切り出し、単体テストで多層防御を検証できるようにする。

// 既知の本番プロジェクトID。ここに列挙したプロジェクトは管理用として指定できない（書き込み防止）。
export const KNOWN_PRODUCTION_PROJECT_IDS = new Set<string>(["v-athome-cafe-app"]);

/**
 * 管理用プロジェクトが安全（本番でない）ことを検証する。多層防御:
 *   1. MANAGEMENT_PROJECT_ID は必須。
 *   2. PRODUCTION_PROJECT_ID も必須（安全確認のため。従来は任意でガードを素通りできた）。
 *   3. 管理用と本番が同一ならエラー。
 *   4. 管理用が既知の本番プロジェクトIDならエラー（PRODUCTION_PROJECT_ID の設定漏れに依存しない）。
 * 検証に通れば書き込み先となる管理用プロジェクトIDを返す。
 */
export function resolveManagementProjectId(env: {
  MANAGEMENT_PROJECT_ID?: string;
  PRODUCTION_PROJECT_ID?: string;
}): string {
  const managementProjectId = (env.MANAGEMENT_PROJECT_ID || "").trim();
  const productionProjectId = (env.PRODUCTION_PROJECT_ID || "").trim();
  if (!managementProjectId) throw new Error("MANAGEMENT_PROJECT_ID is required");
  if (!productionProjectId) throw new Error("PRODUCTION_PROJECT_ID is required（安全確認のため必須）");
  if (managementProjectId === productionProjectId) {
    throw new Error("安全のため、管理用プロジェクトと本番プロジェクトを同一にはできません");
  }
  if (KNOWN_PRODUCTION_PROJECT_IDS.has(managementProjectId)) {
    throw new Error(`安全のため、既知の本番プロジェクト(${managementProjectId})を管理用プロジェクトに指定できません`);
  }
  return managementProjectId;
}
