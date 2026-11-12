"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Customer } from "@/lib/types";
import {
  CUSTOMER_FIELDS, displayValue, fieldOf, filterCustomers, jstDay, opsFor, sortCustomers,
  type CombineMode, type Condition, type ConditionOp, type CustomerRecord,
} from "@/lib/customer-query";
import { genderLabel, jstDate, number, yen } from "../shared/format";
import VisitLogPanel from "../visit-log/panel";

// ユーザーデータベース（全会員の通算値。上部の期間フィルタには依存しない）。
// 全会員を一度だけ読み込み、絞り込み・並び替えは画面側で即時に行う（lib/customer-query.ts）。

const ROW_HEIGHT = 46; // 1行の高さ(px)。表示中の行だけを描画する（数千行でもスクロールが重くならない）
const OVERSCAN = 12;
const DEFAULT_COLUMNS = ["name", "rank", "gender", "birthYear", "registeredAt", "lastVisitAt", "totalVisitAmount", "maxConsecutiveVisitDays", "paymentCount", "paymentAmount", "lastPaymentAt", "purchasedItemQuantity", "purchasedItemCoin", "lastPurchasedItemAt", "presentAmount", "lastPresentAt", "coinApple", "coinGoogle", "rewardPoint"];
const COLUMN_STORAGE_KEY = "vcafe.userdb.columns";

const FORMAT = { number: (n: number) => number.format(n), yen: (n: number) => yen.format(n), date: (iso: string) => jstDate(iso), gender: (g: string) => genderLabel(g) };
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
let conditionSeq = 0;
const newCondition = (field = "lastVisitAt", op: ConditionOp = "olderThanDays", a = "", b = ""): Condition => ({ id: `c${++conditionSeq}`, field, op, a, b });

// よく使う切り口。押すと条件が入る（あとから編集できる）。
const PRESETS: Array<{ label: string; mode: CombineMode; conditions: () => Condition[] }> = [
  { label: "休眠（最終ご帰宅が30日以上前）", mode: "and", conditions: () => [newCondition("lastVisitAt", "olderThanDays", "30")] },
  { label: "課金あり・60日以上ご帰宅なし", mode: "and", conditions: () => [newCondition("paying", "equals", "yes"), newCondition("lastVisitAt", "olderThanDays", "60")] },
  { label: "直近30日の新規登録", mode: "and", conditions: () => [newCondition("registeredAt", "withinDays", "30")] },
  { label: "直近30日に課金", mode: "and", conditions: () => [newCondition("lastPaymentAt", "withinDays", "30")] },
  { label: "未課金・累計ご帰宅10回以上", mode: "and", conditions: () => [newCondition("paying", "equals", "no"), newCondition("totalVisitAmount", "between", "10")] },
];

function loadColumns(): string[] {
  try {
    const saved = JSON.parse(window.localStorage.getItem(COLUMN_STORAGE_KEY) || "null");
    if (Array.isArray(saved) && saved.every((k) => typeof k === "string" && fieldOf(k))) return saved.length ? saved : DEFAULT_COLUMNS;
  } catch { /* 保存できない環境では既定の列 */ }
  return DEFAULT_COLUMNS;
}

export default function CustomerDatabase({ onExport }: { onExport: (name: string, data: Array<Array<string | number>>) => void }) {
  const [all, setAll] = useState<CustomerRecord[] | null>(null);
  const [cachedAt, setCachedAt] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState("");
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [mode, setMode] = useState<CombineMode>("and");
  const [sortKey, setSortKey] = useState("registeredAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [columns, setColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { setColumns(loadColumns()); }, []);
  useEffect(() => { try { window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(columns)); } catch { /* 無視 */ } }, [columns]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch(`/api/customers?all=1${reloadKey ? "&refresh=1" : ""}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "ユーザー一覧を取得できませんでした");
        setAll(body.customers as CustomerRecord[]);
        setCachedAt(body.cachedAt || "");
      })
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "ユーザー一覧を取得できませんでした"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reloadKey]);

  // 選択肢は全会員から作る（絞り込みで選択肢が消えないようにする）。
  const options = useMemo(() => ({
    rank: [...new Set((all || []).map((r) => r.rank).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja")),
    gender: [...new Set((all || []).map((r) => r.gender).filter(Boolean) as string[])].sort(),
  }), [all]);

  const rows = useMemo(() => {
    if (!all) return [];
    const filtered = filterCustomers(all, { search, conditions, mode, today: today() });
    return sortCustomers(filtered, sortKey, sortDir);
  }, [all, search, conditions, mode, sortKey, sortDir]);

  useEffect(() => {
    // 条件・並び替えが変わったら先頭に戻す。
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [search, conditions, mode, sortKey, sortDir]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => setViewport(element.clientHeight || 600);
    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [all]);

  const visibleFields = columns.map((key) => fieldOf(key)).filter((f): f is NonNullable<typeof f> => Boolean(f));
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);
  const windowRows = rows.slice(first, last);

  const toggleSort = (key: string) => {
    if (key === sortKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortKey(key);
      const kind = fieldOf(key)?.kind;
      // 数値・日付は「多い順・新しい順」から、文字・ランクは上から順に見たいことが多い。
      setSortDir(kind === "text" || key === "rank" || key === "registeredAt" ? "asc" : "desc");
    }
  };
  const updateCondition = (id: string, patch: Partial<Condition>) => setConditions((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const changeField = (id: string, field: string) => {
    const kind = fieldOf(field)?.kind ?? "text";
    updateCondition(id, { field, op: opsFor(kind)[0].op, a: "", b: "" });
  };
  const totalPayment = rows.reduce((sum, r) => sum + (Number(r.paymentAmount) || 0), 0);
  const rightAligned = (kind: string) => kind === "number" || kind === "money" || kind === "year";

  const exportCsv = () => onExport(`users_${today()}.csv`, [
    ["会員ID", ...visibleFields.map((f) => f.label)],
    ...rows.map((r) => [r.id, ...visibleFields.map((f) => (f.kind === "number" || f.kind === "money" ? Number((r as unknown as Record<string, unknown>)[f.key] ?? 0) || 0 : displayValue(r, f, { ...FORMAT, number: String, yen: String })))]),
  ]);

  const valueInputs = (c: Condition) => {
    const field = fieldOf(c.field);
    if (!field || c.op === "isEmpty" || c.op === "isNotEmpty") return null;
    if (field.kind === "text") return <input value={c.a || ""} onChange={(e) => updateCondition(c.id, { a: e.target.value })} placeholder="文字" />;
    if (field.kind === "select" || field.kind === "gender") {
      const values = field.kind === "select" ? options.rank : options.gender;
      return <select value={c.a || ""} onChange={(e) => updateCondition(c.id, { a: e.target.value })}><option value="">選択</option>{values.map((v) => <option key={v} value={v}>{field.kind === "gender" ? genderLabel(v) : v}</option>)}</select>;
    }
    if (field.kind === "boolean") return <select value={c.a || ""} onChange={(e) => updateCondition(c.id, { a: e.target.value })}><option value="">選択</option><option value="yes">あり</option><option value="no">なし</option></select>;
    if (field.kind === "date" && (c.op === "withinDays" || c.op === "olderThanDays")) return <><input type="number" min={0} value={c.a || ""} onChange={(e) => updateCondition(c.id, { a: e.target.value })} placeholder="日数" /><span className="muted">日</span></>;
    if (field.kind === "date") return <><input type="date" value={c.a || ""} onChange={(e) => updateCondition(c.id, { a: e.target.value })} /><span className="muted">〜</span><input type="date" value={c.b || ""} onChange={(e) => updateCondition(c.id, { b: e.target.value })} /></>;
    return <><input type="number" value={c.a || ""} onChange={(e) => updateCondition(c.id, { a: e.target.value })} placeholder="以上" /><span className="muted">〜</span><input type="number" value={c.b || ""} onChange={(e) => updateCondition(c.id, { b: e.target.value })} placeholder="以下" /></>;
  };

  return <>
    <section className="panel table-panel">
      <div className="panel-head">
        <div><p className="eyebrow">CUSTOMER DATABASE</p><h2>ユーザーデータベース</h2>
          <small>{all ? `${number.format(all.length)}名中 ${number.format(rows.length)}名が一致・課金額合計 ${yen.format(totalPayment)}` : "読込中"}・全会員の通算値（期間指定なし）{cachedAt ? `・${new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }).format(new Date(cachedAt))} 時点` : ""}</small></div>
        <div style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
          <details className="column-picker"><summary className="secondary">表示する列</summary><div className="column-picker-list">
            {CUSTOMER_FIELDS.map((f) => <label key={f.key}><input type="checkbox" checked={columns.includes(f.key)} disabled={f.key === "name"} onChange={(e) => setColumns((prev) => e.target.checked ? CUSTOMER_FIELDS.map((x) => x.key).filter((k) => prev.includes(k) || k === f.key) : prev.filter((k) => k !== f.key))} />{f.label}</label>)}
            <button className="secondary" onClick={() => setColumns(DEFAULT_COLUMNS)}>既定に戻す</button>
          </div></details>
          <button className="secondary" onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>最新を読み込む</button>
          <button className="secondary" disabled={!rows.length} onClick={exportCsv}>CSV出力</button>
        </div>
      </div>
      <div className="table-filters">
        <label>検索<input className="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="⌕ 名前・会員ID" /></label>
        <label>よく使う条件<select value="" onChange={(e) => { const p = PRESETS[Number(e.target.value)]; if (p) { setConditions(p.conditions()); setMode(p.mode); } }}><option value="">選んで入力</option>{PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}</select></label>
        {(search || conditions.length > 0) && <button className="secondary" onClick={() => { setSearch(""); setConditions([]); }}>条件をクリア</button>}
      </div>
      <div className="table-filters condition-builder">
        {conditions.length > 1 && <label>組み合わせ<select value={mode} onChange={(e) => setMode(e.target.value as CombineMode)}><option value="and">すべて満たす（かつ）</option><option value="or">いずれかを満たす（または）</option></select></label>}
        {conditions.map((c, index) => {
          const field = fieldOf(c.field);
          return <div key={c.id} className="condition-row">
            {index > 0 && <span className="muted">{mode === "and" ? "かつ" : "または"}</span>}
            <select value={c.field} onChange={(e) => changeField(c.id, e.target.value)}>{CUSTOMER_FIELDS.filter((f) => f.key !== "id").map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
            <select value={c.op} onChange={(e) => updateCondition(c.id, { op: e.target.value as ConditionOp, a: "", b: "" })}>{opsFor(field?.kind ?? "text").map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}</select>
            {valueInputs(c)}
            <button className="secondary" title="この条件を外す" onClick={() => setConditions((prev) => prev.filter((x) => x.id !== c.id))}>✕</button>
          </div>;
        })}
        <button className="secondary" onClick={() => setConditions((prev) => [...prev, newCondition()])}>＋ 条件を追加</button>
      </div>
      {error ? <p className="error">{error}</p> : loading && !all ? <p className="muted">読込中…（全会員を読み込んでいます）</p> : rows.length === 0 ? <p className="muted">条件に一致するユーザーがいません</p> :
      <div className="table-scroll tall" ref={scrollRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}><table className="freeze-col freeze-head"><thead><tr>{visibleFields.map((f) => (
        <th key={f.key} onClick={() => toggleSort(f.key)} title="クリックで並び替え（未設定は常に末尾）" style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", textAlign: rightAligned(f.kind) ? "right" : "left", color: sortKey === f.key ? "#ef5da8" : undefined }}>{f.label}{sortKey === f.key ? (sortDir === "desc" ? " ▼" : " ▲") : ""}</th>
      ))}</tr></thead><tbody>
        {first > 0 && <tr aria-hidden style={{ height: first * ROW_HEIGHT }}><td colSpan={visibleFields.length} style={{ padding: 0, border: 0 }} /></tr>}
        {windowRows.map((row) => (
          <tr key={row.id} onClick={() => setSelected(row)} style={{ cursor: "pointer", height: ROW_HEIGHT }} title="クリックで個別のご帰宅明細を表示">{visibleFields.map((f) => (
            <td key={f.key} style={{ whiteSpace: "nowrap", textAlign: rightAligned(f.kind) ? "right" : "left", paddingTop: 6, paddingBottom: 6 }}>
              {f.key === "name" ? <><b>{row.name}</b><small className="id">{row.id}</small></> : f.key === "rank" ? <span className={`text-rank ${row.rank}`}>{row.rank}</span> : displayValue(row, f, FORMAT)}
            </td>
          ))}</tr>
        ))}
        {last < rows.length && <tr aria-hidden style={{ height: (rows.length - last) * ROW_HEIGHT }}><td colSpan={visibleFields.length} style={{ padding: 0, border: 0 }} /></tr>}
      </tbody></table></div>}
    </section>
    {selected && <CustomerDetail customer={selected} onClose={() => setSelected(null)} />}
  </>;
}

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
    ["残高", `Apple ${number.format(customer.coinApple || 0)} / Google ${number.format(customer.coinGoogle || 0)}コイン / ${number.format(customer.rewardPoint || 0)}RP`],
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
