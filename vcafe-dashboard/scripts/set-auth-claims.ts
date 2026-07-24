import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { buildCustomClaims, validateClaimRequest, type ClaimRequest } from "../lib/auth-claims";

const EXPECTED_PROJECT_ID = "vcafe-admin-analytics";
const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...value] = argument.replace(/^--/, "").split("=");
  return [key, value.join("=")];
}));
const request: ClaimRequest = {
  uid: args.get("uid") || "",
  role: args.get("role") === "maid" ? "maid" : args.get("role") === "admin" ? "admin" : ("" as ClaimRequest["role"]),
  maidId: args.get("maid-id") || undefined,
};
validateClaimRequest(request);

const projectId = process.env.AUTH_PROJECT_ID;
if (projectId !== EXPECTED_PROJECT_ID) throw new Error(`AUTH_PROJECT_ID must be ${EXPECTED_PROJECT_ID}`);
if (process.env.CONFIRM_AUTH_CLAIM_WRITE !== `SET_CLAIMS_IN_${EXPECTED_PROJECT_ID}`) throw new Error("管理用プロジェクトへの権限変更確認がありません");

const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId });
const auth = getAuth(app);
const user = await auth.getUser(request.uid);
const claims = buildCustomClaims(user.customClaims || {}, request);
const output = { projectId, uid: `${request.uid.slice(0, 6)}…`, claims, apply: process.env.APPLY === "true" };

if (process.env.APPLY !== "true") {
  console.info(JSON.stringify(output));
  console.info("DRY RUN: APPLY=trueを指定するまで変更しません");
} else {
  await auth.setCustomUserClaims(request.uid, claims);
  await auth.revokeRefreshTokens(request.uid);
  console.info(JSON.stringify(output));
  console.info("Custom Claimsを更新しました。対象ユーザーは再ログインが必要です。");
}
