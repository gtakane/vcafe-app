import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { loadCustomers } from "@/lib/customers";

// ユーザーDBは全会員が対象で、ダッシュボード上部の期間フィルタには依存しない。
export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  if (viewer.role !== "admin") return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  const params = request.nextUrl.searchParams;
  const date = (value: string | null) => (value && /^20\d{2}-\d{2}-\d{2}$/.test(value) ? value : undefined);
  try {
    const result = await loadCustomers({
      q: params.get("q") || undefined,
      rank: params.get("rank") || undefined,
      gender: params.get("gender") || undefined,
      paying: (params.get("paying") as "yes" | "no" | null) || "",
      regFrom: date(params.get("regFrom")),
      regTo: date(params.get("regTo")),
      sort: params.get("sort") || undefined,
      dir: params.get("dir") === "desc" ? "desc" : "asc",
      limit: Number(params.get("limit")) || undefined,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("ユーザー一覧の取得に失敗しました", error);
    return NextResponse.json({ error: "ユーザー一覧を取得できませんでした" }, { status: 503 });
  }
}
