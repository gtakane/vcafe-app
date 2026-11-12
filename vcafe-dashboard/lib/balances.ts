// 未使用残高（前受金）と、経理と同じ計算での月の確定売上（2026-11追加）。
//
// 経理の計上（Vあっと売上計上関連・経営管理報告用）:
//   売上 = 当月の購入額 + 前月末の未使用残高 − 当月末の未使用残高（税込）
//   - Apple/Google の購入額はストア手数料（15%）控除後、Stripe は総額
//   - 未使用残高の円換算: Apple/Googleコイン1.19円、リワードポイント1.1円、
//     チケット ご帰宅850円・プレミアム960円・ランダム650円・記念撮影500円（新規登録プレゼントは0円）
// 「月末の残高」は翌月1日の朝（営業終了の2:00以降）に記録したものを使う。

import { CHEKI_PRICE, COIN_YEN, excludingTax, REWARD_POINT_YEN, TICKET_PRICES } from "./metrics.ts";
import { testUserCondition } from "./test-users.ts";

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

export interface MonthlyPurchase {
  month: string;
  apple: number; google: number; stripe: number; inappUnknown: number; // 課金台帳からの推定（Apple/Googleは手数料控除前）
  reported?: { apple: number; google: number; stripe: number } | null; // 各社の報告値（手数料控除後・経理が使う値）
}

/** 日別の課金額（課金台帳）。Appleの会計月で集計し直すため日単位で持つ。 */
export interface DailyPurchase { day: string; apple: number; google: number; stripe: number; inappUnknown: number }

/**
 * Appleの会計月（App Store の支払・財務報告の月）。暦月とずれる。
 * 会計年度は9月最終土曜の翌日に始まり、各四半期は 5週・4週・4週。53週の年は9月が5週になる。
 * 例: 2026年10月 = 2026-09-27〜2026-10-31、11月 = 11-01〜11-28、12月 = 11-29〜12-26。
 */
export function appleFiscalMonthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const fiscalYearStartYear = m >= 10 ? y : y - 1; // 10月始まり
  const lastSaturdayOfSeptember = (year: number) => {
    const d = new Date(Date.UTC(year, 8, 30));
    while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() - 1);
    return d;
  };
  const start = lastSaturdayOfSeptember(fiscalYearStartYear);
  start.setUTCDate(start.getUTCDate() + 1);
  const yearEnd = lastSaturdayOfSeptember(fiscalYearStartYear + 1);
  const index = (m + 2) % 12; // 10月=0 … 9月=11
  const weeks = [5, 4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4];
  const cursor = new Date(start);
  for (let i = 0; i < index; i++) cursor.setUTCDate(cursor.getUTCDate() + weeks[i] * 7);
  const end = new Date(cursor);
  end.setUTCDate(end.getUTCDate() + weeks[index] * 7 - 1);
  if (index === 11) end.setTime(yearEnd.getTime()); // 53週の年は9月で吸収
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  return { start: ymd(cursor), end: ymd(end) };
}

/** 日別の課金額を月の購入額にまとめる。Google・Stripeは暦月（日本時間）、AppleはAppleの会計月。 */
export function monthlyFromDaily(daily: DailyPurchase[], months: string[]): MonthlyPurchase[] {
  return months.map((month) => {
    const apple = appleFiscalMonthRange(month);
    const inMonth = daily.filter((d) => d.day.slice(0, 7) === month);
    const inApple = daily.filter((d) => d.day >= apple.start && d.day <= apple.end);
    const sum = (rows: DailyPurchase[], key: keyof Omit<DailyPurchase, "day">) => rows.reduce((total, d) => total + d[key], 0);
    return { month, apple: sum(inApple, "apple"), google: sum(inMonth, "google"), stripe: sum(inMonth, "stripe"), inappUnknown: sum(inMonth, "inappUnknown") + sum(inApple, "inappUnknown") };
  });
}

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

// 日本時間の日付と時（日本は夏時間が無いため +9時間で正確に出せる。Intl を毎回作らない）。
const jstParts = (iso: string) => {
  const d = new Date(Date.parse(iso) + 9 * 3600000);
  return { day: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
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
  // 各社の報告値があればそれを使う（経理と同じ値）。無ければ課金台帳から推定する。
  if (p.reported) {
    const { apple, google, stripe } = p.reported;
    return { apple, google, stripe, total: apple + google + stripe };
  }
  const apple = Math.round(p.apple * (1 - STORE_FEE_RATE));
  const google = Math.round(p.google * (1 - STORE_FEE_RATE));
  const stripe = Math.round(p.stripe);
  return { apple, google, stripe, total: apple + google + stripe };
}

/** 月の確定売上。前月末と当月末の残高がそろい、購入額が各社の報告値の月は確定。当月（最新の記録で計算）と購入額が推定の月は暫定。 */
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
      p?.reported ? "購入額は各社の報告値" : "購入額は課金台帳からの推定（各社の報告値を登録すると経理と一致）",
      !p?.reported && p && p.inappUnknown > 0 ? "購入元未取得のアプリ内課金があります" : "",
    ].filter(Boolean);
    // 「確定」は月末残高がそろい、かつ購入額が各社の報告値の月だけ。
    // 課金台帳からの推定（Google は 2026-10 で報告より約25%多かった）のままでは経理と一致しないため暫定とする。
    const confirmed = month !== currentMonth && Boolean(p?.reported);
    return { ...base, status: confirmed ? "confirmed" : "provisional", note: notes.join("・"), purchase, opening: o, closing: c, revenue, revenueExcludingTax: excludingTax(revenue.total) };
  });

  return { latest: latestSnapshot ? { snapshotAt: latestSnapshot.snapshotAt, ...valueSnapshot(latestSnapshot) } : null, monthEnds, months: result };
}

const tsIso = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "object" && "value" in (value as Record<string, unknown>)) return String((value as { value: unknown }).value);
  return String(value);
};

/**
 * includeTestUsers: テストユーザーを含めた残高の記録（includesTestUsers=true の行）で計算する。
 * 含めた記録は 2026-11-12 から。経理の基準値（11/1）はテストユーザーを除いた値なので、含める側には使わない。
 */
export async function loadBalances(months: string[], includeTestUsers = false): Promise<BalancesResult> {
  const projectId = process.env.BIGQUERY_PROJECT_ID;
  const dataset = process.env.BIGQUERY_DATASET;
  if (!projectId || !dataset) throw new Error("BigQueryの環境変数が設定されていません");
  const { BigQuery } = await import("@google-cloud/bigquery");
  const bigquery = new BigQuery({ projectId });
  const location = process.env.BIGQUERY_LOCATION || "asia-northeast1";
  const maximumBytesBilled = process.env.BIGQUERY_MAX_BYTES_BILLED || "1073741824";
  const from = `${months[0]}-01`;
  const t = (name: string) => `\`${projectId}.${dataset}.${name}\``;
  const run = async (query: string) => (await bigquery.query({ location, params: { from, includeTestUsers }, maximumBytesBilled, query }))[0] as Array<Record<string, unknown>>;
  const [snapRows, purchaseRows, reportedRows] = await Promise.all([
    run(`SELECT * FROM ${t("balance_snapshots")} WHERE DATE(snapshotAt) >= DATE_SUB(DATE(@from), INTERVAL 1 DAY)
         AND COALESCE(includesTestUsers, FALSE) = @includeTestUsers ORDER BY snapshotAt`),
    // Appleの会計月は暦月より前に始まることがあるため、1週間前から日別で取る。
    run(`SELECT FORMAT_DATE("%Y-%m-%d", DATE(\`at\`, "Asia/Tokyo")) AS day,
           SUM(IF(vendor = "apple", amount, 0)) AS apple,
           SUM(IF(vendor = "google", amount, 0)) AS google,
           SUM(IF(channel = "webstore", amount, 0)) AS stripe,
           SUM(IF(channel = "inapp" AND vendor IS NULL, amount, 0)) AS inappUnknown
         FROM ${t("payments_current_range")}(DATE_SUB(DATE(@from), INTERVAL 7 DAY), CURRENT_DATE("Asia/Tokyo"))
         WHERE ${testUserCondition()}
         GROUP BY day`),
    // 各社の報告値（手入力。runbook-2026-11/set-platform-purchases.sh）。未作成なら空。
    run(`SELECT month, apple, google, stripe FROM ${t("platform_purchases")}`).catch(() => []),
  ]);
  const n = (v: unknown) => Number(v) || 0;
  const snapshots: BalanceSnapshot[] = snapRows.map((r) => ({
    snapshotAt: tsIso(r.snapshotAt) ?? "", source: String(r.source ?? ""),
    appleCoin: n(r.appleCoin), googleCoin: n(r.googleCoin), legacyCoin: n(r.legacyCoin), rewardPoint: n(r.rewardPoint),
    ticketGokitaku: n(r.ticketGokitaku), ticketPremium: n(r.ticketPremium), ticketRandom: n(r.ticketRandom), ticketCheki: n(r.ticketCheki), ticketChekiFree: n(r.ticketChekiFree),
  })).filter((s) => s.snapshotAt);
  const daily: DailyPurchase[] = purchaseRows.map((r) => ({ day: String(r.day), apple: n(r.apple), google: n(r.google), stripe: n(r.stripe), inappUnknown: n(r.inappUnknown) }));
  const reported = new Map(reportedRows.map((r) => [String(r.month), { apple: n(r.apple), google: n(r.google), stripe: n(r.stripe) }]));
  const purchases = monthlyFromDaily(daily, months).map((p) => ({ ...p, reported: reported.get(p.month) ?? null }));
  return computeBalances(snapshots, purchases, months, new Date());
}
