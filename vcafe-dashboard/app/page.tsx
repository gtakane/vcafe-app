import { redirect } from "next/navigation";
import Dashboard from "@/components/dashboard";
import { getViewer } from "@/lib/auth";
import { loadAnalyticsData, loadSyncFreshness } from "@/lib/data-source";
import { scopeDataForViewer } from "@/lib/analytics";

export const dynamic = "force-dynamic";

export default async function Home() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const start = `${today.slice(0, 7)}-01`;
  const [raw, freshness] = await Promise.all([
    loadAnalyticsData({ start, end: today, maidId: viewer.role === "maid" ? viewer.maidId : undefined }),
    // 同期の鮮度は sync_runs 由来。取得に失敗しても画面は出す（鮮度は「不明」表示になる）。
    loadSyncFreshness().catch(() => null),
  ]);
  const data = scopeDataForViewer(raw, viewer);
  return <Dashboard initialData={data} initialStart={start} initialEnd={today} viewer={viewer} freshness={freshness} />;
}
