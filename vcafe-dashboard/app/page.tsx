import { redirect } from "next/navigation";
import Dashboard from "@/components/dashboard";
import { getViewer } from "@/lib/auth";
import { loadAnalyticsData } from "@/lib/data-source";
import { scopeDataForViewer } from "@/lib/analytics";

export const dynamic = "force-dynamic";

export default async function Home() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const start = `${today.slice(0, 7)}-01`;
  const data = scopeDataForViewer(await loadAnalyticsData({ start, end: today, maidId: viewer.role === "maid" ? viewer.maidId : undefined }), viewer);
  return <Dashboard initialData={data} initialStart={start} initialEnd={today} viewer={viewer} />;
}
