/**
 * 未使用残高（前受金）の集計。経理資料「Vあっと売上計上関連（経営管理報告用）」の残高の出し方に合わせる。
 *   コイン: users.coinApple / coinGoogle / coin（旧SB経由） / rewardPoint の合計
 *   チケット: users/{id}/userItems の category=ticket を、アイテム名・種類名で分類して所持枚数を合計
 *     ご帰宅チケット / プレミアムご帰宅チケット / ランダムご帰宅チケット / 記念撮影チケット（1枚）
 *     記念撮影チケットの「新規登録プレゼント」は無償のため別に数える（円換算0）
 * テストユーザー（users.testUser / testUesrFlag）は既定で除く（includeTestUsers で含めた合計も出せる）。
 * excludedTestUsers はテストユーザーの人数（含めた合計でも人数として残す）。個人単位の値は保存しない。
 */

export interface BalanceTotals {
  users: number;
  excludedTestUsers: number;
  appleCoin: number;
  googleCoin: number;
  legacyCoin: number;
  rewardPoint: number;
  ticketGokitaku: number;
  ticketPremium: number;
  ticketRandom: number;
  ticketCheki: number;
  ticketChekiFree: number;
  ticketOther: number;
}

export interface UserBalanceSource { id: string; data: Record<string, unknown> }
export interface UserItemSource { userId: string; data: Record<string, unknown> }

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const isTrue = (v: unknown) => v === true || v === 1 || (typeof v === "string" && v.toLowerCase() === "true");

export function isTestUser(data: Record<string, unknown>): boolean {
  return isTrue(data.testUser) || isTrue(data.testUesrFlag);
}

/** チケットの分類。経理シートの判定式と同じく、アイテム名と種類名で決める。 */
export function ticketKind(itemName: unknown, variationName: unknown): keyof Pick<BalanceTotals, "ticketGokitaku" | "ticketPremium" | "ticketRandom" | "ticketCheki" | "ticketChekiFree" | "ticketOther"> {
  const name = String(itemName ?? "").trim();
  const variation = String(variationName ?? "").trim();
  if (name === "記念撮影チケット") return variation === "新規登録プレゼント" ? "ticketChekiFree" : variation === "1枚" ? "ticketCheki" : "ticketOther";
  if (name === "ご帰宅チケット") return "ticketGokitaku";
  if (name === "プレミアムご帰宅チケット") return "ticketPremium";
  if (name === "ランダムご帰宅チケット") return "ticketRandom";
  return "ticketOther";
}

export function summarizeBalances(users: UserBalanceSource[], items: UserItemSource[], options: { includeTestUsers?: boolean } = {}): BalanceTotals {
  const totals: BalanceTotals = {
    users: 0, excludedTestUsers: 0, appleCoin: 0, googleCoin: 0, legacyCoin: 0, rewardPoint: 0,
    ticketGokitaku: 0, ticketPremium: 0, ticketRandom: 0, ticketCheki: 0, ticketChekiFree: 0, ticketOther: 0,
  };
  const testUsers = new Set<string>();
  for (const user of users) {
    if (isTestUser(user.data)) {
      totals.excludedTestUsers += 1;
      if (!options.includeTestUsers) { testUsers.add(user.id); continue; }
    }
    totals.users += 1;
    totals.appleCoin += num(user.data.coinApple);
    totals.googleCoin += num(user.data.coinGoogle);
    totals.legacyCoin += num(user.data.coin);
    totals.rewardPoint += num(user.data.rewardPoint);
  }
  const knownUsers = new Set(users.map((u) => u.id));
  for (const item of items) {
    if (item.data.category !== "ticket") continue;
    if (testUsers.has(item.userId) || !knownUsers.has(item.userId)) continue;
    totals[ticketKind(item.data.itemName, item.data.variationName)] += num(item.data.quantity);
  }
  return totals;
}
