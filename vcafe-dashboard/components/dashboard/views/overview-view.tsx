"use client";

import type { Granularity, Viewer } from "@/lib/types";
import type { GrowthMetrics } from "@/lib/growth";
import type { customerRows, summarize } from "@/lib/analytics";
import { FREE_KIND_LABELS, FREE_KINDS } from "@/lib/metrics";
import { number, pct, yen } from "../shared/format";
import Metric from "../shared/metric-card";
import LineChart from "../shared/line-chart";

type Totals = ReturnType<typeof summarize>;
type CustomerRow = ReturnType<typeof customerRows>[number];

// 概要画面。KPIカード・推移グラフ・ユーザーランク構成。
export default function OverviewView({ viewer, totals, growth, growthError, trend, granularity, customerStats, visibleRanks }: {
  viewer: Viewer;
  totals: Totals;
  growth: GrowthMetrics | null;
  growthError: string;
  trend: Array<{ label: string; visits: number }>;
  granularity: Granularity;
  customerStats: CustomerRow[];
  visibleRanks: string[];
}) {
  return <>
        <section className="metrics"><Metric label="ご帰宅数" value={`${number.format(totals.visits)}件`} note={`ユニーク ${totals.customerCount}名`}/><Metric label="売上（税込）" value={yen.format(totals.revenue)} note={`税抜 ${yen.format(totals.revenueParts.excludingTax)}・有料ご帰宅 ${totals.paid}件`} tone="purple" hint="ご帰宅・予約・招待で消費されたコイン・ポイント・チケットを、経理の計上と同じ単価で円換算した額（Apple/Googleコイン1.19円、リワードポイント1.1円、ご帰宅チケット850円・プレミアム960円・ランダム650円、有料の記念撮影500円）。アイテム購入・有効期限切れ・無償付与は含まないため、月の確定売上とは一致しません。"/><Metric label="実働時間" value={`${totals.workHours.toFixed(1)}h`} note={`遅刻合計 ${totals.lateMinutes.toFixed(0)}分`} tone="blue"/><Metric label="無料枠ご帰宅" value={`${number.format(totals.free)}件`} note={`全ご帰宅の ${totals.visits ? (totals.free/totals.visits*100).toFixed(1) : 0}%（お試し含む）`} tone="blue" hint="お試しご帰宅と、2026年11月6日から始まった無料ご帰宅券・新規ユーザー無料・新人メイド無料の合計（実件数）。売上は0円、有料ご帰宅には含めません。"/><Metric label="記念撮影" value={`${totals.cheki}枚`} note={`撮影率 ${totals.visits ? (totals.cheki/totals.visits*100).toFixed(1) : 0}%`} tone="orange"/>{viewer.role === "admin" && <><Metric label="1日あたり利用者数(平均)" value={growth ? `${number.format(growth.avgDau)}名` : "—"} note={growth ? `最も多い日 ${number.format(growth.peakDau)}名` : (growthError || "集計中")} tone="blue" hint="DAU（デイリー・アクティブ・ユーザー）＝その営業日に1回以上ご帰宅したユーザーの実人数。同じ人が何回ご帰宅しても1名と数えます。『平均』は選択期間の1日平均、『最も多い日』は期間中で最大だった日の人数です。"/><Metric label="新規登録者数" value={growth ? `${number.format(growth.newRegistrations)}名` : "—"} note={growth ? `課金転換 ${pct(growth.newPaidConversionRate)}` : (growthError || "集計中")} tone="purple" hint="選択期間内に新しく会員登録したユーザーの人数。課金転換は、そのうち期間内に有料ご帰宅をした人の割合です。"/></>}</section>
        {viewer.role === "admin" && <section className="panel"><div className="panel-head"><div><p className="eyebrow">REVENUE BREAKDOWN</p><h2>売上の内訳（税込）</h2></div><span className="badge">税抜 {yen.format(totals.revenueParts.excludingTax)}</span></div><div className="rank-mix">{([
          ["Appleコイン", totals.revenueParts.apple],
          ["Googleコイン", totals.revenueParts.google],
          ...(totals.revenueParts.coinUnknown ? [["コイン（購入元未取得）", totals.revenueParts.coinUnknown]] : []),
          ["リワードポイント（ウェブコイン等）", totals.revenueParts.rewardPoint],
          ["チケット", totals.revenueParts.ticket],
          ["記念撮影（有料）", totals.revenueParts.cheki],
          ...(totals.revenueParts.other ? [["その他（明細の無い古い記録）", totals.revenueParts.other]] : []),
        ] as Array<[string, number]>).map(([label, amount]) => <div key={label}><span>{label}</span><strong>{yen.format(amount)}</strong><i><em style={{ width: `${totals.revenue ? Math.max(0, amount) / totals.revenue * 100 : 0}%` }}/></i></div>)}</div><p className="eyebrow" style={{ marginTop: 12 }}>うち予約・招待 {yen.format(totals.revenueParts.bookings)}／Stripe側（リワードポイント＋チケット＋記念撮影） {yen.format(totals.revenueParts.rewardPoint + totals.revenueParts.ticket + totals.revenueParts.cheki)}</p></section>}
        {totals.free > 0 && <section className="panel"><div className="panel-head"><div><p className="eyebrow">FREE VISITS</p><h2>無料枠の内訳</h2></div><span className="badge">合計 {number.format(totals.free)}件</span></div><div className="rank-mix">{FREE_KINDS.filter((kind) => kind !== "otherFree" || totals.freeKinds.otherFree > 0).map((kind) => { const count = totals.freeKinds[kind]; return <div key={kind}><span>{FREE_KIND_LABELS[kind]}</span><strong>{number.format(count)}<small>件</small></strong><i><em style={{ width: `${totals.free ? count / totals.free * 100 : 0}%` }}/></i></div>; })}</div></section>}
        <section className="grid-2"><article className="panel"><div className="panel-head"><div><p className="eyebrow">PERFORMANCE TREND</p><h2>ご帰宅数の推移</h2></div><span className="badge">{granularity === "hour" ? "時間別" : granularity === "day" ? "日次" : granularity === "week" ? "週次" : "月次"}</span></div><LineChart points={trend}/></article><article className="panel"><div className="panel-head"><div><p className="eyebrow">CUSTOMER MIX</p><h2>ユーザーランク構成</h2></div></div><div className="rank-mix">{visibleRanks.map((rank)=>{const count=customerStats.filter((u)=>u.rank===rank).length;return <div key={rank}><span>{rank}</span><strong>{count}<small>名</small></strong><i><em style={{width:`${customerStats.length?count/customerStats.length*100:0}%`}}/></i></div>})}</div></article></section>
  </>;
}
