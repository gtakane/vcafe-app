"use client";

import { useMemo, useState } from "react";
import { number } from "../shared/format";
import type { customerRows } from "@/lib/analytics";

type CustomerRow = ReturnType<typeof customerRows>[number];

export default function CrossMatrix({ maids, customers, counts, onExport }: { maids: Array<{ id: string; name: string }>; customers: CustomerRow[]; counts: Map<string, number>; onExport: (name: string, data: Array<Array<string | number>>) => void }) {
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
