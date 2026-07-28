"use client";

import type { MaidVisitLog } from "@/lib/types";
import { mergedStayMinutes, SEATS_PER_MAID } from "@/lib/metrics";
import { jstDateTime, number, yen } from "../shared/format";

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

export default function VisitLogTable({ logs, hideMaid, hideCustomer, onExport, exportName, serveMinutes }: { logs: MaidVisitLog[]; hideMaid?: boolean; hideCustomer?: boolean; onExport: (name: string, data: Array<Array<string | number>>) => void; exportName: string; serveMinutes?: number | null }) {
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
