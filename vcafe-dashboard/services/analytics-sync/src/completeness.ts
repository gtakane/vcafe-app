/**
 * 取りこぼしの検知（2026-11追加）。
 *
 * 2026-10-20 は丸1日分のご帰宅が取り込まれていなかったが、同期の記録は ok のままで、
 * 3週間気づけなかった。本番の件数とダッシュボード側の件数を営業日ごとに比べ、
 * 食い違いがあればその日を取り込み直し、結果を dq_results に残す。
 *
 * 本番の件数にはテストユーザーの分が含まれ、ダッシュボード側は除外しているため、
 * 少しの差（既定: 5件または5%の大きい方まで）は正常とみなす。
 */

export interface DayCount { day: string; production: number; dashboard: number }
export type CompletenessStatus = "pass" | "warn" | "fail";

export const COMPLETENESS_DAYS = 7;

export function allowedGap(production: number): number {
  return Math.max(5, Math.ceil(production * 0.05));
}

/** その日の状態。ダッシュボード側が本番より明らかに少ない日だけを問題とする。 */
export function judgeDay(count: DayCount): CompletenessStatus {
  const gap = count.production - count.dashboard;
  if (gap <= allowedGap(count.production)) return "pass";
  // 丸ごと欠けている、または2割以上欠けている日は重大
  if (count.dashboard === 0 || gap > count.production * 0.2) return "fail";
  return "warn";
}

/** 営業日 D（JST 2:00〜翌2:00）を UTC の時刻範囲にする。 */
export function businessDayRange(day: string): { start: Date; end: Date } {
  const start = new Date(`${day}T02:00:00+09:00`);
  return { start, end: new Date(start.getTime() + 86400000) };
}

/** 判定対象の営業日（今日を除く直近N日、古い順）。今日の営業日はまだ終わっていないため含めない。 */
export function recentBusinessDays(now: Date, days = COMPLETENESS_DAYS): string[] {
  const today = new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10); // JST-2h の日付 = 営業日
  const base = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => new Date(base - (days - i) * 86400000).toISOString().slice(0, 10));
}
