"use client";

import { useEffect, useMemo, useState } from "react";
import type { MaidMonthlyReport, MaidReportsResult, Viewer } from "@/lib/types";
import { toCsv } from "@/lib/csv";
import { number, truncate2, yen } from "../shared/format";

// 本番 maidWorkReport の月次実績。
type ReportRow = MaidMonthlyReport & { averageVisit: number; photoPrice: number };

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

export default function MaidReports({ viewer }: { viewer: Viewer }) {
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
