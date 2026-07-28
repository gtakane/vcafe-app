"use client";

import type { Granularity, Viewer } from "@/lib/types";
import type { GrowthMetrics } from "@/lib/growth";
import type { customerRows, summarize } from "@/lib/analytics";
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
        <section className="metrics"><Metric label="ご帰宅数" value={`${number.format(totals.visits)}件`} note={`ユニーク ${totals.customerCount}名`}/><Metric label="売上" value={yen.format(totals.revenue)} note={`有料ご帰宅 ${totals.paid}件`} tone="purple"/><Metric label="実働時間" value={`${totals.workHours.toFixed(1)}h`} note={`遅刻合計 ${totals.lateMinutes.toFixed(0)}分`} tone="blue"/><Metric label="記念撮影" value={`${totals.cheki}枚`} note={`撮影率 ${totals.visits ? (totals.cheki/totals.visits*100).toFixed(1) : 0}%`} tone="orange"/>{viewer.role === "admin" && <><Metric label="1日あたり利用者数(平均)" value={growth ? `${number.format(growth.avgDau)}名` : "—"} note={growth ? `最も多い日 ${number.format(growth.peakDau)}名` : (growthError || "集計中")} tone="blue" hint="DAU（デイリー・アクティブ・ユーザー）＝その営業日に1回以上ご帰宅したユーザーの実人数。同じ人が何回ご帰宅しても1名と数えます。『平均』は選択期間の1日平均、『最も多い日』は期間中で最大だった日の人数です。"/><Metric label="新規登録者数" value={growth ? `${number.format(growth.newRegistrations)}名` : "—"} note={growth ? `課金転換 ${pct(growth.newPaidConversionRate)}` : (growthError || "集計中")} tone="purple" hint="選択期間内に新しく会員登録したユーザーの人数。課金転換は、そのうち期間内に有料ご帰宅をした人の割合です。"/></>}</section>
        <section className="grid-2"><article className="panel"><div className="panel-head"><div><p className="eyebrow">PERFORMANCE TREND</p><h2>ご帰宅数の推移</h2></div><span className="badge">{granularity === "hour" ? "時間別" : granularity === "day" ? "日次" : granularity === "week" ? "週次" : "月次"}</span></div><LineChart points={trend}/></article><article className="panel"><div className="panel-head"><div><p className="eyebrow">CUSTOMER MIX</p><h2>ユーザーランク構成</h2></div></div><div className="rank-mix">{visibleRanks.map((rank)=>{const count=customerStats.filter((u)=>u.rank===rank).length;return <div key={rank}><span>{rank}</span><strong>{count}<small>名</small></strong><i><em style={{width:`${customerStats.length?count/customerStats.length*100:0}%`}}/></i></div>})}</div></article></section>
  </>;
}
