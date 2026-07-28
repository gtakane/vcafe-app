"use client";

import { useEffect, useMemo, useState } from "react";
import { buildTrend, customerRows, filterData, summarize } from "@/lib/analytics";
import type { AttendanceSubmission, Customer, Granularity, Maid, MaidMonthlyReport, MaidReportsResult, MaidVisitLog, Shift, Viewer, ViewerScopedData } from "@/lib/types";
import type { GrowthMetrics } from "@/lib/growth";
// 座席定数はサーバー依存の無い metrics から取る（growth は BigQuery を読み込むため）。
import { mergedStayMinutes, SEATS_PER_MAID, shiftActualHours } from "@/lib/metrics";
import LogoutButton from "@/components/logout-button";

type View = "overview" | "maids" | "growth" | "users" | "relations" | "attendance";

const nav: Array<{ id: View; label: string; icon: string; adminOnly?: boolean }> = [
  { id: "overview", label: "ダッシュボード", icon: "⌂" },
  { id: "maids", label: "メイド実績", icon: "♙" },
  { id: "growth", label: "グロース指標", icon: "⇗", adminOnly: true },
  { id: "users", label: "ユーザーDB", icon: "♧", adminOnly: true },
  { id: "relations", label: "メイド×ユーザー", icon: "◎", adminOnly: true },
  { id: "attendance", label: "勤怠", icon: "◷" },
];

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("ja-JP");
const jstDate = (value: string | null) => value ? new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)) : "未設定";

function LineChart({ points, suffix = "件", ariaLabel = "ご帰宅数の推移" }: { points: Array<{ label: string; visits: number }>; suffix?: string; ariaLabel?: string }) {
  const width = 720, height = 220, pad = 28;
  if (!points.length) return <div className="chart-wrap"><p className="muted" style={{ padding: "2rem 0", textAlign: "center" }}>この期間のデータがありません</p></div>;
  const max = Math.max(...points.map((p) => p.visits), 1);
  const coords = points.map((p, i) => ({ x: pad + (i * (width - pad * 2)) / Math.max(points.length - 1, 1), y: height - pad - (p.visits / max) * (height - pad * 2), ...p }));
  const path = coords.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  const single = coords.length === 1;
  return <div className="chart-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}><defs><linearGradient id="pinkFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ef5da8" stopOpacity=".28"/><stop offset="1" stopColor="#ef5da8" stopOpacity="0"/></linearGradient></defs>{[0,1,2,3].map((i)=><line key={i} x1={pad} x2={width-pad} y1={pad+i*(height-pad*2)/3} y2={pad+i*(height-pad*2)/3} stroke="#f1e8ed"/>)}{coords.length > 1 && <path d={`${path} L${coords.at(-1)!.x},${height-pad} L${coords[0].x},${height-pad} Z`} fill="url(#pinkFade)"/>}{!single && <path d={path} fill="none" stroke="#ef5da8" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>}{coords.map((p)=><circle key={`${p.label}-${p.x}`} cx={single ? width / 2 : p.x} cy={p.y} r={single ? 6 : 4} fill="white" stroke="#ef5da8" strokeWidth="3"><title>{p.label}: {p.visits}{suffix}</title></circle>)}{coords.map((p, i) => (points.length <= 24 || i % Math.ceil(points.length / 12) === 0) ? <text key={`v-${p.label}-${p.x}`} x={single ? width / 2 : p.x} y={p.y - 9} textAnchor="middle" fontSize="11" fontWeight="700" fill="#c2185b">{number.format(p.visits)}</text> : null)}</svg><div className="x-labels">{(single ? points : points.filter((_,i)=>i===0||i===points.length-1||i===Math.floor(points.length/2))).map((p)=><span key={p.label}>{p.label}</span>)}</div></div>;
}

function Metric({ label, value, note, tone = "pink", hint }: { label: string; value: string; note: string; tone?: string; hint?: string }) {
  return <article className="metric" title={hint}><div className={`metric-icon ${tone}`}>●</div><div><p>{label}{hint && <span className="hint-mark" aria-label={hint}>?</span>}</p><strong>{value}</strong><small>{note}</small></div></article>;
}

type ReportRow = MaidMonthlyReport & { averageVisit: number; photoPrice: number };

// 本番 maidWorkReport の月次実績17列。kind は表示形式とソートの型。
const REPORT_COLUMNS: Array<{ key: keyof ReportRow; label: string; kind: "text" | "num" | "money" | "hours" | "float" | "trunc" }> = [
  { key: "nickname", label: "メイド名", kind: "text" },
  { key: "attendance", label: "お給仕回数", kind: "num" },
  { key: "totalWorkTimes", label: "お給仕時間", kind: "hours" },
  { key: "late", label: "遅刻回数", kind: "num" },
  { key: "latetime", label: "遅刻時間", kind: "trunc" },
  { key: "totalReservation", label: "予約ご帰宅回数", kind: "num" },
  { key: "totalWorkTimesReserve", label: "お給仕時間(予約)", kind: "float" },
  { key: "presumeTotalWorkTimeReserve", label: "見なしお給仕時間(予約)", kind: "float" },
  { key: "lateReservation", label: "遅刻回数(予約)", kind: "num" },
  { key: "latetimeReservation", label: "遅刻時間(予約)", kind: "trunc" },
  { key: "totalVisits", label: "ご帰宅数", kind: "num" },
  { key: "totalOtameshi", label: "お試しご帰宅回数", kind: "num" },
  { key: "averageVisit", label: "平均ご帰宅数", kind: "float" },
  { key: "totalPresents", label: "プレゼント数", kind: "num" },
  { key: "totalPresentsPrice", label: "プレゼント売上", kind: "money" },
  { key: "totalPhoto", label: "記念撮影回数", kind: "num" },
  { key: "photoPrice", label: "記念撮影売上", kind: "money" },
];

// 遅刻系は小数点第3位以下を切り捨てる（四捨五入しない）。
const truncate2 = (n: number) => Math.floor(n * 100) / 100;

function formatCell(value: number | string, kind: string) {
  if (kind === "text") return String(value);
  const n = Number(value);
  if (kind === "money") return yen.format(n);
  if (kind === "hours") return `${n.toFixed(1)}h`;
  if (kind === "trunc") return truncate2(n).toFixed(2);
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
      <div><p className="eyebrow">MAID PERFORMANCE</p><h2>{viewer.role === "admin" ? "メイド実績（月次）" : "あなたの実績（月次）"}</h2><small>本番 maidWorkReport の月次実績</small></div>
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

type CustomerRow = ReturnType<typeof customerRows>[number];

const GENDER_LABELS: Record<string, string> = { male: "男性", female: "女性", other: "その他" };
const genderLabel = (value: string) => GENDER_LABELS[value] || (value ? value : "未設定");

// ユーザーDBの列定義。kind は表示形式とソートの型。
const CUSTOMER_COLUMNS: Array<{ key: keyof CustomerRow; label: string; kind: "text" | "num" | "money" | "date" | "gender" | "year" }> = [
  { key: "name", label: "ユーザー名", kind: "text" },
  { key: "rank", label: "ランク", kind: "text" },
  { key: "gender", label: "性別", kind: "gender" },
  { key: "birthYear", label: "生年", kind: "year" },
  { key: "registeredAt", label: "登録日", kind: "date" },
  { key: "visits", label: "ご帰宅(期間)", kind: "num" },
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
const LOG_COLUMNS: Array<{ key: keyof MaidVisitLog; label: string; align?: "right" }> = [
  { key: "at", label: "日時" },
  { key: "customerName", label: "ユーザー" },
  { key: "maidName", label: "メイド" },
  { key: "minutes", label: "滞在(分)", align: "right" },
  { key: "typeLabel", label: "種別" },
  { key: "ticketLabel", label: "使用チケット" },
  { key: "payment", label: "支払い" },
  { key: "billedCoin", label: "消費コイン", align: "right" },
  { key: "billedRewardPoint", label: "消費RP", align: "right" },
  { key: "revenue", label: "売上", align: "right" },
  { key: "cheki", label: "チェキ", align: "right" },
  { key: "presentNames", label: "アイテム使用" },
];

const jstDateTime = (value: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

function VisitLogTable({ logs, hideMaid, hideCustomer, onExport, exportName, serveMinutes }: { logs: MaidVisitLog[]; hideMaid?: boolean; hideCustomer?: boolean; onExport: (name: string, data: Array<Array<string | number>>) => void; exportName: string; serveMinutes?: number | null }) {
  const columns = LOG_COLUMNS.filter((c) => !(hideMaid && c.key === "maidName") && !(hideCustomer && c.key === "customerName"));
  const cell = (log: MaidVisitLog, key: keyof MaidVisitLog) => {
    if (key === "at") return jstDateTime(log.at);
    if (key === "revenue") return yen.format(log.revenue);
    if (key === "cheki") return log.cheki ? `${log.cheki}枚` : "—";
    if (key === "presentNames") return log.presents ? `${log.presentNames}${log.presents > 1 ? ` ×${log.presents}` : ""}` : "—";
    const value = log[key];
    return typeof value === "number" ? (value ? number.format(value) : "—") : String(value ?? "—");
  };
  const totals = logs.reduce((acc, log) => ({
    minutes: acc.minutes + log.minutes, revenue: acc.revenue + log.revenue,
    cheki: acc.cheki + log.cheki, presents: acc.presents + log.presents,
  }), { minutes: 0, revenue: 0, cheki: 0, presents: 0 });
  // 同時間帯の重なりを除いた実接客時間。お給仕時間と直接比較できる。
  const mergedMinutes = mergedStayMinutes(logs);
  if (!logs.length) return <p className="muted">この期間のご帰宅がありません</p>;
  return <>
    <div className="log-summary">
      <span><b>{number.format(logs.length)}</b>件</span>
      <span title={`ユーザーごとの滞在分の単純合計。同時に最大${SEATS_PER_MAID}名が着席するため、実時間より大きくなります`}>延べ滞在 <b>{number.format(totals.minutes)}</b>分</span>
      <span title={`同時間帯の重なりを除いた実際の接客時間。${SEATS_PER_MAID}名同席の20分は延べ60分でも実時間は20分`}>実接客 <b>{number.format(Math.round(mergedMinutes))}</b>分</span>
      {serveMinutes != null && serveMinutes > 0 && <>
        <span title="この期間の実お給仕時間（打刻ベース）">実お給仕 <b>{number.format(Math.round(serveMinutes))}</b>分</span>
        {/* 実接客(重なり除去済み)がお給仕時間を超えるのは物理的にあり得ない＝データ異常のサイン。 */}
        {(() => {
          const rate = mergedMinutes / serveMinutes;
          const over = rate > 1;
          return <span title={over
            ? "重なりを除いた実接客時間がお給仕時間を超えています。ご帰宅の重複計上か打刻漏れの可能性があります"
            : "お給仕時間のうち、実際にユーザーが着席していた割合"}
            style={over ? { color: "#d6336c", fontWeight: 600 } : undefined}>
            稼働率 <b>{(rate * 100).toFixed(1)}%</b>{over ? " ⚠ 要確認" : ""}
          </span>;
        })()}
      </>}
      <span>売上 <b>{yen.format(totals.revenue)}</b></span>
      <span>チェキ <b>{number.format(totals.cheki)}</b>枚</span>
      <span>アイテム使用 <b>{number.format(totals.presents)}</b></span>
      <button className="secondary" onClick={() => onExport(exportName, [columns.map((c) => c.label), ...logs.map((log) => columns.map((c) => (c.key === "at" ? jstDateTime(log.at) : String(log[c.key] ?? ""))))])}>CSV出力</button>
    </div>
    <div className="table-scroll tall"><table className="freeze-head"><thead><tr>{columns.map((c) => <th key={String(c.key)} style={{ textAlign: c.align || "left", whiteSpace: "nowrap" }}>{c.label}</th>)}</tr></thead><tbody>{logs.map((log) => (
      <tr key={log.id}>{columns.map((c) => <td key={String(c.key)} style={{ textAlign: c.align || "left", whiteSpace: "nowrap" }}>{cell(log, c.key)}</td>)}</tr>
    ))}</tbody></table></div>
  </>;
}

// 個別ログを取得して表示する（メイド個別／ユーザー個別で共通）。
function VisitLogPanel({ start, end, maidId, customerId, hideMaid, hideCustomer, exportName, serveMinutes }: { start: string; end: string; maidId?: string; customerId?: string; hideMaid?: boolean; hideCustomer?: boolean; exportName: string; serveMinutes?: number | null }) {
  const [logs, setLogs] = useState<MaidVisitLog[] | null>(null);
  const [error, setError] = useState("");
  const downloadCsv = (filename: string, rows: Array<Array<string | number>>) => {
    const safe = (value: string | number) => { const raw = String(value); const protectedValue = /^[=+\-@]/.test(raw) ? `'${raw}` : raw; return `"${protectedValue.replaceAll('"', '""')}"`; };
    const blob = new Blob(["﻿" + rows.map((row) => row.map(safe).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
  };
  useEffect(() => {
    if (!maidId && !customerId) { setLogs(null); return; }
    const controller = new AbortController();
    setLogs(null); setError("");
    const params = new URLSearchParams({ start, end });
    if (maidId) params.set("maidId", maidId);
    if (customerId) params.set("customerId", customerId);
    fetch(`/api/visit-logs?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "ご帰宅明細を取得できませんでした"); setLogs(body.logs || []); })
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "ご帰宅明細を取得できませんでした"); });
    return () => controller.abort();
  }, [start, end, maidId, customerId]);
  if (error) return <p className="error">{error}</p>;
  if (!maidId && !customerId) return <p className="muted">対象を選択してください</p>;
  if (!logs) return <p className="muted">読込中…</p>;
  return <VisitLogTable logs={logs} hideMaid={hideMaid} hideCustomer={hideCustomer} onExport={downloadCsv} exportName={exportName} serveMinutes={serveMinutes} />;
}

// 勤怠実績: 全行表示・列ソート・メイド/状態フィルタ付き。遅刻分は小数点第3位以下切り捨て。
type AttendanceSortKey = "date" | "maid" | "worked" | "late";

function AttendanceTable({ shifts, maids }: { shifts: Shift[]; maids: Maid[] }) {
  const [maidFilter, setMaidFilter] = useState("");
  const [status, setStatus] = useState(""); // "" | late | ontime | unpunched
  const [sortKey, setSortKey] = useState<AttendanceSortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const rows = useMemo(() => {
    const named = shifts.map((s) => {
      const lateMinutes = s.actualStart ? Math.max(0, (new Date(s.actualStart).getTime() - new Date(s.scheduledStart).getTime()) / 60000) : 0;
      const workedHours = s.actualStart && s.actualEnd ? (new Date(s.actualEnd).getTime() - new Date(s.actualStart).getTime()) / 3600000 : 0;
      return { shift: s, maidName: maids.find((m) => m.id === s.maidId)?.name || "—", lateMinutes, workedHours, unpunched: !s.actualStart || !s.actualEnd };
    });
    const filtered = named.filter((r) => {
      if (maidFilter && r.shift.maidId !== maidFilter) return false;
      if (status === "late") return r.lateMinutes > 0;
      if (status === "ontime") return r.lateMinutes === 0 && !r.unpunched;
      if (status === "unpunched") return r.unpunched;
      return true;
    });
    const direction = sortDir === "asc" ? 1 : -1;
    return filtered.sort((a, b) => {
      if (sortKey === "maid") return a.maidName.localeCompare(b.maidName, "ja") * direction;
      if (sortKey === "worked") return (a.workedHours - b.workedHours) * direction;
      if (sortKey === "late") return (a.lateMinutes - b.lateMinutes) * direction;
      return a.shift.scheduledStart.localeCompare(b.shift.scheduledStart) * direction;
    });
  }, [shifts, maids, maidFilter, status, sortKey, sortDir]);

  const toggleSort = (key: AttendanceSortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir(key === "maid" ? "asc" : "desc"); }
  };
  const arrow = (key: AttendanceSortKey) => (sortKey === key ? (sortDir === "desc" ? " ▼" : " ▲") : "");
  const time = (value: string) => new Date(value).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
  const sortableTh = (key: AttendanceSortKey, label: string) => (
    <th onClick={() => toggleSort(key)} title="クリックで並び替え" style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", color: sortKey === key ? "#ef5da8" : undefined }}>{label}{arrow(key)}</th>
  );

  return <section className="panel table-panel">
    <div className="panel-head">
      <div><p className="eyebrow">ATTENDANCE</p><h2>勤怠実績</h2><small>{number.format(rows.length)}件・遅刻は小数点第3位以下切り捨て</small></div>
    </div>
    <div className="table-filters">
      <label>メイド<select value={maidFilter} onChange={(e) => setMaidFilter(e.target.value)}><option value="">すべて</option>{maids.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <label>状態<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">すべて</option><option value="late">遅刻のみ</option><option value="ontime">定時のみ</option><option value="unpunched">未打刻あり</option></select></label>
      {(maidFilter || status) && <button className="secondary" onClick={() => { setMaidFilter(""); setStatus(""); }}>条件をクリア</button>}
    </div>
    {rows.length === 0 ? <p className="muted">条件に一致するシフトがありません</p> :
    <div className="table-scroll tall"><table className="freeze-head"><thead><tr>
      {sortableTh("date", "日付")}{sortableTh("maid", "メイド")}<th>予定</th><th>実績</th>{sortableTh("worked", "実働")}{sortableTh("late", "遅刻")}
    </tr></thead><tbody>{rows.map(({ shift: s, maidName, lateMinutes, workedHours }) => (
      <tr key={s.id}>
        <td style={{ whiteSpace: "nowrap" }}>{new Date(s.scheduledStart).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}</td>
        <td style={{ whiteSpace: "nowrap" }}><b>{maidName}</b></td>
        <td style={{ whiteSpace: "nowrap" }}>{time(s.scheduledStart)}–{time(s.scheduledEnd)}</td>
        <td style={{ whiteSpace: "nowrap" }}>{s.actualStart ? time(s.actualStart) : "未打刻"}–{s.actualEnd ? time(s.actualEnd) : "未打刻"}</td>
        <td>{workedHours.toFixed(1)}h</td>
        <td><span className={lateMinutes ? "late" : "ok"}>{lateMinutes ? `${truncate2(lateMinutes)}分` : "定時"}</span></td>
      </tr>
    ))}</tbody></table></div>}
  </section>;
}

type CustomerCol = { key: keyof Customer; label: string; kind: "text" | "num" | "money" | "date" | "gender" | "year" };

// ユーザーDBの列。すべて users ドキュメント由来の通算値で、上部の期間フィルタには依存しない。
const CUSTOMER_DB_COLUMNS: CustomerCol[] = [
  { key: "name", label: "ユーザー名", kind: "text" },
  { key: "rank", label: "ランク", kind: "text" },
  { key: "gender", label: "性別", kind: "gender" },
  { key: "birthYear", label: "生年", kind: "year" },
  { key: "registeredAt", label: "登録日", kind: "date" },
  { key: "lastVisitAt", label: "最終ご帰宅日", kind: "date" },
  { key: "totalVisitAmount", label: "累計ご帰宅", kind: "num" },
  { key: "maxConsecutiveVisitDays", label: "最大連続日数", kind: "num" },
  { key: "paymentCount", label: "課金回数(通算)", kind: "num" },
  { key: "paymentAmount", label: "課金額(通算)", kind: "money" },
  { key: "lastPaymentAt", label: "最終課金日", kind: "date" },
  { key: "purchasedItemQuantity", label: "アイテム購入数", kind: "num" },
  { key: "purchasedItemCoin", label: "アイテム購入額(コイン)", kind: "num" },
  { key: "lastPurchasedItemAt", label: "最終アイテム購入日", kind: "date" },
  { key: "presentAmount", label: "プレゼント回数", kind: "num" },
  { key: "lastPresentAt", label: "最終プレゼント日", kind: "date" },
  { key: "coin", label: "コイン残高", kind: "num" },
  { key: "rewardPoint", label: "リワードP残高", kind: "num" },
];

const SORTABLE_DB_KEYS = new Set<string>(["registeredAt", "name", "rank", "gender", "birthYear", "lastVisitAt", "lastPaymentAt", "lastPurchasedItemAt", "lastPresentAt", "purchasedItemCoin", "purchasedItemQuantity", "presentAmount", "coin", "rewardPoint", "totalVisitAmount", "maxConsecutiveVisitDays", "paymentCount", "paymentAmount"]);

// 数値範囲で絞り込める指標（サーバー側 CUSTOMER_NUMERIC_KEYS と対応）。よく使う順に並べる。
const NUMERIC_FILTER_COLUMNS = ["totalVisitAmount", "paymentAmount", "paymentCount", "maxConsecutiveVisitDays", "purchasedItemQuantity", "purchasedItemCoin", "presentAmount", "coin", "rewardPoint", "birthYear"]
  .map((key) => CUSTOMER_DB_COLUMNS.find((c) => String(c.key) === key))
  .filter((c): c is NonNullable<typeof c> => Boolean(c));

type NumericFilterChip = { key: string; min: string; max: string };

function CustomerDatabase({ onExport }: { onExport: (name: string, data: Array<Array<string | number>>) => void }) {
  const [query, setQuery] = useState("");
  const [rank, setRank] = useState("");
  const [gender, setGender] = useState("");
  const [paying, setPaying] = useState("");
  const [regFrom, setRegFrom] = useState("");
  const [regTo, setRegTo] = useState("");
  // 数値指標の範囲フィルタ（確定分のチップ＋編集中の1行）。
  const [numFilters, setNumFilters] = useState<NumericFilterChip[]>([]);
  const [nfKey, setNfKey] = useState(String(NUMERIC_FILTER_COLUMNS[0]?.key || "totalVisitAmount"));
  const [nfMin, setNfMin] = useState("");
  const [nfMax, setNfMax] = useState("");
  // 既定は登録日の古い順（会員の起点から）。
  const [sortKey, setSortKey] = useState("registeredAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [result, setResult] = useState<{ total: number; returned: number; customers: Customer[] } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Customer | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const params = new URLSearchParams({ sort: sortKey, dir: sortDir, limit: "2000" });
        if (query.trim()) params.set("q", query.trim());
        if (rank) params.set("rank", rank);
        if (gender) params.set("gender", gender);
        if (paying) params.set("paying", paying);
        if (regFrom) params.set("regFrom", regFrom);
        if (regTo) params.set("regTo", regTo);
        for (const f of numFilters) {
          if (f.min !== "") params.set(`min_${f.key}`, f.min);
          if (f.max !== "") params.set(`max_${f.key}`, f.max);
        }
        const response = await fetch(`/api/customers?${params}`, { signal: controller.signal, cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "ユーザー一覧を取得できませんでした");
        setResult(body);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "ユーザー一覧を取得できませんでした"); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, rank, gender, paying, regFrom, regTo, numFilters, sortKey, sortDir]);

  const rows = result?.customers || [];
  // 選択肢は取得したユーザー自身から作る（期間フィルタ由来のデータに依存させない）。
  const genders = useMemo(() => [...new Set(rows.map((r) => r.gender).filter(Boolean))].sort() as string[], [rows]);
  const ranks = useMemo(() => [...new Set(rows.map((r) => r.rank).filter(Boolean))].sort(), [rows]);
  const toggleSort = (key: string) => {
    if (!SORTABLE_DB_KEYS.has(key)) return;
    if (key === sortKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir(key === "registeredAt" ? "asc" : "desc"); }
  };
  const cell = (row: Customer, c: CustomerCol) => {
    const value = row[c.key];
    if (c.kind === "gender") return genderLabel(String(value ?? ""));
    if (c.kind === "year") return Number(value) ? String(Number(value)) : "—";
    if (c.kind === "money") return yen.format(Number(value) || 0);
    if (c.kind === "num") return Number(value) ? number.format(Number(value)) : "—";
    if (c.kind === "date") return value ? jstDate(String(value)) : "—";
    return String(value ?? "—");
  };
  const clearFilters = () => { setQuery(""); setRank(""); setGender(""); setPaying(""); setRegFrom(""); setRegTo(""); setNumFilters([]); setNfMin(""); setNfMax(""); };
  const hasFilter = Boolean(query || rank || gender || paying || regFrom || regTo || numFilters.length);
  const numericLabel = (key: string) => NUMERIC_FILTER_COLUMNS.find((c) => String(c.key) === key)?.label || key;
  const addNumericFilter = () => {
    if (nfMin === "" && nfMax === "") return;
    // 同じ指標は上書き（1指標につき1つの範囲）。
    setNumFilters((prev) => [...prev.filter((f) => f.key !== nfKey), { key: nfKey, min: nfMin, max: nfMax }]);
    setNfMin(""); setNfMax("");
  };
  const rightAligned = (c: CustomerCol) => c.kind === "num" || c.kind === "money" || c.kind === "year";

  return <>
    <section className="panel table-panel">
      <div className="panel-head">
        <div><p className="eyebrow">CUSTOMER DATABASE</p><h2>ユーザーデータベース</h2><small>{result ? `${number.format(result.total)}名中 ${number.format(rows.length)}名を表示` : "読込中"}・全会員の累計値（登録時からの通算。期間指定なし）</small></div>
        <button className="secondary" disabled={!rows.length} onClick={() => onExport(`users_all.csv`, [["会員ID", ...CUSTOMER_DB_COLUMNS.map((c) => c.label)], ...rows.map((r) => [r.id, ...CUSTOMER_DB_COLUMNS.map((c) => (c.kind === "date" ? (r[c.key] ? jstDate(String(r[c.key])) : "") : c.kind === "gender" ? genderLabel(String(r[c.key] ?? "")) : String(r[c.key] ?? "")))])])}>CSV出力</button>
      </div>
      <div className="table-filters">
        <label>検索<input className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="⌕ 名前・会員ID" /></label>
        <label>ランク<select value={rank} onChange={(e) => setRank(e.target.value)}><option value="">すべて</option>{ranks.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
        <label>性別<select value={gender} onChange={(e) => setGender(e.target.value)}><option value="">すべて</option>{genders.map((g) => <option key={g} value={g}>{genderLabel(g)}</option>)}</select></label>
        <label>課金<select value={paying} onChange={(e) => setPaying(e.target.value)}><option value="">すべて</option><option value="yes">課金あり</option><option value="no">課金なし</option></select></label>
        <label>登録日(から)<input type="date" value={regFrom} onChange={(e) => setRegFrom(e.target.value)} /></label>
        <label>登録日(まで)<input type="date" value={regTo} onChange={(e) => setRegTo(e.target.value)} /></label>
        {hasFilter && <button className="secondary" onClick={clearFilters}>条件をクリア</button>}
      </div>
      <div className="table-filters">
        <label>数値で絞り込み<select value={nfKey} onChange={(e) => setNfKey(e.target.value)}>{NUMERIC_FILTER_COLUMNS.map((c) => <option key={String(c.key)} value={String(c.key)}>{c.label}</option>)}</select></label>
        <label>以上<input type="number" inputMode="numeric" style={{ width: "7rem" }} value={nfMin} onChange={(e) => setNfMin(e.target.value)} placeholder="下限" /></label>
        <label>以下<input type="number" inputMode="numeric" style={{ width: "7rem" }} value={nfMax} onChange={(e) => setNfMax(e.target.value)} placeholder="上限" /></label>
        <button className="secondary" onClick={addNumericFilter} disabled={nfMin === "" && nfMax === ""}>この条件で絞り込む</button>
        {numFilters.map((f) => (
          <button key={f.key} className="secondary" title="クリックで解除" onClick={() => setNumFilters((prev) => prev.filter((x) => x.key !== f.key))}>
            {numericLabel(f.key)} {f.min !== "" ? `${number.format(Number(f.min))}以上` : ""}{f.min !== "" && f.max !== "" ? "・" : ""}{f.max !== "" ? `${number.format(Number(f.max))}以下` : ""} ✕
          </button>
        ))}
      </div>
      {error ? <p className="error">{error}</p> : loading && !result ? <p className="muted">読込中…</p> : rows.length === 0 ? <p className="muted">条件に一致するユーザーがいません</p> :
      <div className="table-scroll tall"><table className="freeze-col freeze-head"><thead><tr>{CUSTOMER_DB_COLUMNS.map((c) => (
        <th key={String(c.key)} onClick={() => toggleSort(String(c.key))} title={SORTABLE_DB_KEYS.has(String(c.key)) ? "クリックで並び替え" : undefined} style={{ cursor: SORTABLE_DB_KEYS.has(String(c.key)) ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap", textAlign: rightAligned(c) ? "right" : "left", color: sortKey === c.key ? "#ef5da8" : undefined }}>{c.label}{sortKey === c.key ? (sortDir === "desc" ? " ▼" : " ▲") : ""}</th>
      ))}</tr></thead><tbody>{rows.map((row) => (
        <tr key={row.id} onClick={() => setSelected(row)} style={{ cursor: "pointer" }} title="クリックで個別のご帰宅明細を表示">{CUSTOMER_DB_COLUMNS.map((c) => (
          <td key={String(c.key)} style={{ whiteSpace: "nowrap", textAlign: rightAligned(c) ? "right" : "left" }}>
            {c.key === "name" ? <><b>{row.name}</b><small className="id">{row.id}</small></> : c.key === "rank" ? <span className={`text-rank ${row.rank}`}>{row.rank}</span> : cell(row, c)}
          </td>
        ))}</tr>
      ))}</tbody></table></div>}
    </section>
    {selected && <CustomerDetail customer={selected} onClose={() => setSelected(null)} />}
  </>;
}

// ユーザー個別のドリルダウン（プロフィール＋ご帰宅明細）。既定は直近365日。
function CustomerDetail({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
  const yearAgo = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date(Date.now() - 364 * 86400000));
  const [start, setStart] = useState(yearAgo);
  const [end, setEnd] = useState(today);
  const facts: Array<[string, string]> = [
    ["ランク", customer.rank],
    ["性別", genderLabel(String(customer.gender ?? ""))],
    ["登録日", customer.registeredAt ? jstDate(customer.registeredAt) : "—"],
    ["最終ご帰宅", customer.lastVisitAt ? jstDate(customer.lastVisitAt) : "—"],
    ["累計ご帰宅", customer.totalVisitAmount ? `${number.format(customer.totalVisitAmount)}回` : "—"],
    ["課金(通算)", customer.paymentCount ? `${number.format(customer.paymentCount)}回 / ${yen.format(customer.paymentAmount || 0)}` : "—"],
    ["最終課金日", customer.lastPaymentAt ? jstDate(customer.lastPaymentAt) : "—"],
    ["アイテム購入", customer.purchasedItemQuantity ? `${number.format(customer.purchasedItemQuantity)}点 / ${number.format(customer.purchasedItemCoin || 0)}コイン` : "—"],
    ["プレゼント", customer.presentAmount ? `${number.format(customer.presentAmount)}回` : "—"],
    ["残高", `${number.format(customer.coin || 0)}コイン / ${number.format(customer.rewardPoint || 0)}RP`],
  ];
  return <section className="panel table-panel detail-panel">
    <div className="panel-head">
      <div><p className="eyebrow">USER DETAIL</p><h2>{customer.name}</h2><small className="id">{customer.id}</small></div>
      <div style={{ display: "flex", gap: ".6rem", alignItems: "end" }}>
        <label>開始日<input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} /></label>
        <label>終了日<input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></label>
        <button className="secondary" onClick={onClose}>閉じる</button>
      </div>
    </div>
    <div className="fact-grid">{facts.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <VisitLogPanel start={start} end={end} customerId={customer.id} hideCustomer exportName={`user-log_${customer.id}_${start}_${end}.csv`} />
  </section>;
}

function CrossMatrix({ maids, customers, counts, onExport }: { maids: Array<{ id: string; name: string }>; customers: CustomerRow[]; counts: Map<string, number>; onExport: (name: string, data: Array<Array<string | number>>) => void }) {
  const [maidLimit, setMaidLimit] = useState(10);
  const [userLimit, setUserLimit] = useState(20);
  const [query, setQuery] = useState("");

  // ご帰宅数の多いメイド/ユーザーに絞って表示し、横スクロール量を抑える。
  const maidTotals = useMemo(() => {
    const totals = new Map<string, number>();
    counts.forEach((count, key) => { const maidId = key.split("|")[1]; totals.set(maidId, (totals.get(maidId) || 0) + count); });
    return totals;
  }, [counts]);
  const shownMaids = useMemo(() => [...maids].sort((a, b) => (maidTotals.get(b.id) || 0) - (maidTotals.get(a.id) || 0)).slice(0, maidLimit), [maids, maidTotals, maidLimit]);
  const shownCustomers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, userLimit);
  }, [customers, query, userLimit]);
  const max = useMemo(() => Math.max(1, ...[...counts.values()]), [counts]);
  const at = (customerId: string, maidId: string) => counts.get(`${customerId}|${maidId}`) || 0;

  return <section className="panel table-panel">
    <div className="panel-head">
      <div><p className="eyebrow">MAID × CUSTOMER</p><h2>ご帰宅クロス分析</h2><small>上位{shownMaids.length}メイド × 上位{shownCustomers.length}ユーザー・濃いセルほどご帰宅が多い（見出しと1列目は固定）</small></div>
      <button className="secondary" onClick={() => onExport("maid-customer-cross.csv", [["ユーザー", ...shownMaids.map((m) => m.name), "合計"], ...shownCustomers.map((c) => [c.name, ...shownMaids.map((m) => at(c.id, m.id)), c.visits])])}>CSV出力</button>
    </div>
    <div className="table-filters">
      <label>ユーザー検索<input className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="⌕ 名前" /></label>
      <label>メイド表示数<select value={maidLimit} onChange={(e) => setMaidLimit(Number(e.target.value))}>{[5, 10, 20, 50, 999].map((n) => <option key={n} value={n}>{n === 999 ? "すべて" : `上位${n}`}</option>)}</select></label>
      <label>ユーザー表示数<select value={userLimit} onChange={(e) => setUserLimit(Number(e.target.value))}>{[10, 20, 50, 100, 9999].map((n) => <option key={n} value={n}>{n === 9999 ? "すべて" : `上位${n}`}</option>)}</select></label>
    </div>
    {shownCustomers.length === 0 || shownMaids.length === 0 ? <p className="muted">表示できるデータがありません</p> :
    <div className="table-scroll tall"><table className="matrix freeze-col freeze-head"><thead><tr><th>ユーザー</th>{shownMaids.map((m) => <th key={m.id}>{m.name}</th>)}<th>合計</th></tr></thead><tbody>{shownCustomers.map((c) => (
      <tr key={c.id}><td><b>{c.name}</b></td>{shownMaids.map((m) => { const n = at(c.id, m.id); return <td key={m.id} title={n ? `${c.name} → ${m.name}: ${n}回` : undefined} style={n ? { background: `rgba(191,154,216,${(0.12 + Math.min(n / max, 1) * 0.55).toFixed(3)})`, color: "#4a3357", fontWeight: 700 } : undefined}>{n || "—"}</td>; })}<td><b>{c.visits}</b></td></tr>
    ))}</tbody></table></div>}
  </section>;
}

function GrowthPanel({ growth, loading, error }: { growth: GrowthMetrics | null; loading: boolean; error: string }) {
  if (error) return <section className="panel"><p className="error">{error}</p></section>;
  if (!growth) return <section className="panel"><p className="muted">読込中…</p></section>;
  const dauPoints = growth.daily.map((d) => ({ label: d.label, visits: d.dau }));
  const defs: Array<{ term: string; body: string }> = [
    { term: "DAU / WAU / MAU（平均・ピーク）", body: "各営業日／週（月曜始まり）／暦月にご帰宅したユニークユーザー数。営業日は19:00〜翌2:00（0:00〜1:59は前日扱い）。平均は期間内の各バケットの平均、ピークは最大値。" },
    { term: "定着率（DAU/MAU）", body: "平均DAU ÷ 平均MAU。月内でどれだけ高頻度に再訪しているかの粘着度（高いほど毎日使われている）。" },
    { term: "新規登録者数", body: "選択期間内に会員登録（registrationDate）したユーザーの人数。" },
    { term: "新規課金転換率", body: "期間内の新規登録者のうち、期間内に1回以上の有料ご帰宅（予約を含む）をした人の割合。" },
    { term: "離脱率", body: "直前の同じ長さの期間にご帰宅があったユーザーのうち、当期間に一度もご帰宅しなかった人の割合。" },
    { term: "占有率 / 空席率", body: "同時に最大3名着席可・1枠20分のため、メイド1時間の稼働=最大9名分。全メイドの合計お給仕時間×9を最大利用可能枠とし、重み付きご帰宅数（滞在20分=1枠）が占める割合が占有率、空いている割合が空席率。" },
  ];
  return <>
    <p className="eyebrow" style={{ margin: "14px 2px 2px" }}>ACTIVE USERS ・ アクティブユーザー</p>
    <section className="metrics">
      <Metric label="1日あたり利用者数(平均)" value={`${number.format(growth.avgDau)}名`} note={`最も多い日 ${number.format(growth.peakDau)}名`} tone="blue" hint="DAU＝その営業日に1回以上ご帰宅したユーザーの実人数（同じ人が何回来ても1名）。『平均』は期間中の1日平均、『最も多い日』は期間中の最大値です。" />
      <Metric label="1週あたり利用者数(平均)" value={`${number.format(growth.avgWau)}名`} note={`最も多い週 ${number.format(growth.peakWau)}名`} tone="purple" hint="WAU＝その週(月曜〜日曜)に1回以上ご帰宅したユーザーの実人数。週内に何回来ても1名です。" />
      <Metric label="1か月あたり利用者数(平均)" value={`${number.format(growth.avgMau)}名`} note={`最も多い月 ${number.format(growth.peakMau)}名`} tone="pink" hint="MAU＝その暦月に1回以上ご帰宅したユーザーの実人数。月内に何回来ても1名です。" />
      <Metric label="定着率 (DAU÷MAU)" value={pct(growth.stickiness)} note="月の利用者のうち毎日来ている割合" tone="orange" hint="平均DAU ÷ 平均MAU。100%に近いほど『月に来る人が毎日来ている』、低いほど『たまにしか来ない』ことを表します。" />
    </section>
    <p className="eyebrow" style={{ margin: "14px 2px 2px" }}>ACQUISITION & OCCUPANCY ・ 獲得 / 継続 / 座席</p>
    <section className="metrics">
      <Metric label="新規登録者数" value={`${number.format(growth.newRegistrations)}名`} note="期間内に会員登録" tone="pink" />
      <Metric label="新規課金転換率" value={pct(growth.newPaidConversionRate)} note={`${number.format(growth.newPaidConversions)}/${number.format(growth.newRegistrations)}名が有料化`} tone="purple" />
      <Metric label="離脱率" value={pct(growth.churnRate)} note={`前期${number.format(growth.prevActiveUsers)}名中${number.format(growth.churnedUsers)}名が未ご帰宅`} tone="orange" />
      <Metric label="空席率" value={pct(growth.vacancyRate)} note={`占有率 ${pct(growth.occupancyRate)}・お給仕${number.format(Math.round(growth.workHours))}h`} tone="blue" />
    </section>
    <section className="grid-2">
      <article className="panel"><div className="panel-head"><div><p className="eyebrow">DAILY ACTIVE USERS</p><h2>DAUの推移</h2></div><span className="badge">{loading ? "更新中" : "営業日"}</span></div><LineChart points={dauPoints} suffix="名" ariaLabel="DAUの推移" /></article>
      <article className="panel"><div className="panel-head"><div><p className="eyebrow">DEFINITIONS</p><h2>指標の定義</h2><small>前期間 {growth.prevStart}〜{growth.prevEnd} と比較</small></div></div><dl className="def-list">{defs.map((d) => <div key={d.term}><dt>{d.term}</dt><dd>{d.body}</dd></div>)}</dl></article>
    </section>
  </>;
}

export default function Dashboard({ initialData, initialStart, initialEnd, viewer }: { initialData: ViewerScopedData; initialStart: string; initialEnd: string; viewer: Viewer }) {
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
  const crossCounts = useMemo(() => {
    const map = new Map<string, number>();
    data.visits.forEach((v) => { const key = `${v.customerId}|${v.maidId}`; map.set(key, (map.get(key) || 0) + 1); });
    return map;
  }, [data.visits]);
  const knownRankOrder = ["プラチナ", "ゴールド", "シルバー", "ブロンズ", "未設定"];
  const visibleRanks = [...new Set(customerStats.map((customer) => customer.rank))].sort((a, b) => {
    const aIndex = knownRankOrder.indexOf(a); const bIndex = knownRankOrder.indexOf(b);
    return (aIndex < 0 ? 999 : aIndex) - (bIndex < 0 ? 999 : bIndex) || a.localeCompare(b, "ja");
  });
  const presets = (days: number) => { const e = new Date(`${initialEnd}T12:00:00+09:00`); const s = new Date(e); s.setDate(e.getDate() - days + 1); setStart(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(s)); setEnd(initialEnd); };
  const downloadCsv = (filename: string, rows: Array<Array<string | number>>) => {
    const safe = (value: string | number) => { const raw = String(value); const protectedValue = /^[=+\-@]/.test(raw) ? `'${raw}` : raw; return `"${protectedValue.replaceAll('"', '""')}"`; };
    const blob = new Blob(["\uFEFF" + rows.map((row) => row.map(safe).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
  };

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
      <div className="freshness"><span className="status-dot"/> 最終同期 {new Date(remoteData.generatedAt).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})} <b>・分析用データ</b>{loading && " ・読込中"}{loadError && <span className="error-inline"> ・{loadError}</span>}</div>

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
