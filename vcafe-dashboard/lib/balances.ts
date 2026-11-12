// 未使用残高（前受金）と、経理と同じ計算での月の確定売上（2026-11追加）。
//
// 経理の計上（Vあっと売上計上関連・経営管理報告用）:
//   売上 = 当月の購入額 + 前月末の未使用残高 − 当月末の未使用残高（税込）
//   - Apple/Google の購入額はストア手数料（15%）控除後、Stripe は総額
//   - 未使用残高の円換算: Apple/Googleコイン1.19円、リワードポイント1.1円、
//     チケット ご帰宅850円・プレミアム960円・ランダム650円・記念撮影500円（新規登録プレゼントは0円）
// 「月末の残高」は翌月1日の朝（営業終了の2:00以降）に記録したものを使う。

import { CHEKI_PRICE, COIN_YEN, excludingTax, REWARD_POINT_YEN, TICKET_PRICES } from "./metrics.ts";

export const STORE_FEE_RATE = 0.15; // Apple/Google の手数料（小規模事業者プログラム）

export interface BalanceSnapshot {
  snapshotAt: string;
  source: string; // sync / accounting-export（経理の書き出しから取り込んだ基準値）
  appleCoin: number;
  googleCoin: number;
  legacyCoin: number;
  rewardPoint: number;
  ticketGokitaku: number;
  ticketPremium: number;
  ticketRandom: number;
  ticketCheki: number;
  ticketChekiFree: number;
}

export interface PlatformYen { apple: number; google: number; stripe: number; total: number }

export interface MonthlyPurchase { month: string; apple: number; google: number; stripe: number; inappUnknown: number }

export interface ConfirmedMonth {
  month: string; // YYYY-MM
  status: "confirmed" | "provisional" | "missing";
  note: string;
  openingAt: string | null; // 前月末残高の記録日時
  closingAt: string | null; // 当月末残高の記録日時（暫定は最新の記録）
  purchase: PlatformYen | null; // 購入額（Apple/Googleは手数料控除後）
  opening: PlatformYen | null; // 前月末の未使用残高
  closing: PlatformYen | null; // 当月末の未使用残高
  revenue: PlatformYen | null; // 売上（税込）
  revenueExcludingTax: number | null;
}

export interface BalancesResult {
  latest: (PlatformYen & { snapshotAt: string }) | null;
  monthEnds: Array<PlatformYen & { month: string; snapshotAt: string }>; // 各月末の未使用残高（前受金）
  months: ConfirmedMonth[];
}

/** 未使用残高を円に換算する（経理と同じ単価）。 */
export function valueSnapshot(s: BalanceSnapshot): PlatformYen {
  const apple = Math.round(s.appleCoin * COIN_YEN);
  const google = Math.round(s.googleCoin * COIN_YEN);
  const stripe = Math.round((s.rewardPoint + s.legacyCoin) * REWARD_POINT_YEN)
    + s.ticketGokitaku * TICKET_PRICES.gokitaku30minutes
    + s.ticketPremium * TICKET_PRICES.premiumGokitaku1
    + s.ticketRandom * TICKET_PRICES.luckyGokitaku
    + s.ticketCheki * CHEKI_PRICE;
  return { apple, google, stripe, total: apple + google + stripe };
}

const jstParts = (iso: string) => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(new Date(iso));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
};

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * 月末（= 翌月1日の営業終了後）の残高の記録を選ぶ。
 * 翌月1日 2:00 以降の最初の記録。無ければ 1〜3日の最初の記録（note で明示）。
 */
export function monthEndSnapshot(snapshots: BalanceSnapshot[], month: string): { snapshot: BalanceSnapshot; exact: boolean } | null {
  const first = `${nextMonth(month)}-01`;
  const sorted = [...snapshots].sort((a, b) => a.snapshotAt.localeCompare(b.snapshotAt));
  const onFirst = sorted.find((s) => { const p = jstParts(s.snapshotAt); return p.day === first && p.hour >= 2; });
  if (onFirst) return { snapshot: onFirst, exact: true };
  const near = sorted.find((s) => { const p = jstParts(s.snapshotAt); return p.day > first && p.day <= `${nextMonth(month)}-03`; });
  return near ? { snapshot: near, exact: false } : null;
}

const minus = (a: PlatformYen, b: PlatformYen): PlatformYen => ({ apple: a.apple - b.apple, google: a.google - b.google, stripe: a.stripe - b.stripe, total: a.total - b.total });
const plus = (a: PlatformYen, b: PlatformYen): PlatformYen => ({ apple: a.apple + b.apple, google: a.google + b.google, stripe: a.stripe + b.stripe, total: a.total + b.total });

export function purchaseYen(p: MonthlyPurchase): PlatformYen {
  const apple = Math.round(p.apple * (1 - STORE_FEE_RATE));
  const google = Math.round(p.google * (1 - STORE_FEE_RATE));
  const stripe = Math.round(p.stripe);
  return { apple, google, stripe, total: apple + google + stripe };
}

/** 月の確定売上。前月末と当月末の残高がそろった月は確定、当月は最新の記録で暫定。 */
export function computeBalances(snapshots: BalanceSnapshot[], purchases: MonthlyPurchase[], months: string[], now: Date): BalancesResult {
  const sorted = [...snapshots].sort((a, b) => a.snapshotAt.localeCompare(b.snapshotAt));
  const latestSnapshot = sorted.at(-1) ?? null;
  const currentMonth = jstParts(now.toISOString()).day.slice(0, 7);
  const prevMonth = (m: string) => { const [y, mm] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mm - 2, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };

  const monthEnds = months
    .map((month) => { const e = monthEndSnapshot(sorted, month); return e ? { month, snapshotAt: e.snapshot.snapshotAt, ...valueSnapshot(e.snapshot) } : null; })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  const result = months.map((month): ConfirmedMonth => {
    const opening = monthEndSnapshot(sorted, prevMonth(month));
    const closing = month === currentMonth ? (latestSnapshot ? { snapshot: latestSnapshot, exact: false } : null) : monthEndSnapshot(sorted, month);
    const p = purchases.find((x) => x.month === month);
    const base = { month, openingAt: opening?.snapshot.snapshotAt ?? null, closingAt: closing?.snapshot.snapshotAt ?? null };
    if (!opening || !closing || month > currentMonth) {
      return { ...base, status: "missing", note: !opening ? "前月末の残高の記録がありません" : "当月末の残高の記録がまだありません", purchase: p ? purchaseYen(p) : null, opening: opening ? valueSnapshot(opening.snapshot) : null, closing: closing ? valueSnapshot(closing.snapshot) : null, revenue: null, revenueExcludingTax: null };
    }
    const purchase = p ? purchaseYen(p) : { apple: 0, google: 0, stripe: 0, total: 0 };
    const o = valueSnapshot(opening.snapshot), c = valueSnapshot(closing.snapshot);
    const revenue = minus(plus(purchase, o), c);
    const notes = [
      month === currentMonth ? `暫定（${jstParts(closing.snapshot.snapshotAt).day} の残高で計算）` : "",
      !opening.exact || (month !== currentMonth && !closing.exact) ? "月初当日の記録が無く近い日の記録で代用" : "",
      p && p.inappUnknown > 0 ? "購入元未取得のアプリ内課金があります" : "",
    ].filter(Boolean);
    return { ...base, status: month === currentMonth ? "provisional" : "confirmed", note: notes.join("・"), purchase, opening: o, closing: c, revenue, revenueExcludingTax: excludingTax(revenue.total) };
  });

  return { latest: latestSnapshot ? { snapshotAt: latestSnapshot.snapshotAt, ...valueSnapshot(latestSnapshot) } : null, monthEnds, months: result };
}

const tsIso = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "object" && "value" in (value as Record<string, unknown>)) return String((value as { value: unknown }).value);
  return String(value);
};

export async function loadBalances(months: string[]): Promise<BalancesResult> {
  const projectId = process.env.BIGQUERY_PROJECT_ID;
  const dataset = process.env.BIGQUERY_DATASET;
  if (!projectId || !dataset) throw new Error("BigQueryの環境変数が設定されていません");
  const { BigQuery } = await import("@google-cloud/bigquery");
  const bigquery = new BigQuery({ projectId });
  const location = process.env.BIGQUERY_LOCATION || "asia-northeast1";
  const maximumBytesBilled = process.env.BIGQUERY_MAX_BYTES_BILLED || "1073741824";
  const from = `${months[0]}-01`;
  const t = (name: string) => `\`${projectId}.${dataset}.${name}\``;
  const run = async (query: string) => (await bigquery.query({ location, params: { from }, maximumBytesBilled, query }))[0] as Array<Record<string, unknown>>;
  const [snapRows, purchaseRows] = await Promise.all([
    run(`SELECT * FROM ${t("balance_snapshots")} WHERE DATE(snapshotAt) >= DATE_SUB(DATE(@from), INTERVAL 1 DAY) ORDER BY snapshotAt`),
    run(`SELECT FORMAT_DATE("%Y-%m", DATE(\`at\`, "Asia/Tokyo")) AS month,
           SUM(IF(vendor = "apple", amount, 0)) AS apple,
           SUM(IF(vendor = "google", amount, 0)) AS google,
           SUM(IF(channel = "webstore", amount, 0)) AS stripe,
           SUM(IF(channel = "inapp" AND vendor IS NULL, amount, 0)) AS inappUnknown
         FROM ${t("payments_current_range")}(DATE(@from), CURRENT_DATE("Asia/Tokyo"))
         GROUP BY month`),
  ]);
  const n = (v: unknown) => Number(v) || 0;
  const snapshots: BalanceSnapshot[] = snapRows.map((r) => ({
    snapshotAt: tsIso(r.snapshotAt) ?? "", source: String(r.source ?? ""),
    appleCoin: n(r.appleCoin), googleCoin: n(r.googleCoin), legacyCoin: n(r.legacyCoin), rewardPoint: n(r.rewardPoint),
    ticketGokitaku: n(r.ticketGokitaku), ticketPremium: n(r.ticketPremium), ticketRandom: n(r.ticketRandom), ticketCheki: n(r.ticketCheki), ticketChekiFree: n(r.ticketChekiFree),
  })).filter((s) => s.snapshotAt);
  const purchases: MonthlyPurchase[] = purchaseRows.map((r) => ({ month: String(r.month), apple: n(r.apple), google: n(r.google), stripe: n(r.stripe), inappUnknown: n(r.inappUnknown) }));
  return computeBalances(snapshots, purchases, months, new Date());
}
