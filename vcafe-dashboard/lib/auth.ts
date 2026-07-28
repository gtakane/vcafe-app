import { cookies } from "next/headers";
import { getAuth } from "firebase-admin/auth";
import { getAdminApp } from "./firebase-admin";
import { resolveAuthMode } from "./auth-mode.ts";
import type { Viewer } from "./types";

/** maidId は空文字・空白のみを認めない（lib/auth-claims.ts の検証と揃える）。 */
function normalizeMaidId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export async function getViewer(): Promise<Viewer | null> {
  // 不正な AUTH_MODE はここで例外になる。握りつぶすとデモ管理者へ落ちるため catch しない。
  if (resolveAuthMode(process.env) === "demo") {
    const role = process.env.DEMO_ROLE === "maid" ? "maid" : "admin";
    return { uid: "demo-user", name: role === "maid" ? "こはる" : "運営管理者", role, maidId: role === "maid" ? process.env.DEMO_MAID_ID || "maid-01" : undefined };
  }
  const cookieStore = await cookies();
  const session = cookieStore.get(process.env.SESSION_COOKIE_NAME || "vcafe_session")?.value;
  if (!session) return null;
  try {
    const decoded = await getAuth(getAdminApp()).verifySessionCookie(session, true);
    const role = decoded.role === "admin" ? "admin" : decoded.role === "maid" ? "maid" : null;
    if (!role) return null;
    const maidId = normalizeMaidId(decoded.maidId);
    // maid なのに maidId が無いセッションはスコープを決められないため未認証として扱う。
    if (role === "maid" && !maidId) return null;
    return { uid: decoded.uid, name: String(decoded.name || decoded.email || "ユーザー"), role, maidId };
  } catch {
    return null;
  }
}
