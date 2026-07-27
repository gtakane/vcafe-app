// 予約通知のスキーマ非依存な純ロジック（対象営業日の算出・メイド別集約・DM本文整形・
// メイド↔Discord対応の解決・冪等キー）。本番の予約スキーマに依存しないので単体テスト可能。

export interface ReservationEntry {
  id: string;
  maidId: string; // 分からなければ "" 。その場合はニックネームで対応付ける。
  maidNickname: string;
  at: string; // 予約されたお給仕時刻（ISO）
  customerLabel?: string; // 任意（お客様名など）。表示可否は運用判断。
}

export interface MaidReservationGroup {
  key: string; // maidId優先、無ければ nick:ニックネーム
  maidId: string;
  maidNickname: string;
  entries: ReservationEntry[];
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** JST(+9h)での 'YYYY-MM-DD'。 */
export function jstDateStr(at: Date): string {
  const d = new Date(at.getTime() + 9 * 3_600_000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/**
 * 通知対象の営業日と、その実時刻ウィンドウ [start, end) を返す。
 * 営業時間は19:00〜翌02:00のため、営業日Dは実時刻 [D 02:00 JST, D+1 02:00 JST) に対応する
 * （lib/metrics.ts businessDateJst と整合：at-2h の日付が営業日）。
 * 00:00に実行して当日(offset=0)の予約お給仕を事前通知する用途を想定。
 */
export function windowForBusinessDay(day: string): { day: string; start: Date; end: Date } {
  const start = new Date(`${day}T02:00:00+09:00`);
  const end = new Date(start.getTime() + 24 * 3_600_000);
  return { day, start, end };
}

export function businessDayWindowJst(now: Date, offsetDays = 0): { day: string; start: Date; end: Date } {
  return windowForBusinessDay(addDays(jstDateStr(now), offsetDays));
}

/** JSTの "HH:MM"。 */
export function jstTime(at: string): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at));
}

export function maidKey(maidId: string, maidNickname: string): string {
  return maidId ? maidId : `nick:${maidNickname || "unknown"}`;
}

/** メイド別に集約し、時刻昇順に整列する。 */
export function groupByMaid(entries: ReservationEntry[]): MaidReservationGroup[] {
  const map = new Map<string, MaidReservationGroup>();
  for (const entry of entries) {
    const key = maidKey(entry.maidId, entry.maidNickname);
    const group = map.get(key) || { key, maidId: entry.maidId, maidNickname: entry.maidNickname, entries: [] };
    group.entries.push(entry);
    // ニックネームが後から埋まるケースに対応。
    if (!group.maidNickname && entry.maidNickname) group.maidNickname = entry.maidNickname;
    map.set(key, group);
  }
  for (const group of map.values()) group.entries.sort((a, b) => a.at.localeCompare(b.at));
  return [...map.values()];
}

/** メイドへ送るDM本文。showCustomer=false なら人数のみでお客様名は伏せる。 */
export function formatMaidMessage(day: string, group: MaidReservationGroup, showCustomer = false): string {
  const lines = group.entries.map((entry) => {
    const time = jstTime(entry.at);
    return showCustomer && entry.customerLabel ? `・${time}〜（${entry.customerLabel}様）` : `・${time}〜`;
  });
  const header = `🌸 ${group.maidNickname || "メイド"}さん、${day} の予約お給仕のお知らせです。`;
  const footer = `合計 ${group.entries.length} 件のご予約が入っています。よろしくお願いします！`;
  return [header, "", ...lines, "", footer].join("\n");
}

/** (営業日, メイドキー) の冪等キー。二重送信防止の記録に使う。 */
export function notificationDocId(day: string, key: string): string {
  return `${day}__${key}`.replace(/[/#?]/g, "_");
}

export interface MaidDiscordMapping {
  byMaidId: Map<string, string>; // maidId -> discordUserId
  byNickname: Map<string, string>; // nickname -> discordUserId
}

/** メイドのDiscordユーザーIDを解決する（maidId優先、無ければニックネーム）。
 *  ニックネームは日本語のUnicode正規化差（NFC/NFD）で一致漏れしないようNFCに正規化して比較する。 */
export function resolveDiscordId(group: MaidReservationGroup, mapping: MaidDiscordMapping): string | undefined {
  if (group.maidId && mapping.byMaidId.has(group.maidId)) return mapping.byMaidId.get(group.maidId);
  const nick = group.maidNickname ? group.maidNickname.normalize("NFC") : "";
  if (nick && mapping.byNickname.has(nick)) return mapping.byNickname.get(nick);
  return undefined;
}
