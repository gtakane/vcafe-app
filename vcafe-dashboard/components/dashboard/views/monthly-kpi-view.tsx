"use client";

import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { EDITABLE_KEYS, KPI_COLUMNS, kpiCsv, parseKpiInput, type KpiCell, type KpiColumn, type KpiRow } from "@/lib/monthly-kpi";
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

/** 入力欄に最初に入れておく文字（今の値）。 */
function draftOf(column: KpiColumn, value: number | string | null): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (column.format === "pct") return `${(value * 100).toFixed(2)}%`;
  return value.toLocaleString("ja-JP", { maximumFractionDigits: 4 });
}

function Cell({ column, cell, onEdit }: { column: KpiColumn; cell: KpiCell; onEdit?: () => void }) {
  const editable = Boolean(onEdit);
  const original = cell.original == null || cell.original === "" ? "なし" : formatValue(column, cell.original);
  const recomputed = cell.recomputed == null || cell.recomputed === "" ? null : formatValue(column, cell.recomputed);
  const title = [
    cell.source === "csv" ? "運営のCSVの値" : cell.source === "manual" ? `手入力の値（上書き前: ${original}）` : cell.source === "auto" ? "データから自動で算出" : cell.source === "derived" ? (cell.note || "CSVの値から計算") : "",
    cell.differs && recomputed ? `データから出し直すと ${recomputed}` : "",
    cell.provisional && cell.source !== "derived" ? `暫定: ${cell.note || ""}` : cell.provisional ? "暫定（売上が暫定）" : "",
    editable ? "クリックで手入力" : "",
  ].filter(Boolean).join("\n");
  const className = `${column.format === "text" ? "kpi-text" : "kpi-num"} ${cell.source}${editable ? " kpi-editable" : ""}`;
  if (column.key === "url" && typeof cell.value === "string" && cell.value) {
    return <td className={className} title={title || undefined} onClick={onEdit}>{cell.value.split(/\s+/).filter(Boolean).map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{url.replace(/^https?:\/\/[^/]+/, "")}</a>)}</td>;
  }
  return <td className={className} title={title || undefined} onClick={onEdit}>
    {formatValue(column, cell.value)}
    {cell.differs && <sup className="kpi-diff" aria-label="CSVとデータの値が違う">≠</sup>}
    {cell.provisional && <small className="kpi-provisional">暫定</small>}
  </td>;
}

/** セルの中の入力欄。Enterで保存（文章の列はShift+Enterで改行）、Escで取消。 */
function EditCell({ column, cell, month, onDone, onCancel }: { column: KpiColumn; cell: KpiCell; month: string; onDone: () => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(() => draftOf(column, cell.value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async (value: string) => {
    const parsed = parseKpiInput(column, value);
    if (!parsed.ok) { setError(parsed.error); return; }
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/monthly-kpi", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Vcafe-Request": "monthly-kpi" },
        body: JSON.stringify({ month, field: column.key, value }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "保存できませんでした");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
      setSaving(false);
    }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void save(draft); };
  const keyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); onCancel(); }
    if (event.key === "Enter" && column.format === "text" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void save(draft); }
  };
  const field = column.format === "text"
    ? <textarea autoFocus rows={3} value={draft} disabled={saving} onChange={(e) => setDraft(e.target.value)} onKeyDown={keyDown} />
    : <input autoFocus inputMode={column.format === "pct" ? "decimal" : "numeric"} value={draft} disabled={saving} onChange={(e) => setDraft(e.target.value)} onKeyDown={keyDown} onFocus={(e) => e.target.select()} />;
  return <td className="kpi-editing">
    <form onSubmit={submit}>
      {field}
      <div className="kpi-edit-actions">
        <button type="submit" disabled={saving}>{saving ? "保存中…" : "保存"}</button>
        <button type="button" className="secondary" disabled={saving} onClick={onCancel}>取消</button>
        {cell.source === "manual" && <button type="button" className="secondary" disabled={saving} onClick={() => void save("")} title="手入力を消して、CSV・データの値に戻します">手入力を消す</button>}
      </div>
      {column.format === "pct" && <small className="muted">69% または 0.69</small>}
      {error && <small className="error">{error}</small>}
    </form>
  </td>;
}

// 月次指標。運営が毎月作っていたCSVと同じ項目を、月ごとに1行で並べる。
export default function MonthlyKpiView({ onExport }: { onExport: (name: string, data: Array<Array<string | number>>) => void }) {
  const includeTestUsers = useIncludeTestUsers();
  const [data, setData] = useState<(MonthlyKpiResult & { cachedAt?: string }) | null>(null);
  // n が変わるたびに読み直す。refresh=true は集計からやり直す（「最新にする」）、false は手入力の値だけ読み直す（保存後）。
  const [request, setRequest] = useState({ n: 0, refresh: false });
  const [editing, setEditing] = useState<{ month: string; key: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const params = withTestUsers(new URLSearchParams(), includeTestUsers);
    if (request.refresh) params.set("refresh", "1");
    fetch(`/api/monthly-kpi?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "月次指標を取得できませんでした"); setData(body); })
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "月次指標を取得できませんでした"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [includeTestUsers, request]);

  const rows: KpiRow[] = data?.rows ?? [];
  return <>
    <section className="panel table-panel">
      <div className="panel-head">
        <div><p className="eyebrow">MONTHLY KPI</p><h2>月次指標</h2>
          <small>{data?.historyCutoff ? `${data.historyCutoff.replace("-", "年")}月以前は運営のCSVの値、それより後はデータから自動で算出` : "データから自動で算出"}。セルをクリックすると手入力できます・{includeTestUsers ? "テストユーザーを含む" : "テストユーザーを除く"}</small>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {data?.cachedAt && <small className="muted">{new Date(data.cachedAt).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" })} 時点</small>}
          {notice && <small className="kpi-saved">{notice}</small>}
          <button className="secondary" disabled={loading} onClick={() => setRequest((r) => ({ n: r.n + 1, refresh: true }))} title="データの集計は10分間使い回しています（手入力の値は毎回読み直します）">最新にする</button>
          <button className="secondary" disabled={!rows.length} onClick={() => onExport(`monthly-kpi_${includeTestUsers ? "with-test-users" : "without-test-users"}.csv`, kpiCsv(rows))}>CSV出力（運営のCSVと同じ並び）</button>
        </div>
      </div>
      {data?.historyCutoff && <p className="kpi-legend">テストユーザーの切り替えで変わるのは、データから算出した値（{data.historyCutoff.replace("-", "年")}月より後の月と、CSVに無い項目）だけです。CSVの値は切り替えても変わらず、「≠」の比較相手だけが変わります。</p>}
      {data?.warnings?.length ? <ul className="kpi-warnings">{data.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
      <p className="kpi-legend"><sup className="kpi-diff">≠</sup> CSVの値と、データから出し直した値が違う（マウスを乗せると出し直した値）　<small className="kpi-provisional">暫定</small> 各社の報告額が未登録、または月の途中　<span className="kpi-manual-sample">金色の下線</span> 手入力の値</p>
      <p className="kpi-legend">セルをクリックして値を入力し、Enterで保存（Escで取消）。空にして保存するか「手入力を消す」で、CSV・データの値に戻ります。手入力の値はCSV・データより優先し、テストユーザーの切り替えに関係なく同じ値を表示します。比率（客単価・ARPPU・原価率など）は、入力した値から計算し直します。</p>
      {error ? <p className="error">{error}</p> : loading && !data ? <p className="muted">読込中…（数十秒かかることがあります）</p> :
      <div className="table-scroll kpi-scroll"><table className="kpi-table">
        <thead><tr><th className="kpi-sticky">年月</th>{KPI_COLUMNS.map((c, index) => <th key={`${c.key}-${index}`} title={c.definition} className={c.screenOnly ? "kpi-extra" : undefined}>{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((row) => <tr key={row.month}><th className="kpi-sticky">{row.month.replace("-", "/")}</th>{KPI_COLUMNS.map((c, index) => {
          const isEditing = editing?.month === row.month && editing.key === c.key;
          if (isEditing) return <EditCell key={`${c.key}-${index}`} column={c} cell={row.cells[c.key]} month={row.month}
            onCancel={() => setEditing(null)}
            onDone={() => { setEditing(null); setNotice(`${row.month.replace("-", "/")} の${c.label}を保存しました`); setRequest((r) => ({ n: r.n + 1, refresh: false })); }} />;
          return <Cell key={`${c.key}-${index}`} column={c} cell={row.cells[c.key]} onEdit={EDITABLE_KEYS.has(c.key) ? () => { setNotice(""); setEditing({ month: row.month, key: c.key }); } : undefined} />;
        })}</tr>)}</tbody>
      </table></div>}
    </section>
    <section className="panel">
      <div className="panel-head"><div><p className="eyebrow">DEFINITIONS</p><h2>各指標の定義</h2></div></div>
      <dl className="kpi-definitions">{KPI_COLUMNS.map((c, index) => <div key={`${c.key}-${index}`}><dt>{c.label}{c.screenOnly ? "（画面のみ）" : ""}</dt><dd>{c.definition}{c.appAggregated ? "。アプリが集計した値のため、テストユーザーの切り替えは効きません" : ""}</dd></div>)}</dl>
      <p className="muted" style={{ fontSize: 12 }}>月は営業日（毎日2:00区切り）でまとめます。会員数は月末時点です。2026年10月以前の月は運営のCSVの値をそのまま表示し、CSVに無い項目だけデータから補います。</p>
    </section>
  </>;
}
