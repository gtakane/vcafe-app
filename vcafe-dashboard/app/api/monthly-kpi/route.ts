import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { loadMonthlyKpi } from "@/lib/monthly-kpi-loader";
import { includeTestUsersFrom, TEST_USERS_PARAM } from "@/lib/test-users";

// 月次指標（運営の月次CSVと同じ項目）。管理者のみ。
export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  if (viewer.role !== "admin") return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  if (process.env.ANALYTICS_BACKEND !== "bigquery") return NextResponse.json({ error: "月次指標は分析用データに接続した環境でのみ表示できます" }, { status: 503 });
  try {
    const includeTestUsers = includeTestUsersFrom(request.nextUrl.searchParams.get(TEST_USERS_PARAM), viewer.role);
    const result = await loadMonthlyKpi({ includeTestUsers, refresh: request.nextUrl.searchParams.get("refresh") === "1" });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("月次指標の取得に失敗しました", error);
    return NextResponse.json({ error: "月次指標を取得できませんでした" }, { status: 503 });
  }
}
