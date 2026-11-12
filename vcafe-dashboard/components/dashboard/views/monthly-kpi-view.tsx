"use client";

import { useEffect, useState } from "react";
import { KPI_COLUMNS, kpiCsv, type KpiCell, type KpiColumn, type KpiRow } from "@/lib/monthly-kpi";
import type { MonthlyKpiResult } from "@/lib/monthly-kpi-loader";
import { number, yen } from "../shared/format";
import { useIncludeTestUsers, withTestUsers } from "../shared/test-user-scope";

const decimal = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 });

function formatValue(column: KpiColumn, value: number | string | null): string {
  if (value == null || value === "") return "—";
  if (typeof value === "string") return value;
  switch (column.format) {
    case "yen": return yen.format(value);
    case "count": return number.format(Math.round(value));
    case "pct": return `${(value * 100).toFixed(2)}%`;
    case "hours": return decimal.format(Math.round(value * 10) / 10);
    default: return decimal.format(value);
  }
}

function Cell({ column, cell }: { column: KpiColumn; cell: KpiCell }) {
  if (column.key === "url" && typeof cell.value === "string" && cell.value) {
    return <td className="kpi-text">{cell.value.split(/\s+/).filter(Boolean).map((url) => <a key={url} href={url} target="_blank" rel="noreferrer">{url.replace(/^https?:\/\/[^/]+/, "")}</a>)}</td>;
  }
  const text = formatValue(column, cell.value);
  const recomputed = cell.recomputed == null || cell.recomputed === "" ? null : formatValue(column, cell.recomputed);
  const title = [
    cell.source === "csv" ? "運営のCSVの値" : cell.source === "manual" ? "手入力の値" : cell.source === "auto" ? "データから自動で算出" : cell.source === "derived" ? (cell.note || "CSVの値から計算") : "",
    cell.differs && recomputed ? `データから出し直すと ${recomputed}` : "",
    cell.provisional && cell.source !== "derived" ? `暫定: ${cell.note || ""}` : cell.provisional ? "暫定（売上が暫定）" : "",
  ].filter(Boolean).join("\n");
  return <td className={`${column.format === "text" ? "kpi-text" : "kpi-num"} ${cell.source}`} title={title || undefined}>
    {text}
    {cell.differs && <sup className="kpi-diff" aria-label="CSVとデータの値が違う">≠</sup>}
    {cell.provisional && <small className="kpi-provisional">暫定</small>}
  </td>;
}

// 月次指標。運営が毎月作っていたCSVと同じ項目を、月ごとに1行で並べる。
export default function MonthlyKpiView({ onExport }: { onExport: (name: string, data: Array<Array<string | number>>) => void }) {
  const includeTestUsers = useIncludeTestUsers();
  const [data, setData] = useState<(MonthlyKpiResult & { cachedAt?: string }) | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const params = withTestUsers(new URLSearchParams(), includeTestUsers);
    if (reloadKey) params.set("refresh", "1");
    fetch(`/api/monthly-kpi?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "月次指標を取得できませんでした"); setData(body); })
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "月次指標を取得できませんでした"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [includeTestUsers, reloadKey]);

  const rows: KpiRow[] = data?.rows ?? [];
  return <>
    <section className="panel table-panel">
      <div className="panel-head">
        <div><p className="eyebrow">MONTHLY KPI</p><h2>月次指標</h2>
          <small>{data?.historyCutoff ? `${data.historyCutoff.replace("-", "年")}月以前は運営のCSVの値、それより後はデータから自動で算出（メイド報酬は手入力）` : "データから自動で算出（メイド報酬は手入力）"}・{includeTestUsers ? "テストユーザーを含む" : "テストユーザーを除く"}</small>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {data?.cachedAt && <small className="muted">{new Date(data.cachedAt).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" })} 時点</small>}
          <button className="secondary" disabled={loading} onClick={() => setReloadKey((k) => k + 1)} title="集計は10分間使い回しています。メイド報酬などを登録した直後はここで読み直してください">最新にする</button>
          <button className="secondary" disabled={!rows.length} onClick={() => onExport(`monthly-kpi_${includeTestUsers ? "with-test-users" : "without-test-users"}.csv`, kpiCsv(rows))}>CSV出力（運営のCSVと同じ並び）</button>
        </div>
      </div>
      {data?.historyCutoff && <p className="kpi-legend">テストユーザーの切り替えで変わるのは、データから算出した値（{data.historyCutoff.replace("-", "年")}月より後の月と、CSVに無い項目）だけです。CSVの値は切り替えても変わらず、「≠」の比較相手だけが変わります。</p>}
      {data?.warnings?.length ? <ul className="kpi-warnings">{data.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
      <p className="kpi-legend"><sup className="kpi-diff">≠</sup> CSVの値と、データから出し直した値が違う（マウスを乗せると出し直した値）　<small className="kpi-provisional">暫定</small> 各社の報告額が未登録、または月の途中</p>
      {error ? <p className="error">{error}</p> : loading && !data ? <p className="muted">読込中…（数十秒かかることがあります）</p> :
      <div className="table-scroll kpi-scroll"><table className="kpi-table">
        <thead><tr><th className="kpi-sticky">年月</th>{KPI_COLUMNS.map((c, index) => <th key={`${c.key}-${index}`} title={c.definition} className={c.screenOnly ? "kpi-extra" : undefined}>{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((row) => <tr key={row.month}><th className="kpi-sticky">{row.month.replace("-", "/")}</th>{KPI_COLUMNS.map((c, index) => <Cell key={`${c.key}-${index}`} column={c} cell={row.cells[c.key]} />)}</tr>)}</tbody>
      </table></div>}
    </section>
    <section className="panel">
      <div className="panel-head"><div><p className="eyebrow">DEFINITIONS</p><h2>各指標の定義</h2></div></div>
      <dl className="kpi-definitions">{KPI_COLUMNS.map((c, index) => <div key={`${c.key}-${index}`}><dt>{c.label}{c.screenOnly ? "（画面のみ）" : ""}</dt><dd>{c.definition}{c.appAggregated ? "。アプリが集計した値のため、テストユーザーの切り替えは効きません" : ""}</dd></div>)}</dl>
      <p className="muted" style={{ fontSize: 12 }}>月は営業日（毎日2:00区切り）でまとめます。会員数は月末時点です。2026年10月以前の月は運営のCSVの値をそのまま表示し、CSVに無い項目だけデータから補います。</p>
    </section>
  </>;
}
