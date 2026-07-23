import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { getAdminApp } from "@/lib/firebase-admin";

const cookieName = process.env.SESSION_COOKIE_NAME || "vcafe_session";
const secureCookie = process.env.NODE_ENV === "production";

export async function POST(request: NextRequest) {
  try {
    const { idToken } = await request.json();
    if (typeof idToken !== "string" || idToken.length > 8192) return NextResponse.json({ error: "invalid token" }, { status: 400 });
    const auth = getAuth(getAdminApp());
    const decoded = await auth.verifyIdToken(idToken, true);
    if (decoded.role !== "admin" && decoded.role !== "maid") return NextResponse.json({ error: "権限がありません" }, { status: 403 });
    if (decoded.role === "maid" && typeof decoded.maidId !== "string") return NextResponse.json({ error: "maidIdがありません" }, { status: 403 });
    const session = await auth.createSessionCookie(idToken, { expiresIn: 8 * 60 * 60 * 1000 });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(cookieName, session, { httpOnly: true, secure: secureCookie, sameSite: "lax", maxAge: 8 * 60 * 60, path: "/" });
    return response;
  } catch {
    return NextResponse.json({ error: "認証に失敗しました" }, { status: 401 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(cookieName, "", { httpOnly: true, secure: secureCookie, sameSite: "lax", maxAge: 0, path: "/" });
  return response;
}
