"use client";

import type { GrowthMetrics } from "@/lib/growth";
import { number, pct } from "../shared/format";
import Metric from "../shared/metric-card";
import LineChart from "../shared/line-chart";

export default function GrowthPanel({ growth, loading, error }: { growth: GrowthMetrics | null; loading: boolean; error: string }) {
  if (error) return <section className="panel"><p className="error">{error}</p></section>;
  if (!growth) return <section className="panel"><p className="muted">読込中…</p></section>;
  const dauPoints = growth.daily.map((d) => ({ label: d.label, visits: d.dau }));
  const defs: Array<{ term: string; body: string }> = [
    { term: "DAU / WAU / MAU（平均・ピーク）", body: "各営業日／週（月曜始まり）／暦月にご帰宅したユニークユーザー数。営業日は19:00〜翌2:00（0:00〜1:59は前日扱い）。平均は期間内の各バケットの平均、ピークは最大値。" },
    { term: "定着率（DAU/MAU）", body: "平均DAU ÷ 平均MAU。月内でどれだけ高頻度に再訪しているかの粘着度（高いほど毎日使われている）。" },
    { term: "新規登録者数", body: "選択期間内に会員登録（registrationDate）したユーザーの人数。" },
    { term: "新規課金転換率", body: "期間内の新規登録者のうち、期間内に1回以上の有料ご帰宅（予約を含む）をした人の割合。" },
    { term: "離脱率", body: "直前の同じ長さの期間にご帰宅があったユーザーのうち、当期間に一度もご帰宅しなかった人の割合。" },
    { term: "占有率 / 空席率", body: "同時に最大3名着席可・1枠20分のため、メイド1時間の稼働=最大9名分。全メイドの合計お給仕時間×9を最大利用可能枠とし、重み付きご帰宅数（滞在20分=1枠）が占める割合が占有率、空いている割合が空席率。" },
  ];
  return <>
    <p className="eyebrow" style={{ margin: "14px 2px 2px" }}>ACTIVE USERS ・ アクティブユーザー</p>
    <section className="metrics">
      <Metric label="1日あたり利用者数(平均)" value={`${number.format(growth.avgDau)}名`} note={`最も多い日 ${number.format(growth.peakDau)}名`} tone="blue" hint="DAU＝その営業日に1回以上ご帰宅したユーザーの実人数（同じ人が何回来ても1名）。『平均』は期間中の1日平均、『最も多い日』は期間中の最大値です。" />
      <Metric label="1週あたり利用者数(平均)" value={`${number.format(growth.avgWau)}名`} note={`最も多い週 ${number.format(growth.peakWau)}名`} tone="purple" hint="WAU＝その週(月曜〜日曜)に1回以上ご帰宅したユーザーの実人数。週内に何回来ても1名です。" />
      <Metric label="1か月あたり利用者数(平均)" value={`${number.format(growth.avgMau)}名`} note={`最も多い月 ${number.format(growth.peakMau)}名`} tone="pink" hint="MAU＝その暦月に1回以上ご帰宅したユーザーの実人数。月内に何回来ても1名です。" />
      <Metric label="定着率 (DAU÷MAU)" value={pct(growth.stickiness)} note="月の利用者のうち毎日来ている割合" tone="orange" hint="平均DAU ÷ 平均MAU。100%に近いほど『月に来る人が毎日来ている』、低いほど『たまにしか来ない』ことを表します。" />
    </section>
    <p className="eyebrow" style={{ margin: "14px 2px 2px" }}>ACQUISITION & OCCUPANCY ・ 獲得 / 継続 / 座席</p>
    <section className="metrics">
      <Metric label="新規登録者数" value={`${number.format(growth.newRegistrations)}名`} note="期間内に会員登録" tone="pink" />
      <Metric label="新規課金転換率" value={pct(growth.newPaidConversionRate)} note={`${number.format(growth.newPaidConversions)}/${number.format(growth.newRegistrations)}名が有料化`} tone="purple" />
      <Metric label="離脱率" value={pct(growth.churnRate)} note={`前期${number.format(growth.prevActiveUsers)}名中${number.format(growth.churnedUsers)}名が未ご帰宅`} tone="orange" />
      <Metric label="空席率" value={pct(growth.vacancyRate)} note={`占有率 ${pct(growth.occupancyRate)}・お給仕${number.format(Math.round(growth.workHours))}h`} tone="blue" />
    </section>
    <section className="grid-2">
      <article className="panel"><div className="panel-head"><div><p className="eyebrow">DAILY ACTIVE USERS</p><h2>DAUの推移</h2></div><span className="badge">{loading ? "更新中" : "営業日"}</span></div><LineChart points={dauPoints} suffix="名" ariaLabel="DAUの推移" /></article>
      <article className="panel"><div className="panel-head"><div><p className="eyebrow">DEFINITIONS</p><h2>指標の定義</h2><small>前期間 {growth.prevStart}〜{growth.prevEnd} と比較</small></div></div><dl className="def-list">{defs.map((d) => <div key={d.term}><dt>{d.term}</dt><dd>{d.body}</dd></div>)}</dl></article>
    </section>
  </>;
}
