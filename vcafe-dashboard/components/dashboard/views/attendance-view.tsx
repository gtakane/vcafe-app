"use client";

import { useMemo, useState } from "react";
import type { Maid, Shift } from "@/lib/types";
import { number, truncate2 } from "../shared/format";

// 勤怠実績: 全行表示・列ソート・メイド/状態フィルタ付き。遅刻分は小数点第3位以下切り捨て。
type AttendanceSortKey = "date" | "maid" | "worked" | "late";

export default function AttendanceTable({ shifts, maids }: { shifts: Shift[]; maids: Maid[] }) {
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
