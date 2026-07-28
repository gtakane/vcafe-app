"use client";

import { useEffect, useMemo, useState } from "react";
import type { Customer } from "@/lib/types";
import { genderLabel, jstDate, number, yen } from "../shared/format";
import VisitLogPanel from "../visit-log/panel";

// 全会員の通算値。上部の期間フィルタには依存しない。
type CustomerCol = { key: keyof Customer; label: string; kind: "text" | "num" | "money" | "date" | "gender" | "year" };

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

const NUMERIC_FILTER_COLUMNS = ["totalVisitAmount", "paymentAmount", "paymentCount", "maxConsecutiveVisitDays", "purchasedItemQuantity", "purchasedItemCoin", "presentAmount", "coin", "rewardPoint", "birthYear"]
  .map((key) => CUSTOMER_DB_COLUMNS.find((c) => String(c.key) === key))
  .filter((c): c is NonNullable<typeof c> => Boolean(c));

type NumericFilterChip = { key: string; min: string; max: string };

export default function CustomerDatabase({ onExport }: { onExport: (name: string, data: Array<Array<string | number>>) => void }) {
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
