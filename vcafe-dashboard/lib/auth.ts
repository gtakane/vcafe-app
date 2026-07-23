import { cookies } from "next/headers";
import { getAuth } from "firebase-admin/auth";
import { getAdminApp } from "./firebase-admin";
import type { Viewer } from "./types";

export async function getViewer(): Promise<Viewer | null> {
  if (process.env.AUTH_MODE !== "firebase") {
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
    return { uid: decoded.uid, name: String(decoded.name || decoded.email || "ユーザー"), role, maidId: typeof decoded.maidId === "string" ? decoded.maidId : undefined };
  } catch {
    return null;
  }
}
