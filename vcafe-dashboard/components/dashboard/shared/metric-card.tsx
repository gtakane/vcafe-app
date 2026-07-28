"use client";

// 概要のKPIカード。hint はホバー時の補足説明。
export default function Metric({ label, value, note, tone = "pink", hint }: { label: string; value: string; note: string; tone?: string; hint?: string }) {
  return <article className="metric" title={hint}><div className={`metric-icon ${tone}`}>●</div><div><p>{label}{hint && <span className="hint-mark" aria-label={hint}>?</span>}</p><strong>{value}</strong><small>{note}</small></div></article>;
}
