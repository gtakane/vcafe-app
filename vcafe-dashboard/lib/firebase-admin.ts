import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";

export const ADMIN_PROJECT_ID = "vcafe-admin-analytics";

// 既知の本番プロジェクトID。Admin SDKはこれらへ絶対に接続しない（多層防御）。
export const KNOWN_PRODUCTION_PROJECT_IDS = new Set<string>(["v-athome-cafe-app"]);

export function getAdminApp() {
  const configuredProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  // 明示設定がある場合は管理用プロジェクトと一致していなければ拒否。
  if (configuredProject && configuredProject !== ADMIN_PROJECT_ID) {
    throw new Error(`Firebase Adminの接続先が不正です: ${configuredProject}`);
  }
  // 接続先(ADMIN_PROJECT_ID)自体が既知の本番IDでないことを常に確認（設定漏れに依存しない）。
  if (KNOWN_PRODUCTION_PROJECT_IDS.has(ADMIN_PROJECT_ID)) {
    throw new Error(`Firebase Adminの接続先が本番プロジェクトです: ${ADMIN_PROJECT_ID}`);
  }
  return getApps()[0] || initializeApp({
    credential: applicationDefault(),
    projectId: ADMIN_PROJECT_ID,
  });
}
