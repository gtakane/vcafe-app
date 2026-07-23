import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { enforceMaidScope, scopeDataForViewer } from "@/lib/analytics";
import { loadAnalyticsData } from "@/lib/data-source";
import { parseAnalyticsRange } from "@/lib/date-range";

export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  const start = request.nextUrl.searchParams.get("start") || "";
  const end = request.nextUrl.searchParams.get("end") || "";
  if (!parseAnalyticsRange(start, end)) return NextResponse.json({ error: "有効な期間を366日以内で指定してください" }, { status: 400 });
  const requestedMaidId = request.nextUrl.searchParams.get("maidId") || undefined;
  const maidId = enforceMaidScope(viewer, requestedMaidId);
  const data = scopeDataForViewer(await loadAnalyticsData({ start, end, maidId }), viewer);
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}
