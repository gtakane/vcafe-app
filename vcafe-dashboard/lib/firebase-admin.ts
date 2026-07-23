import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";

export const ADMIN_PROJECT_ID = "vcafe-admin-analytics";

export function getAdminApp() {
  const configuredProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (configuredProject && configuredProject !== ADMIN_PROJECT_ID) {
    throw new Error(`Firebase Adminの接続先が不正です: ${configuredProject}`);
  }
  return getApps()[0] || initializeApp({
    credential: applicationDefault(),
    projectId: ADMIN_PROJECT_ID,
  });
}
