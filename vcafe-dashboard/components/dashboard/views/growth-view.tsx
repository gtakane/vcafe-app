"use client";

import type { GrowthMetrics } from "@/lib/growth";
import { number, pct, yen } from "../shared/format";
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
    { term: "14日以内の初回課金率", body: "期間内に登録した人のうち、登録から14日以内に初めて課金した人の割合。登録から14日経っていない人は判定できないため分母から外し、「判定待ち」として表示します。" },
    { term: "新規ユーザー無料からの有料化率", body: "期間内に初めて新規ユーザー無料（20分）を使った人のうち、その後（今日まで）に課金した、または有料ご帰宅（予約を含む）をした人の割合。" },
    { term: "新人メイド無料からの有料再訪率", body: "期間内に新人メイド無料を使った（ユーザー×メイド）のうち、その後に同じメイドへ有料でご帰宅した割合。" },
    { term: "課金者数・1人あたり課金額", body: "その月に1回以上課金した人数と、課金額（ストア・Stripeの実払い額）÷課金者数。" },
    { term: "有料利用者数・1人あたり利用額", body: "その月に有料ご帰宅・予約をした人数と、消費額（経理と同じ単価：コイン1.19円・リワードP1.1円・チケット850/960/650円）÷人数。" },
    { term: "登録月ごとの課金継続率", body: "その月に登録した人のうち、登録からkか月目に課金した人の割合（0か月目=登録月）。まだ来ていない月は空欄。" },
    { term: "未使用残高（前受金）", body: "全会員（テストユーザー除く）が持っている未使用のコイン・ポイント・チケットを、経理と同じ単価（Apple/Googleコイン1.19円、リワードポイント1.1円、チケット850/960/650円、記念撮影500円）で円換算した額。月末の値は翌月1日の朝の記録。" },
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
    <InsightsSection growth={growth} />
    <BalancesSection growth={growth} />
    <section className="grid-2">
      <article className="panel"><div className="panel-head"><div><p className="eyebrow">DAILY ACTIVE USERS</p><h2>DAUの推移</h2></div><span className="badge">{loading ? "更新中" : "営業日"}</span></div><LineChart points={dauPoints} suffix="名" ariaLabel="DAUの推移" /></article>
      <article className="panel"><div className="panel-head"><div><p className="eyebrow">DEFINITIONS</p><h2>指標の定義</h2><small>前期間 {growth.prevStart}〜{growth.prevEnd} と比較</small></div></div><dl className="def-list">{defs.map((d) => <div key={d.term}><dt>{d.term}</dt><dd>{d.body}</dd></div>)}</dl></article>
    </section>
  </>;
}

const rateText = (r: { rate: number | null }) => (r.rate === null ? "—" : pct(r.rate));

// 登録月ごとの課金継続率のマス目の色（寒色系・高いほど濃い）。
const cellStyle = (value: number | null) => value === null ? { color: "#c9bfd0" } : { background: `rgba(79, 70, 229, ${Math.min(0.85, 0.08 + value * 1.6)})`, color: value > 0.3 ? "#fff" : "var(--ink)" };

function InsightsSection({ growth }: { growth: GrowthMetrics }) {
  const insights = growth.insights;
  if (!insights) return growth.insightsError ? <section className="panel"><p className="error">{growth.insightsError}</p></section> : null;
  const fp = insights.firstPayment;
  return <>
    <p className="eyebrow" style={{ margin: "14px 2px 2px" }}>CAMPAIGNS & MONETIZATION ・ 施策と課金（{insights.asOf} 時点で判定）</p>
    <section className="metrics">
      <Metric label="14日以内の初回課金率" value={rateText(fp)} note={`登録${number.format(fp.registrations)}名・判定${number.format(fp.judged)}名中${number.format(fp.converted)}名${fp.pending ? `・判定待ち${number.format(fp.pending)}名` : ""}`} tone="purple" hint="期間内に登録した人のうち、登録から14日以内に初めて課金した人の割合。14日経っていない人は判定待ちとして分母から外します。" />
      <Metric label="新規ユーザー無料→有料化" value={rateText(insights.newUserFree)} note={`利用${number.format(insights.newUserFree.total)}名中${number.format(insights.newUserFree.converted)}名が有料化`} tone="pink" hint="期間内に初めて新規ユーザー無料を使った人のうち、その後に課金または有料ご帰宅をした人の割合（今日まで）。" />
      <Metric label="新人メイド無料→有料再訪" value={rateText(insights.freshMaidFree)} note={`利用${number.format(insights.freshMaidFree.total)}組中${number.format(insights.freshMaidFree.converted)}組が再訪`} tone="blue" hint="期間内に新人メイド無料を使った（ユーザー×メイド）のうち、その後に同じメイドへ有料でご帰宅した割合。" />
    </section>
    <section className="panel table-panel">
      <div className="panel-head"><div><p className="eyebrow">MONTHLY PAYING USERS</p><h2>月ごとの課金者数と1人あたり額</h2><small>期間の終了月までの12か月</small></div></div>
      <div className="table-scroll"><table className="freeze-head"><thead><tr><th>月</th><th style={{ textAlign: "right" }}>課金者数</th><th style={{ textAlign: "right" }}>課金額</th><th style={{ textAlign: "right" }}>1人あたり課金額</th><th style={{ textAlign: "right" }}>有料利用者数</th><th style={{ textAlign: "right" }}>利用額</th><th style={{ textAlign: "right" }}>1人あたり利用額</th></tr></thead>
        <tbody>{insights.monthly.map((m) => <tr key={m.month}><td>{m.month}</td><td style={{ textAlign: "right" }}>{number.format(m.payingUsers)}名</td><td style={{ textAlign: "right" }}>{yen.format(m.paymentAmount)}</td><td style={{ textAlign: "right" }}><b>{yen.format(m.arppu)}</b></td><td style={{ textAlign: "right" }}>{number.format(m.usingUsers)}名</td><td style={{ textAlign: "right" }}>{yen.format(m.usage)}</td><td style={{ textAlign: "right" }}><b>{yen.format(m.usagePerUser)}</b></td></tr>)}</tbody></table></div>
    </section>
    <section className="panel table-panel">
      <div className="panel-head"><div><p className="eyebrow">PAYING RETENTION BY COHORT</p><h2>登録月ごとの課金継続率</h2><small>登録からkか月目にその月の中で課金した人の割合（0=登録月）</small></div></div>
      <div className="table-scroll"><table className="freeze-col freeze-head matrix"><thead><tr><th>登録月</th><th>登録者</th>{insights.cohorts[0]?.rates.map((_, k) => <th key={k}>{k}か月目</th>)}</tr></thead>
        <tbody>{[...insights.cohorts].reverse().map((c) => <tr key={c.month}><td>{c.month}</td><td>{number.format(c.size)}名</td>{c.rates.map((r, k) => <td key={k} style={cellStyle(r)}>{r === null ? "" : pct(r)}</td>)}</tr>)}</tbody></table></div>
    </section>
  </>;
}

const jstStamp = (iso: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

function BalancesSection({ growth }: { growth: GrowthMetrics }) {
  const balances = growth.balances;
  if (!balances) return growth.balancesError ? <section className="panel"><p className="muted">{growth.balancesError}</p></section> : null;
  const rows = [...balances.monthEnds.map((m) => ({ label: `${m.month} 月末`, at: m.snapshotAt, ...m }))];
  if (balances.latest && !rows.some((r) => r.at === balances.latest!.snapshotAt)) rows.push({ label: "最新", at: balances.latest.snapshotAt, month: "", ...balances.latest });
  return <section className="panel table-panel">
    <div className="panel-head"><div><p className="eyebrow">DEFERRED REVENUE</p><h2>未使用残高（前受金）の推移</h2><small>全会員の未使用のコイン・ポイント・チケットを経理と同じ単価で円換算（税込）</small></div></div>
    {rows.length === 0 ? <p className="muted" style={{ padding: "0 20px 16px" }}>残高の記録がまだありません（毎日朝5時に記録します）</p> :
    <div className="table-scroll"><table className="freeze-head"><thead><tr><th>時点</th><th style={{ textAlign: "right" }}>Apple</th><th style={{ textAlign: "right" }}>Google</th><th style={{ textAlign: "right" }}>Stripe（ポイント・チケット）</th><th style={{ textAlign: "right" }}>合計</th><th>記録日時</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.label}><td>{r.label}</td><td style={{ textAlign: "right" }}>{yen.format(r.apple)}</td><td style={{ textAlign: "right" }}>{yen.format(r.google)}</td><td style={{ textAlign: "right" }}>{yen.format(r.stripe)}</td><td style={{ textAlign: "right" }}><b>{yen.format(r.total)}</b></td><td>{jstStamp(r.at)}</td></tr>)}</tbody></table></div>}
  </section>;
}
