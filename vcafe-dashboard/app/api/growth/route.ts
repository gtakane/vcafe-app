import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { loadGrowthData } from "@/lib/growth";
import { parseAnalyticsRange } from "@/lib/date-range";

export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  // グロース指標は登録・離脱など全体分析のため管理者のみ。
  if (viewer.role !== "admin") return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  const start = request.nextUrl.searchParams.get("start") || "";
  const end = request.nextUrl.searchParams.get("end") || "";
  if (!parseAnalyticsRange(start, end)) return NextResponse.json({ error: "有効な期間を366日以内で指定してください" }, { status: 400 });
  try {
    const result = await loadGrowthData({ start, end });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("グロース指標の取得に失敗しました", error);
    return NextResponse.json({ error: "グロース指標を取得できませんでした" }, { status: 503 });
  }
}
