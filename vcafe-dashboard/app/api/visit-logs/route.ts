import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { enforceMaidScope } from "@/lib/analytics";
import { loadAnalyticsData } from "@/lib/data-source";
import { buildScopedVisitLogs } from "@/lib/maid-visits";
import { parseAnalyticsRange } from "@/lib/date-range";

// メイド個別／ユーザー個別のご帰宅明細。メイドは自分の分のみ参照できる。
export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const start = params.get("start") || "";
  const end = params.get("end") || "";
  if (!parseAnalyticsRange(start, end)) return NextResponse.json({ error: "有効な期間を366日以内で指定してください" }, { status: 400 });
  const maidId = enforceMaidScope(viewer, params.get("maidId") || undefined);
  // ユーザー個別の明細は管理者のみ（メイド画面では個人が特定できないようにする）。
  const customerId = viewer.role === "admin" ? params.get("customerId") || undefined : undefined;
  try {
    // 匿名化は buildScopedVisitLogs の内部で、プレゼント結合の**後**に行う。
    // ここで先に scopeDataForViewer を通すと customerId が segment-00N になり、
    // BigQuery が返すHMAC IDと結合できずアイテム使用が常に0件になる。
    // maidId は enforceMaidScope で自分のIDに強制済みのため、他メイドのデータは読まれない。
    const data = await loadAnalyticsData({ start, end, maidId });
    const logs = await buildScopedVisitLogs(data, { maidId, customerId, start, end }, viewer);
    return NextResponse.json({ logs }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("ご帰宅明細の取得に失敗しました", error);
    return NextResponse.json({ error: "ご帰宅明細を取得できませんでした" }, { status: 503 });
  }
}
