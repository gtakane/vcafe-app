import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { loadMonthlyKpi, saveKpiOverride } from "@/lib/monthly-kpi-loader";
import { EDITABLE_KEYS, KPI_COLUMNS, parseKpiInput, type KpiKey } from "@/lib/monthly-kpi";
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

/**
 * 月次指標の手入力（管理者のみ）。{ month: "2026-11", field: "maidReward", value: "1,983,558" }。value が空なら手入力を消す。
 * 他サイトからの送信を防ぐため、JSON と専用ヘッダーを必須にする（どちらも付けた他サイトからの送信はブラウザが事前確認で止める。
 * セッションの cookie も SameSite=Lax で他サイトからの POST には付かない）。
 */
export async function POST(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  if (viewer.role !== "admin") return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  if (!request.headers.get("content-type")?.includes("application/json") || request.headers.get("x-vcafe-request") !== "monthly-kpi") {
    return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });
  }
  if (process.env.ANALYTICS_BACKEND !== "bigquery") return NextResponse.json({ error: "分析用データに接続した環境でのみ保存できます" }, { status: 503 });
  let body: { month?: unknown; field?: unknown; value?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 }); }
  const month = typeof body.month === "string" ? body.month : "";
  const field = typeof body.field === "string" ? body.field as KpiKey : ("" as KpiKey);
  const column = KPI_COLUMNS.find((c) => c.key === field);
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "年月が不正です" }, { status: 400 });
  if (!column || !EDITABLE_KEYS.has(field)) return NextResponse.json({ error: "この列は手入力できません" }, { status: 400 });
  if (body.value != null && typeof body.value !== "string") return NextResponse.json({ error: "値が不正です" }, { status: 400 });
  const parsed = parseKpiInput(column, (body.value as string | null) ?? "");
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    await saveKpiOverride({ month, field, value: parsed.value, enteredBy: viewer.uid });
    return NextResponse.json({ ok: true, value: parsed.value }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("月次指標の手入力を保存できませんでした", error);
    const denied = /permission|denied|403/i.test(String((error as Error)?.message));
    return NextResponse.json({ error: denied ? "保存の権限がありません（runbook-2026-11/step12-kpi-manual-input.sh を実行してください）" : "保存できませんでした" }, { status: 503 });
  }
}
