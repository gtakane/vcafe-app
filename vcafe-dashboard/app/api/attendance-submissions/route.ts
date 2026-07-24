import { NextResponse } from "next/server";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getViewer } from "@/lib/auth";
import { getAdminApp } from "@/lib/firebase-admin";
import type { AttendanceSubmission } from "@/lib/types";

const text = (value: unknown) => typeof value === "string" ? value : "";
const date = (value: unknown) => value instanceof Timestamp ? value.toDate().toISOString() : value instanceof Date ? value.toISOString() : typeof value === "string" ? value : null;

export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  // Discord投稿には信頼できるmaidIdがまだないため、理由を含む申請一覧は管理者だけに返す。
  if (viewer.role !== "admin") return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  try {
    const snapshot = await getFirestore(getAdminApp()).collection("discordShiftSubmissions").orderBy("messageCreatedAt", "desc").limit(100).get();
    const submissions: AttendanceSubmission[] = snapshot.docs.map((document) => {
      const value = document.data();
      const range = value.targetRange || value.addRange || value.removeRange || {};
      return {
        id: document.id,
        eventType: value.eventType,
        eventLabel: text(value.eventLabel),
        maidName: text(value.maidName),
        reason: text(value.reason),
        status: text(value.status) || "received",
        targetDate: text(range.localDate) || null,
        targetTime: range.startTime && range.endTime ? `${text(range.startTime)}–${text(range.endTime)}` : null,
        receivedAt: date(value.messageCreatedAt),
      };
    });
    return NextResponse.json({ submissions }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    // 原因（例: Firestoreインデックス未整備）を運用時に切り分けられるようサーバーログへ残す。
    console.error("discordShiftSubmissions の取得に失敗しました", error);
    return NextResponse.json({ error: "Discord勤怠申請を取得できませんでした" }, { status: 503 });
  }
}
