"use client";

import { useEffect, useMemo, useState } from "react";
import { buildTrend, customerRows, filterData, maidRows, summarize } from "@/lib/analytics";
import type { AnalyticsData, AttendanceSubmission, Granularity, MaidMonthlyReport, MaidReportsResult, Viewer } from "@/lib/types";
import LogoutButton from "@/components/logout-button";

type View = "overview" | "maids" | "users" | "relations" | "attendance";

const nav: Array<{ id: View; label: string; icon: string; adminOnly?: boolean }> = [
  { id: "overview", label: "ダッシュボード", icon: "⌂" },
  { id: "maids", label: "メイド実績", icon: "♙" },
  { id: "users", label: "ユーザーDB", icon: "♧", adminOnly: true },
  { id: "relations", label: "メイド×ユーザー", icon: "◎", adminOnly: true },
  { id: "attendance", label: "勤怠", icon: "◷" },
];

const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("ja-JP");
const jstDate = (value: string | null) => value ? new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)) : "未設定";

function LineChart({ points }: { points: Array<{ label: string; visits: number }> }) {
  const width = 720, height = 220, pad = 28;
  const max = Math.max(...points.map((p) => p.visits), 1);
  const coords = points.map((p, i) => ({ x: pad + (i * (width - pad * 2)) / Math.max(points.length - 1, 1), y: height - pad - (p.visits / max) * (height - pad * 2), ...p }));
  const path = coords.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  return <div className="chart-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="ご帰宅数の推移"><defs><linearGradient id="pinkFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ef5da8" stopOpacity=".28"/><stop offset="1" stopColor="#ef5da8" stopOpacity="0"/></linearGradient></defs>{[0,1,2,3].map((i)=><line key={i} x1={pad} x2={width-pad} y1={pad+i*(height-pad*2)/3} y2={pad+i*(height-pad*2)/3} stroke="#f1e8ed"/>)}{coords.length > 1 && <path d={`${path} L${coords.at(-1)!.x},${height-pad} L${coords[0].x},${height-pad} Z`} fill="url(#pinkFade)"/>}<path d={path} fill="none" stroke="#ef5da8" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>{coords.map((p)=><circle key={`${p.label}-${p.x}`} cx={p.x} cy={p.y} r="4" fill="white" stroke="#ef5da8" strokeWidth="3"><title>{p.label}: {p.visits}件</title></circle>)}{coords.map((p, i) => (points.length <= 24 || i % Math.ceil(points.length / 12) === 0) ? <text key={`v-${p.label}-${p.x}`} x={p.x} y={p.y - 9} textAnchor="middle" fontSize="11" fontWeight="700" fill="#c2185b">{number.format(p.visits)}</text> : null)}</svg><div className="x-labels">{points.filter((_,i)=>i===0||i===points.length-1||i===Math.floor(points.length/2)).map((p)=><span key={p.label}>{p.label}</span>)}</div></div>;
}

function Metric({ label, value, note, tone = "pink" }: { label: string; value: string; note: string; tone?: string }) {
  return <article className="metric"><div className={`metric-icon ${tone}`}>●</div><div><p>{label}</p><strong>{value}</strong><small>{note}</small></div></article>;
}

type ReportRow = MaidMonthlyReport & { averageVisit: number; photoPrice: number };

// 本番 maidWorkReport の月次実績17列。kind は表示形式とソートの型。
const REPORT_COLUMNS: Array<{ key: keyof ReportRow; label: string; kind: "text" | "num" | "money" | "hours" | "float" }> = [
  { key: "nickname", label: "メイド名", kind: "text" },
  { key: "attendance", label: "お給仕回数", kind: "num" },
  { key: "totalWorkTimes", label: "お給仕時間", kind: "hours" },
  { key: "late", label: "遅刻回数", kind: "num" },
  { key: "latetime", label: "遅刻時間", kind: "float" },
  { key: "totalReservation", label: "予約ご帰宅回数", kind: "num" },
  { key: "totalWorkTimesReserve", label: "お給仕時間(予約)", kind: "float" },
  { key: "presumeTotalWorkTimeReserve", label: "見なしお給仕時間(予約)", kind: "float" },
  { key: "lateReservation", label: "遅刻回数(予約)", kind: "num" },
  { key: "latetimeReservation", label: "遅刻時間(予約)", kind: "float" },
  { key: "totalVisits", label: "ご帰宅数", kind: "num" },
  { key: "totalOtameshi", label: "お試しご帰宅回数", kind: "num" },
  { key: "averageVisit", label: "平均ご帰宅数", kind: "float" },
  { key: "totalPresents", label: "プレゼント数", kind: "num" },
  { key: "totalPresentsPrice", label: "プレゼント売上", kind: "money" },
  { key: "totalPhoto", label: "記念撮影回数", kind: "num" },
  { key: "photoPrice", label: "記念撮影売上", kind: "money" },
];

function formatCell(value: number | string, kind: string) {
  if (kind === "text") return String(value);
  const n = Number(value);
  if (kind === "money") return yen.format(n);
  if (kind === "hours") return `${n.toFixed(1)}h`;
  if (kind === "float") return n.toFixed(2);
  return number.format(n);
}

function downloadReportCsv(rows: ReportRow[], month: string) {
  const all = [REPORT_COLUMNS.map((c) => c.label), ...rows.map((r) => REPORT_COLUMNS.map((c) => r[c.key]))];
  const safe = (value: unknown) => { const raw = String(value); const protectedValue = /^[=+\-@]/.test(raw) ? `'${raw}` : raw; return `"${protectedValue.replaceAll('"', '""')}"`; };
  const blob = new Blob(["﻿" + all.map((row) => row.map(safe).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `maid-report_${month}.csv`; anchor.click(); URL.revokeObjectURL(url);
}

function MaidReports({ viewer }: { viewer: Viewer }) {
  const [data, setData] = useState<MaidReportsResult | null>(null);
  const [month, setMonth] = useState("");
  const [sortKey, setSortKey] = useState<keyof ReportRow>("totalVisits");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const params = new URLSearchParams();
    if (month) params.set("month", month);
    fetch(`/api/maid-reports?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "メイド実績を取得できませんでした"); setData(body); if (!month && body.month) setMonth(body.month); })
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "メイド実績を取得できませんでした"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [month]);
  const rows: ReportRow[] = useMemo(() => {
    const base = (data?.reports || []).map((r) => ({ ...r, averageVisit: r.totalWorkTimes > 0 ? r.totalVisits / r.totalWorkTimes : 0, photoPrice: r.totalPhoto * 500 }));
    return base.sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      const cmp = typeof av === "string" ? String(av).localeCompare(String(bv), "ja") : Number(av) - Number(bv);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);
  const toggleSort = (key: keyof ReportRow) => {
    if (key === sortKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  };
  const monthLabel = (m: string) => (m ? `${m.slice(0, 4)}年${m.slice(4, 6)}月` : "");
  return <section className="panel table-panel">
    <div className="panel-head">
      <div><p className="eyebrow">MAID PERFORMANCE</p><h2>{viewer.role === "admin" ? "メイド実績" : "あなたの実績"}</h2><small>本番 maidWorkReport の月次実績</small></div>
      <div style={{ display: "flex", gap: ".6rem", alignItems: "center" }}>
        <label>月 <select value={month} onChange={(e) => setMonth(e.target.value)}>{(data?.months || []).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
        <button className="secondary" onClick={() => downloadReportCsv(rows, month)} disabled={!rows.length}>CSV出力</button>
      </div>
    </div>
    {error ? <p className="error">{error}</p> : loading && !data ? <p className="muted">読込中…</p> : rows.length === 0 ? <p className="muted">この月のデータがありません</p> :
    <div className="table-scroll"><table><thead><tr>{REPORT_COLUMNS.map((c, ci) => (
      <th key={String(c.key)} onClick={() => toggleSort(c.key)} title="クリックで並び替え" style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", textAlign: c.kind === "text" ? "left" : "right", color: sortKey === c.key ? "#ef5da8" : undefined, ...(ci === 0 ? { position: "sticky", left: 0, zIndex: 3, background: "#fff" } : {}) }}>{c.label}{sortKey === c.key ? (sortDir === "desc" ? " ▼" : " ▲") : ""}</th>
    ))}</tr></thead><tbody>{rows.map((r) => (
      <tr key={r.maidId}>{REPORT_COLUMNS.map((c, ci) => (
        <td key={String(c.key)} style={{ whiteSpace: "nowrap", textAlign: c.kind === "text" ? "left" : "right", ...(ci === 0 ? { position: "sticky", left: 0, zIndex: 1, background: "#fff" } : {}) }}>{c.kind === "text" ? <b>{formatCell(r[c.key] as number | string, c.kind)}</b> : formatCell(r[c.key] as number | string, c.kind)}</td>
      ))}</tr>
    ))}</tbody></table></div>}
  </section>;
}

export default function Dashboard({ initialData, initialStart, initialEnd, viewer }: { initialData: AnalyticsData; initialStart: string; initialEnd: string; viewer: Viewer }) {
  const [view, setView] = useState<View>("overview");
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [maidId, setMaidId] = useState(viewer.role === "maid" ? viewer.maidId || "" : "");
  const [userQuery, setUserQuery] = useState("");
  const [remoteData, setRemoteData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [submissions, setSubmissions] = useState<AttendanceSubmission[]>([]);
  const [submissionError, setSubmissionError] = useState("");
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
  const maidStats = maidRows(data);
  const customerStats = customerRows(data);
  const knownRankOrder = ["プラチナ", "ゴールド", "シルバー", "ブロンズ", "未設定"];
  const visibleRanks = [...new Set(customerStats.map((customer) => customer.rank))].sort((a, b) => {
    const aIndex = knownRankOrder.indexOf(a); const bIndex = knownRankOrder.indexOf(b);
    return (aIndex < 0 ? 999 : aIndex) - (bIndex < 0 ? 999 : bIndex) || a.localeCompare(b, "ja");
  });
  const visibleCustomers = customerStats.filter((customer) => `${customer.name} ${customer.id}`.toLowerCase().includes(userQuery.trim().toLowerCase()));
  const maxMaidVisits = Math.max(...maidStats.map((m) => m.visits), 1);
  const presets = (days: number) => { const e = new Date(`${initialEnd}T12:00:00+09:00`); const s = new Date(e); s.setDate(e.getDate() - days + 1); setStart(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(s)); setEnd(initialEnd); };
  const downloadCsv = (filename: string, rows: Array<Array<string | number>>) => {
    const safe = (value: string | number) => { const raw = String(value); const protectedValue = /^[=+\-@]/.test(raw) ? `'${raw}` : raw; return `"${protectedValue.replaceAll('"', '""')}"`; };
    const blob = new Blob(["\uFEFF" + rows.map((row) => row.map(safe).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><img className="brand-logo" src="/logo.png" alt="Virtual at-home cafe" onError={(e) => { const img = e.currentTarget; img.style.display = "none"; const fb = img.nextElementSibling as HTMLElement | null; if (fb) fb.style.display = "grid"; }} /><div className="brand-mark" style={{ display: "none" }}>at</div></div>
      <nav>{nav.filter((item)=>!item.adminOnly || viewer.role === "admin").map((item)=><button key={item.id} className={view===item.id?"active":""} onClick={()=>setView(item.id)}><i>{item.icon}</i>{item.label}</button>)}</nav>
      <div className="sidebar-foot"><span className="status-dot"/>分析環境のみ参照<small>本番DBへの書き込みなし</small></div>
    </aside>
    <main className="main">
      <header className="topbar"><div><p className="eyebrow">VIRTUAL AT-HOME CAFÉ</p><h1>{view === "overview" ? (viewer.role === "maid" ? "マイ実績" : "運営ダッシュボード") : nav.find((n)=>n.id===view)?.label}</h1></div><div className="account"><div className="avatar">{viewer.name.slice(0,1)}</div><div><strong>{viewer.name}</strong><small>{viewer.role === "admin" ? "管理者" : "メイド"}</small></div><LogoutButton /></div></header>
      <section className="filters">
        <div className="presets"><button onClick={()=>presets(1)}>今日</button><button onClick={()=>presets(7)}>7日</button><button onClick={()=>presets(30)}>30日</button><button className={start===initialStart&&end===initialEnd?"selected":""} onClick={()=>{setStart(initialStart);setEnd(initialEnd)}}>今月</button></div>
        <label>開始日<input type="date" value={start} max={end} onChange={(e)=>setStart(e.target.value)}/></label><span className="range-sep">–</span><label>終了日<input type="date" value={end} min={start} onChange={(e)=>setEnd(e.target.value)}/></label>
        <label>集計<select value={granularity} onChange={(e)=>setGranularity(e.target.value as Granularity)}><option value="hour">時間別</option><option value="day">日次</option><option value="week">週次</option><option value="month">月次</option></select></label>
        {viewer.role === "admin" && <label>メイド<select value={maidId} onChange={(e)=>setMaidId(e.target.value)}><option value="">すべて</option>{initialData.maids.map((m)=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
      </section>
      <div className="freshness"><span className="status-dot"/> 最終同期 {new Date(remoteData.generatedAt).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})} <b>・分析用データ</b>{loading && " ・読込中"}{loadError && <span className="error-inline"> ・{loadError}</span>}</div>

      {view === "overview" && <>
        <section className="metrics"><Metric label="ご帰宅数" value={`${number.format(totals.visits)}件`} note={`ユニーク ${totals.customerCount}名`}/><Metric label="売上" value={yen.format(totals.revenue)} note={`有料ご帰宅 ${totals.paid}件`} tone="purple"/><Metric label="実働時間" value={`${totals.workHours.toFixed(1)}h`} note={`遅刻合計 ${totals.lateMinutes.toFixed(0)}分`} tone="blue"/><Metric label="記念撮影" value={`${totals.cheki}枚`} note={`撮影率 ${totals.visits ? (totals.cheki/totals.visits*100).toFixed(1) : 0}%`} tone="orange"/></section>
        <section className="grid-2"><article className="panel"><div className="panel-head"><div><p className="eyebrow">PERFORMANCE TREND</p><h2>ご帰宅数の推移</h2></div><span className="badge">{granularity === "hour" ? "時間別" : granularity === "day" ? "日次" : granularity === "week" ? "週次" : "月次"}</span></div><LineChart points={trend}/></article><article className="panel"><div className="panel-head"><div><p className="eyebrow">POPULAR MAIDS</p><h2>{viewer.role === "admin" ? "人気メイド" : "実績内訳"}</h2></div></div><div className="ranking">{maidStats.slice(0,5).map((m,i)=><div className="rank-row" key={m.id}><span className="rank">{i+1}</span><span className="mini-avatar">{m.avatar}</span><div><strong>{m.name}</strong><small>{m.perHour.toFixed(2)}件/h・撮影{m.cheki}・{m.users}名</small></div><div className="bar"><i style={{width:`${maidStats[0]?.score ? m.score/maidStats[0].score*100 : 0}%`}}/></div><b>{m.visits}</b></div>)}</div></article></section>
        <section className="grid-2"><article className="panel"><div className="panel-head"><div><p className="eyebrow">CUSTOMER MIX</p><h2>ユーザーランク構成</h2></div></div><div className="rank-mix">{visibleRanks.map((rank)=>{const count=customerStats.filter((u)=>u.rank===rank).length;return <div key={rank}><span>{rank}</span><strong>{count}<small>名</small></strong><i><em style={{width:`${customerStats.length?count/customerStats.length*100:0}%`}}/></i></div>})}</div></article><article className="panel"><div className="panel-head"><div><p className="eyebrow">TOP CUSTOMERS</p><h2>{viewer.role === "admin" ? "ご帰宅ユーザー" : "お客様傾向"}</h2></div></div>{viewer.role === "admin" ? <div className="compact-users">{customerStats.slice(0,4).map((u)=><div key={u.id}><span className={`rank-pill ${u.rank}`}>{u.rank.slice(0,1)}</span><div><strong>{u.name}</strong><small>最終 {u.lastVisit}</small></div><b>{u.visits}回</b></div>)}</div> : <p className="privacy-note">メイド画面では個別ユーザー名を表示せず、ランク構成・リピート率など本人に関係する集計のみ表示します。</p>}</article></section>
      </>}

      {view === "maids" && <MaidReports viewer={viewer} />}

      {view === "users" && viewer.role === "admin" && <section className="panel table-panel"><div className="panel-head"><div><p className="eyebrow">CUSTOMER DATABASE</p><h2>ユーザーデータベース</h2></div><input className="search" value={userQuery} onChange={(e)=>setUserQuery(e.target.value)} placeholder="⌕ ユーザーを検索" /></div><div className="table-scroll"><table><thead><tr><th>ユーザー名</th><th>ランク</th><th>登録日</th><th>ご帰宅</th><th>利用額</th><th>最推しメイド</th><th>最終ご帰宅</th></tr></thead><tbody>{visibleCustomers.map((u)=><tr key={u.id}><td><b>{u.name}</b><small className="id">{u.id}</small></td><td><span className={`text-rank ${u.rank}`}>{u.rank}</span></td><td>{jstDate(u.registeredAt)}</td><td>{u.visits}回</td><td>{yen.format(u.spend)}</td><td>{u.favoriteMaid}</td><td>{u.lastVisit}</td></tr>)}</tbody></table></div></section>}

      {view === "relations" && viewer.role === "admin" && <section className="panel table-panel"><div className="panel-head"><div><p className="eyebrow">MAID × CUSTOMER</p><h2>ご帰宅クロス分析</h2></div></div><div className="table-scroll"><table className="matrix"><thead><tr><th>ユーザー</th>{data.maids.map((m)=><th key={m.id}>{m.name}</th>)}<th>合計</th></tr></thead><tbody>{customerStats.map((u)=><tr key={u.id}><td><b>{u.name}</b></td>{data.maids.map((m)=><td key={m.id}>{data.visits.filter((v)=>v.customerId===u.id&&v.maidId===m.id).length || "—"}</td>)}<td><b>{u.visits}</b></td></tr>)}</tbody></table></div></section>}

      {view === "attendance" && <><section className="panel table-panel"><div className="panel-head"><div><p className="eyebrow">ATTENDANCE</p><h2>勤怠実績</h2></div></div><div className="table-scroll"><table><thead><tr><th>日付</th><th>メイド</th><th>予定</th><th>実績</th><th>実働</th><th>遅刻</th></tr></thead><tbody>{data.shifts.slice().reverse().slice(0,40).map((s)=>{const m=data.maids.find((x)=>x.id===s.maidId);const time=(value:string)=>new Date(value).toLocaleTimeString("ja-JP",{timeZone:"Asia/Tokyo",hour:"2-digit",minute:"2-digit"});const mins=s.actualStart?Math.max(0,(new Date(s.actualStart).getTime()-new Date(s.scheduledStart).getTime())/60000):0;const hrs=s.actualStart&&s.actualEnd?(new Date(s.actualEnd).getTime()-new Date(s.actualStart).getTime())/3600000:0;return <tr key={s.id}><td>{new Date(s.scheduledStart).toLocaleDateString("ja-JP",{timeZone:"Asia/Tokyo"})}</td><td><b>{m?.name}</b></td><td>{time(s.scheduledStart)}–{time(s.scheduledEnd)}</td><td>{s.actualStart?time(s.actualStart):"未打刻"}–{s.actualEnd?time(s.actualEnd):"未打刻"}</td><td>{hrs.toFixed(1)}h</td><td><span className={mins?"late":"ok"}>{mins?`${mins}分`:"定時"}</span></td></tr>})}</tbody></table></div></section>{viewer.role === "admin" && <section className="panel table-panel submissions-panel"><div className="panel-head"><div><p className="eyebrow">DISCORD SUBMISSIONS</p><h2>Discord勤怠申請</h2><small>確認用一覧・シフト本体への自動反映なし</small></div></div>{submissionError ? <p className="error">{submissionError}</p> : <div className="table-scroll"><table><thead><tr><th>対象日</th><th>種別</th><th>メイド</th><th>対象時間</th><th>理由・補足</th><th>受付日時</th></tr></thead><tbody>{submissions.map((s)=><tr key={s.id}><td>{s.targetDate || "—"}</td><td><b>{s.eventLabel}</b></td><td>{s.maidName}</td><td>{s.targetTime || "—"}</td><td>{s.reason || "—"}</td><td>{s.receivedAt ? new Date(s.receivedAt).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"}) : "—"}</td></tr>)}{submissions.length === 0 && <tr><td colSpan={6}>申請はまだありません</td></tr>}</tbody></table></div>}</section>}</>}
    </main>
  </div>;
}
