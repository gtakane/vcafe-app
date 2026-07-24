import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { enforceMaidScope } from "@/lib/analytics";
import { loadMaidReports } from "@/lib/maid-reports";

export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  const month = request.nextUrl.searchParams.get("month") || undefined;
  // メイドは自分のIDに強制、管理者は任意（未指定なら全員）。
  const maidId = enforceMaidScope(viewer, request.nextUrl.searchParams.get("maidId") || undefined);
  try {
    const result = await loadMaidReports(month, maidId);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("メイド実績の取得に失敗しました", error);
    return NextResponse.json({ error: "メイド実績を取得できませんでした" }, { status: 503 });
  }
}
