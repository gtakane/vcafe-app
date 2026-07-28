"use client";

import { number } from "./format";

// ご帰宅数の推移を描くスパークライン。依存を持たない純粋な表示部品。
export default function LineChart({ points, suffix = "件", ariaLabel = "ご帰宅数の推移" }: { points: Array<{ label: string; visits: number }>; suffix?: string; ariaLabel?: string }) {
  const width = 720, height = 220, pad = 28;
  if (!points.length) return <div className="chart-wrap"><p className="muted" style={{ padding: "2rem 0", textAlign: "center" }}>この期間のデータがありません</p></div>;
  const max = Math.max(...points.map((p) => p.visits), 1);
  const coords = points.map((p, i) => ({ x: pad + (i * (width - pad * 2)) / Math.max(points.length - 1, 1), y: height - pad - (p.visits / max) * (height - pad * 2), ...p }));
  const path = coords.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  const single = coords.length === 1;
  return <div className="chart-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}><defs><linearGradient id="pinkFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ef5da8" stopOpacity=".28"/><stop offset="1" stopColor="#ef5da8" stopOpacity="0"/></linearGradient></defs>{[0,1,2,3].map((i)=><line key={i} x1={pad} x2={width-pad} y1={pad+i*(height-pad*2)/3} y2={pad+i*(height-pad*2)/3} stroke="#f1e8ed"/>)}{coords.length > 1 && <path d={`${path} L${coords.at(-1)!.x},${height-pad} L${coords[0].x},${height-pad} Z`} fill="url(#pinkFade)"/>}{!single && <path d={path} fill="none" stroke="#ef5da8" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>}{coords.map((p)=><circle key={`${p.label}-${p.x}`} cx={single ? width / 2 : p.x} cy={p.y} r={single ? 6 : 4} fill="white" stroke="#ef5da8" strokeWidth="3"><title>{p.label}: {p.visits}{suffix}</title></circle>)}{coords.map((p, i) => (points.length <= 24 || i % Math.ceil(points.length / 12) === 0) ? <text key={`v-${p.label}-${p.x}`} x={single ? width / 2 : p.x} y={p.y - 9} textAnchor="middle" fontSize="11" fontWeight="700" fill="#c2185b">{number.format(p.visits)}</text> : null)}</svg><div className="x-labels">{(single ? points : points.filter((_,i)=>i===0||i===points.length-1||i===Math.floor(points.length/2))).map((p)=><span key={p.label}>{p.label}</span>)}</div></div>;
}
