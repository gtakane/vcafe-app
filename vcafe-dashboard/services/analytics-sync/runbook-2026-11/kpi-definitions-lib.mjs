// 月次指標の定義（2026-11-12 にユーザーから指定）で、1か月分のご帰宅記録を集計する純関数。
// kpi-definitions.mjs（本番Firestoreを読む確認用スクリプト）から使う。個人を特定する値は返さない。
//
//   通常ご帰宅 … 20分=1件、40分=2件、20分未満=0.5件（滞在時間÷20分。20分未満は0.5件）
//   予約ご帰宅・お試しご帰宅・無料ご帰宅 … それぞれ1件で、別枠として数える
//   合計ご帰宅数（延べ客数） … 上の4つの合計
//   UU … その月に通常ご帰宅をしたユーザー（テストユーザーを含む）
//   回数帯 … その月の通常ご帰宅の回数（実回数）で分けた人数と、その人たちの合計ご帰宅数
//   お試し … お試しご帰宅の件数
//   お給仕時間 … メイドがご帰宅でお給仕した時間の合計

export const BUCKETS = [
  { key: "b1", label: "1回", min: 1, max: 1 },
  { key: "b2", label: "2〜4回", min: 2, max: 4 },
  { key: "b3", label: "5〜19回", min: 5, max: 19 },
  { key: "b4", label: "20〜49回", min: 20, max: 49 },
  { key: "b5", label: "50回〜", min: 50, max: Infinity },
];

const truthy = (value) => value === true || value === "true";

/** ご帰宅の区分。lib/metrics.ts classifyVisit と同じ順で判定する（無料→お試し→予約→通常）。 */
export function visitKind(data) {
  const ticket = String(data.usedTicketItemId || "ATCOIN");
  if (truthy(data.isFreeEntry) || ticket === "freeGokitaku") return "free";
  if (ticket === "trial10minutes") return "trial";
  if (String(data.roomType || "") === "reservation") return "reservation";
  return "normal";
}

export function minutesOf(data) {
  const minutes = Number(data.initialTime);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 20;
}

/** 通常ご帰宅の件数換算。 */
export function normalUnits(minutes) {
  return minutes < 20 ? 0.5 : minutes / 20;
}

/**
 * 1か月分を集計する。
 * @param {Array<{ userId: string, data: Record<string, unknown> }>} visits
 * @param {Set<string>} testUserIds
 * @param {{ includeTestUsers: boolean }} options
 */
export function summarizeMonth(visits, testUserIds, { includeTestUsers }) {
  const rows = includeTestUsers ? visits : visits.filter((v) => !testUserIds.has(v.userId));
  const result = {
    normalCount: 0, normalUnits: 0, reservation: 0, trial: 0, free: 0, total: 0,
    minutesAll: 0, minutesNormal: 0, minutesHistogram: new Map(),
    uu: 0, uuTest: 0, buckets: {},
  };
  const perUser = new Map();
  for (const { userId, data } of rows) {
    const kind = visitKind(data);
    const minutes = minutesOf(data);
    result.minutesAll += minutes;
    const user = perUser.get(userId) || { normalCount: 0, units: 0 };
    if (kind === "normal") {
      const units = normalUnits(minutes);
      result.normalCount += 1;
      result.normalUnits += units;
      result.minutesNormal += minutes;
      result.minutesHistogram.set(minutes, (result.minutesHistogram.get(minutes) || 0) + 1);
      user.normalCount += 1;
      user.units += units;
    } else {
      result[kind] += 1;
      user.units += 1;
    }
    perUser.set(userId, user);
  }
  result.total = result.normalUnits + result.reservation + result.trial + result.free;
  for (const bucket of BUCKETS) result.buckets[bucket.key] = { users: 0, normalCount: 0, units: 0 };
  for (const [userId, user] of perUser) {
    if (user.normalCount === 0) continue;
    result.uu += 1;
    if (testUserIds.has(userId)) result.uuTest += 1;
    const bucket = BUCKETS.find((b) => user.normalCount >= b.min && user.normalCount <= b.max);
    const slot = result.buckets[bucket.key];
    slot.users += 1;
    slot.normalCount += user.normalCount;
    slot.units += user.units;
  }
  return result;
}

/** 営業月（JST 2:00 区切り）の範囲。 */
export function businessMonthRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const start = new Date(`${ym}-01T02:00:00+09:00`);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { start, end: new Date(`${next}-01T02:00:00+09:00`) };
}
