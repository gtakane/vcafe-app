"use client";

import { useEffect, useMemo, useState } from "react";
import { buildTrend, crossVisitCounts, customerRows, filterData, summarize } from "@/lib/analytics";
import type { AttendanceSubmission, Customer, Granularity, Maid, MaidMonthlyReport, MaidReportsResult, MaidVisitLog, Shift, SyncFreshness, Viewer, ViewerScopedData } from "@/lib/types";
import type { GrowthMetrics } from "@/lib/growth";
// 座席定数はサーバー依存の無い metrics から取る（growth は BigQuery を読み込むため）。
import { mergedStayMinutes, SEATS_PER_MAID, shiftActualHours } from "@/lib/metrics";
import LogoutButton from "@/components/logout-button";
import { downloadCsv } from "@/lib/csv";
import { genderLabel, jstDate, jstDateTime, number, pct, truncate2, yen } from "@/components/dashboard/shared/format";
import LineChart from "@/components/dashboard/shared/line-chart";
import Metric from "@/components/dashboard/shared/metric-card";
import VisitLogPanel from "@/components/dashboard/visit-log/panel";
import AttendanceTable from "@/components/dashboard/views/attendance-view";
import MaidReports from "@/components/dashboard/views/maid-performance-view";
import CustomerDatabase from "@/components/dashboard/views/customer-database-view";
import CrossMatrix from "@/components/dashboard/views/relations-view";
import GrowthPanel from "@/components/dashboard/views/growth-view";

type View = "overview" | "maids" | "growth" | "users" | "relations" | "attendance";

const nav: Array<{ id: View; label: string; icon: string; adminOnly?: boolean }> = [
  { id: "overview", label: "ダッシュボード", icon: "⌂" },
  { id: "maids", label: "メイド実績", icon: "♙" },
  { id: "growth", label: "グロース指標", icon: "⇗", adminOnly: true },
  { id: "users", label: "ユーザーDB", icon: "♧", adminOnly: true },
  { id: "relations", label: "メイド×ユーザー", icon: "◎", adminOnly: true },
  { id: "attendance", label: "勤怠", icon: "◷" },
];



// 本番 maidWorkReport の月次実績17列。kind は表示形式とソートの型。
// 遅刻系は小数点第3位以下を切り捨てる（四捨五入しない）。

type CustomerRow = ReturnType<typeof customerRows>[number];


// ユーザーDBの列定義。kind は表示形式とソートの型。
const CUSTOMER_COLUMNS: Array<{ key: keyof CustomerRow; label: string; kind: "text" | "num" | "money" | "date" | "gender" | "year" }> = [
  { key: "name", label: "ユーザー名", kind: "text" },
  { key: "rank", label: "ランク", kind: "text" },
  { key: "gender", label: "性別", kind: "gender" },
  { key: "birthYear", label: "生年", kind: "year" },
  { key: "registeredAt", label: "登録日", kind: "date" },
  { key: "visits", label: "ご帰宅(期間)", kind: "num" },
  { key: "sessions", label: "来店セッション数", kind: "num" },
  { key: "paidVisits", label: "有料", kind: "num" },
  { key: "reservations", label: "予約", kind: "num" },
  { key: "cheki", label: "チェキ", kind: "num" },
  { key: "spend", label: "利用額(期間)", kind: "money" },
  { key: "avgSpend", label: "平均単価", kind: "money" },
  { key: "paymentCount", label: "課金回数(期間)", kind: "num" },
  { key: "paymentAmount", label: "課金額(期間)", kind: "money" },
  { key: "lastPaymentAt", label: "最終課金日", kind: "date" },
  { key: "purchasedItemQuantity", label: "アイテム購入数", kind: "num" },
  { key: "purchasedItemCoin", label: "アイテム購入額(コイン)", kind: "num" },
  { key: "lastPurchasedItemAt", label: "最終アイテム購入日", kind: "date" },
  { key: "presentAmount", label: "プレゼント回数", kind: "num" },
  { key: "lastPresentAt", label: "最終プレゼント日", kind: "date" },
  { key: "coin", label: "コイン残高", kind: "num" },
  { key: "rewardPoint", label: "リワードP残高", kind: "num" },
  { key: "totalVisitAmount", label: "累計ご帰宅(通算)", kind: "num" },
  { key: "maxConsecutiveVisitDays", label: "最大連続日数", kind: "num" },
  { key: "uniqueMaids", label: "担当メイド数", kind: "num" },
  { key: "favoriteMaid", label: "最推しメイド", kind: "text" },
  { key: "firstVisit", label: "初ご帰宅", kind: "text" },
  { key: "lastVisit", label: "最終ご帰宅", kind: "text" },
];

// ご帰宅明細（メイド個別ログ／ユーザー個別ログ共通）。

// 個別ログを取得して表示する（メイド個別／ユーザー個別で共通）。
// 勤怠実績: 全行表示・列ソート・メイド/状態フィルタ付き。遅刻分は小数点第3位以下切り捨て。
// ユーザーDBの列。すべて users ドキュメント由来の通算値で、上部の期間フィルタには依存しない。
// 数値範囲で絞り込める指標（サーバー側 CUSTOMER_NUMERIC_KEYS と対応）。よく使う順に並べる。
// ユーザー個別のドリルダウン（プロフィール＋ご帰宅明細）。既定は直近365日。
export default function Dashboard({ initialData, initialStart, initialEnd, viewer, freshness }: { initialData: ViewerScopedData; initialStart: string; initialEnd: string; viewer: Viewer; freshness?: SyncFreshness | null }) {
  const [view, setView] = useState<View>("overview");
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [maidId, setMaidId] = useState(viewer.role === "maid" ? viewer.maidId || "" : "");
  const [remoteData, setRemoteData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [submissions, setSubmissions] = useState<AttendanceSubmission[]>([]);
  const [submissionError, setSubmissionError] = useState("");
  const [maidTab, setMaidTab] = useState<"monthly" | "log">("monthly");
  const [logMaidId, setLogMaidId] = useState("");
  const [growth, setGrowth] = useState<GrowthMetrics | null>(null);
  const [growthLoading, setGrowthLoading] = useState(false);
  const [growthError, setGrowthError] = useState("");
  useEffect(() => {
    if (viewer.role !== "admin") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setGrowthLoading(true); setGrowthError("");
      try {
        const response = await fetch(`/api/growth?${new URLSearchParams({ start, end })}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error((await response.json()).error || "グロース指標を取得できませんでした");
        setGrowth(await response.json());
      } catch (error) { if (!controller.signal.aborted) setGrowthError(error instanceof Error ? error.message : "グロース指標を取得できませんでした"); }
      finally { if (!controller.signal.aborted) setGrowthLoading(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [start, end, viewer.role]);
  useEffect(() => {
    if (viewer.role !== "admin") return;
    const controller = new AbortController();
    fetch("/api/attendance-submissions", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Discord勤怠申請を取得できませんでした");
        setSubmissions(body.submissions || []);
      })
      .catch((error) => { if (!controller.signal.aborted) setSubmissionError(error instanceof Error ? error.message : "Discord勤怠申請を取得できませんでした"); });
    return () => controller.abort();
  }, [viewer.role]);
  useEffect(() => {
    const initialMaidId = viewer.role === "maid" ? viewer.maidId || "" : "";
    if (start === initialStart && end === initialEnd && maidId === initialMaidId) { setRemoteData(initialData); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true); setLoadError("");
      try {
        const params = new URLSearchParams({ start, end }); if (maidId) params.set("maidId", maidId);
        const response = await fetch(`/api/analytics?${params}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error((await response.json()).error || "データを取得できませんでした");
        setRemoteData(await response.json());
      } catch (error) { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "データを取得できませんでした"); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [start, end, maidId, initialStart, initialEnd, initialData]);
  const data = useMemo(() => filterData(remoteData, viewer, { start, end, granularity, maidId: maidId || undefined }), [remoteData, viewer, start, end, granularity, maidId]);
  const totals = summarize(data);
  const trend = buildTrend(data.visits, granularity);
  const customerStats = customerRows(data);
  // ご帰宅クロスは一度だけ集計する（ユーザー×メイド×訪問の総当たりを避ける）。
  // ご帰宅数の定義は lib/analytics.ts に集約する（画面側で +1 すると概要と食い違う）。
  const crossCounts = useMemo(() => crossVisitCounts(data.visits), [data.visits]);
  const knownRankOrder = ["プラチナ", "ゴールド", "シルバー", "ブロンズ", "未設定"];
  const visibleRanks = [...new Set(customerStats.map((customer) => customer.rank))].sort((a, b) => {
    const aIndex = knownRankOrder.indexOf(a); const bIndex = knownRankOrder.indexOf(b);
    return (aIndex < 0 ? 999 : aIndex) - (bIndex < 0 ? 999 : bIndex) || a.localeCompare(b, "ja");
  });
  const presets = (days: number) => { const e = new Date(`${initialEnd}T12:00:00+09:00`); const s = new Date(e); s.setDate(e.getDate() - days + 1); setStart(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(s)); setEnd(initialEnd); };

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><img className="brand-logo" src="/logo-e.png" alt="Virtual at-home cafe" onError={(e) => { const img = e.currentTarget; img.style.display = "none"; const fb = img.nextElementSibling as HTMLElement | null; if (fb) fb.style.display = "grid"; }} /><div className="brand-mark" style={{ display: "none" }}>at</div></div>
      <nav>{nav.filter((item)=>!item.adminOnly || viewer.role === "admin").map((item)=><button key={item.id} className={view===item.id?"active":""} onClick={()=>setView(item.id)}><i>{item.icon}</i>{item.label}</button>)}</nav>
      <div className="sidebar-foot"><span className="status-dot"/>分析環境のみ参照<small>本番DBへの書き込みなし</small></div>
    </aside>
    <main className="main">
      <header className="topbar"><div><p className="eyebrow">VIRTUAL AT-HOME CAFÉ</p><h1>{view === "overview" ? (viewer.role === "maid" ? "マイ実績" : "運営ダッシュボード") : nav.find((n)=>n.id===view)?.label}</h1></div><div className="account"><div className="avatar">{viewer.name.slice(0,1)}</div><div><strong>{viewer.name}</strong><small>{viewer.role === "admin" ? "管理者" : "メイド"}</small></div><LogoutButton /></div></header>
      {/* ユーザーDBは全会員の通算値を扱い期間に依存しないため、期間フィルタを表示しない。 */}
      {view !== "users" && <section className="filters">
        <div className="presets"><button onClick={()=>presets(1)}>今日</button><button onClick={()=>presets(7)}>7日</button><button onClick={()=>presets(30)}>30日</button><button className={start===initialStart&&end===initialEnd?"selected":""} onClick={()=>{setStart(initialStart);setEnd(initialEnd)}}>今月</button></div>
        <label>開始日<input type="date" value={start} max={end} onChange={(e)=>setStart(e.target.value)}/></label><span className="range-sep">–</span><label>終了日<input type="date" value={end} min={start} onChange={(e)=>setEnd(e.target.value)}/></label>
        <label>集計<select value={granularity} onChange={(e)=>setGranularity(e.target.value as Granularity)}><option value="hour">時間別</option><option value="day">日次</option><option value="week">週次</option><option value="month">月次</option></select></label>
        {viewer.role === "admin" && <label>メイド<select value={maidId} onChange={(e)=>setMaidId(e.target.value)}><option value="">すべて</option>{initialData.maids.map((m)=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
      </section>}
      {/* 「最終同期」は sync_runs の watermark。API応答時刻を出すと同期が止まっても
          常に「今」が表示され、停止に気づけない。取得できない場合は不明と明示する。 */}
      {(() => {
        const stale = freshness?.freshnessLagMinutes != null && freshness.freshnessLagMinutes > 180;
        const degraded = freshness?.lastStatus === "degraded";
        const label = freshness?.lastSyncedAt
          ? new Date(freshness.lastSyncedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
          : "不明";
        return <div className="freshness">
          <span className="status-dot" style={stale || degraded ? { background: "#d6336c" } : undefined}/>
          {" "}最終同期 {label} <b>・分析用データ</b>
          {stale && <span className="error-inline"> ・{Math.floor((freshness!.freshnessLagMinutes ?? 0) / 60)}時間以上更新されていません</span>}
          {degraded && <span className="error-inline"> ・一部のデータを取得できていません</span>}
          {!freshness && <span className="error-inline"> ・同期状況を取得できませんでした</span>}
          {loading && " ・読込中"}
          {loadError && <span className="error-inline"> ・{loadError}</span>}
        </div>;
      })()}

      {view === "overview" && <>
        <section className="metrics"><Metric label="ご帰宅数" value={`${number.format(totals.visits)}件`} note={`ユニーク ${totals.customerCount}名`}/><Metric label="売上" value={yen.format(totals.revenue)} note={`有料ご帰宅 ${totals.paid}件`} tone="purple"/><Metric label="実働時間" value={`${totals.workHours.toFixed(1)}h`} note={`遅刻合計 ${totals.lateMinutes.toFixed(0)}分`} tone="blue"/><Metric label="記念撮影" value={`${totals.cheki}枚`} note={`撮影率 ${totals.visits ? (totals.cheki/totals.visits*100).toFixed(1) : 0}%`} tone="orange"/>{viewer.role === "admin" && <><Metric label="1日あたり利用者数(平均)" value={growth ? `${number.format(growth.avgDau)}名` : "—"} note={growth ? `最も多い日 ${number.format(growth.peakDau)}名` : (growthError || "集計中")} tone="blue" hint="DAU（デイリー・アクティブ・ユーザー）＝その営業日に1回以上ご帰宅したユーザーの実人数。同じ人が何回ご帰宅しても1名と数えます。『平均』は選択期間の1日平均、『最も多い日』は期間中で最大だった日の人数です。"/><Metric label="新規登録者数" value={growth ? `${number.format(growth.newRegistrations)}名` : "—"} note={growth ? `課金転換 ${pct(growth.newPaidConversionRate)}` : (growthError || "集計中")} tone="purple" hint="選択期間内に新しく会員登録したユーザーの人数。課金転換は、そのうち期間内に有料ご帰宅をした人の割合です。"/></>}</section>
        <section className="grid-2"><article className="panel"><div className="panel-head"><div><p className="eyebrow">PERFORMANCE TREND</p><h2>ご帰宅数の推移</h2></div><span className="badge">{granularity === "hour" ? "時間別" : granularity === "day" ? "日次" : granularity === "week" ? "週次" : "月次"}</span></div><LineChart points={trend}/></article><article className="panel"><div className="panel-head"><div><p className="eyebrow">CUSTOMER MIX</p><h2>ユーザーランク構成</h2></div></div><div className="rank-mix">{visibleRanks.map((rank)=>{const count=customerStats.filter((u)=>u.rank===rank).length;return <div key={rank}><span>{rank}</span><strong>{count}<small>名</small></strong><i><em style={{width:`${customerStats.length?count/customerStats.length*100:0}%`}}/></i></div>})}</div></article></section>
      </>}

      {view === "maids" && <>
        <div className="tabs">
          <button className={maidTab === "monthly" ? "active" : ""} onClick={() => setMaidTab("monthly")}>月次実績</button>
          <button className={maidTab === "log" ? "active" : ""} onClick={() => setMaidTab("log")}>個別ログ（ご帰宅明細）</button>
        </div>
        {maidTab === "monthly" ? <MaidReports viewer={viewer} /> :
        <section className="panel table-panel">
          <div className="panel-head">
            <div><p className="eyebrow">VISIT LOG</p><h2>{viewer.role === "admin" ? "メイド個別のご帰宅明細" : "あなたのご帰宅明細"}</h2><small>期間 {start}〜{end}・いつ／誰が／何分／どのチケット／支払い方法／チェキ／アイテム使用</small></div>
            {viewer.role === "admin" && <label>メイド<select value={logMaidId} onChange={(e) => setLogMaidId(e.target.value)}><option value="">選択してください</option>{initialData.maids.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
          </div>
          <VisitLogPanel start={start} end={end} maidId={viewer.role === "maid" ? viewer.maidId || "" : logMaidId} hideMaid exportName={`visit-log_${logMaidId || viewer.maidId || "me"}_${start}_${end}.csv`}
            serveMinutes={(() => {
              // 選択メイドのお給仕時間。未打刻のシフトも予定時刻で補完する
              // （shiftActualHours = core.py 準拠。ダッシュボードの「実働時間」と同じ集計）。
              // 打刻のある行だけを足すと未打刻分が丸ごと欠落し、稼働率が過大になる。
              const id = viewer.role === "maid" ? viewer.maidId || "" : logMaidId;
              if (!id) return null;
              return data.shifts
                .filter((s) => s.maidId === id)
                .reduce((acc, s) => acc + shiftActualHours(s) * 60, 0);
            })()} />
        </section>}
      </>}

      {view === "growth" && viewer.role === "admin" && <GrowthPanel growth={growth} loading={growthLoading} error={growthError} />}

      {view === "users" && viewer.role === "admin" && <CustomerDatabase onExport={downloadCsv} />}

      {view === "relations" && viewer.role === "admin" && <CrossMatrix maids={data.maids} customers={customerStats} counts={crossCounts} onExport={downloadCsv} />}

      {view === "attendance" && <><AttendanceTable shifts={data.shifts} maids={data.maids} />{viewer.role === "admin" && <section className="panel table-panel submissions-panel"><div className="panel-head"><div><p className="eyebrow">DISCORD SUBMISSIONS</p><h2>Discord勤怠申請</h2><small>確認用一覧・シフト本体への自動反映なし</small></div></div>{submissionError ? <p className="error">{submissionError}</p> : <div className="table-scroll"><table><thead><tr><th>対象日</th><th>種別</th><th>メイド</th><th>対象時間</th><th>理由・補足</th><th>受付日時</th></tr></thead><tbody>{submissions.map((s)=><tr key={s.id}><td>{s.targetDate || "—"}</td><td><b>{s.eventLabel}</b></td><td>{s.maidName}</td><td>{s.targetTime || "—"}</td><td>{s.reason || "—"}</td><td>{s.receivedAt ? new Date(s.receivedAt).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"}) : "—"}</td></tr>)}{submissions.length === 0 && <tr><td colSpan={6}>申請はまだありません</td></tr>}</tbody></table></div>}</section>}</>}
    </main>
  </div>;
}
