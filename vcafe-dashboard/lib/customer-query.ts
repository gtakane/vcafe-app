// ユーザーデータベースの絞り込み・並び替え（画面側で全会員に対して即時に行う純関数）。
//
// 旧実装は条件を1つ変えるたびに BigQuery へ問い合わせ直しており、
//   - 毎回 payments_current（全期間）を集計し直すため遅い
//   - 未設定(NULL)が昇順・降順どちらでも末尾に固定され、0 も「—」表示で区別できず並びが崩れて見える
//   - ランクが文字コード順で、上位→下位の順にならない
//   - 日付の絞り込みが登録日だけ、条件は「すべてAND」の固定
// という問題があった。全会員（数千件）を一度だけ読み込み、ここで処理する。

import type { Customer } from "./types";

export type CustomerFieldKind = "text" | "select" | "number" | "money" | "date" | "gender" | "year" | "boolean";

export interface CustomerField {
  key: string;
  label: string;
  kind: CustomerFieldKind;
}

export type CustomerRecord = Customer & { paying?: boolean };

/** 画面に出す列・絞り込みに使える項目。 */
export const CUSTOMER_FIELDS: CustomerField[] = [
  { key: "name", label: "ユーザー名", kind: "text" },
  { key: "id", label: "会員ID", kind: "text" },
  { key: "rank", label: "ランク", kind: "select" },
  { key: "gender", label: "性別", kind: "gender" },
  { key: "birthYear", label: "生年", kind: "year" },
  { key: "registeredAt", label: "登録日", kind: "date" },
  { key: "lastVisitAt", label: "最終ご帰宅日", kind: "date" },
  { key: "totalVisitAmount", label: "累計ご帰宅", kind: "number" },
  { key: "consecutiveVisitDays", label: "連続ご帰宅日数", kind: "number" },
  { key: "maxConsecutiveVisitDays", label: "最大連続日数", kind: "number" },
  { key: "paying", label: "課金の有無", kind: "boolean" },
  { key: "paymentCount", label: "課金回数(通算)", kind: "number" },
  { key: "paymentAmount", label: "課金額(通算)", kind: "money" },
  { key: "lastPaymentAt", label: "最終課金日", kind: "date" },
  { key: "purchasedItemQuantity", label: "アイテム購入数", kind: "number" },
  { key: "purchasedItemCoin", label: "アイテム購入額(コイン)", kind: "number" },
  { key: "purchasedItemRewardPoint", label: "アイテム購入額(リワードP)", kind: "number" },
  { key: "lastPurchasedItemAt", label: "最終アイテム購入日", kind: "date" },
  { key: "presentAmount", label: "プレゼント回数", kind: "number" },
  { key: "lastPresentAt", label: "最終プレゼント日", kind: "date" },
  { key: "coinApple", label: "Appleコイン残高", kind: "number" },
  { key: "coinGoogle", label: "Googleコイン残高", kind: "number" },
  { key: "coin", label: "旧コイン残高", kind: "number" },
  { key: "rewardPoint", label: "リワードP残高", kind: "number" },
];

export const fieldOf = (key: string): CustomerField | undefined => CUSTOMER_FIELDS.find((f) => f.key === key);

/** ランクは上位→下位の順で並べる。知らない値は既知の後ろに五十音・アルファベット順。 */
export const RANK_ORDER = [
  "ダイヤモンド", "プラチナ", "ゴールド", "シルバー", "ブロンズ", "レギュラー",
  "diamond", "platinum", "gold", "silver", "bronze", "regular",
  "未設定",
];

function rankIndex(rank: unknown): number {
  const value = String(rank ?? "").trim();
  const index = RANK_ORDER.findIndex((r) => r.toLowerCase() === value.toLowerCase());
  return index === -1 ? RANK_ORDER.length - 1 : index; // 未知は「未設定」の直前扱い（同順位内は文字順）
}

/** 条件の演算子。 */
export type ConditionOp =
  | "contains" // 文字を含む
  | "equals" // 一致（選択肢）
  | "between" // 数値・日付の範囲（片側だけでも可）
  | "withinDays" // 日付が今日からN日以内
  | "olderThanDays" // 日付が今日からN日以上前
  | "isEmpty" // 未設定
  | "isNotEmpty"; // 設定あり

export interface Condition {
  id: string;
  field: string;
  op: ConditionOp;
  a?: string; // 値・下限・開始日・日数
  b?: string; // 上限・終了日
}

export type CombineMode = "and" | "or";

/** 項目の種類ごとに選べる演算子。 */
export function opsFor(kind: CustomerFieldKind): Array<{ op: ConditionOp; label: string }> {
  switch (kind) {
    case "text": return [{ op: "contains", label: "を含む" }, { op: "isEmpty", label: "が未設定" }];
    case "boolean": return [{ op: "equals", label: "が" }];
    case "select": case "gender": return [{ op: "equals", label: "が" }, { op: "isEmpty", label: "が未設定" }];
    case "date": return [
      { op: "between", label: "が期間内" },
      { op: "withinDays", label: "が今日から○日以内" },
      { op: "olderThanDays", label: "が今日から○日以上前" },
      { op: "isEmpty", label: "が未設定" },
      { op: "isNotEmpty", label: "が設定あり" },
    ];
    default: return [{ op: "between", label: "が範囲内" }, { op: "isEmpty", label: "が未設定" }, { op: "isNotEmpty", label: "が設定あり" }];
  }
}

const isBlank = (value: unknown) => value === null || value === undefined || value === "";
const toNumber = (value: string | undefined) => (value === undefined || value.trim() === "" ? null : Number(value));

/** JSTの "YYYY-MM-DD"。 */
export function jstDay(iso: string): string {
  // 全会員×条件の数だけ呼ばれるため、Intl.DateTimeFormat を作らず時差の足し算で出す（日本は夏時間なし）。
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t + 9 * 3600000).toISOString().slice(0, 10);
}

function dayDiff(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86400000);
}

export function valueOf(customer: CustomerRecord, key: string): unknown {
  if (key === "paying") return Boolean(customer.lastPaymentAt) || Number(customer.paymentCount || 0) > 0;
  return (customer as unknown as Record<string, unknown>)[key];
}

/** 1つの条件を満たすか。値が未入力の条件は「条件なし」として常に真。 */
export function matchesCondition(customer: CustomerRecord, condition: Condition, today: string): boolean {
  const field = fieldOf(condition.field);
  if (!field) return true;
  const value = valueOf(customer, field.key);
  if (condition.op === "isEmpty") return isBlank(value);
  if (condition.op === "isNotEmpty") return !isBlank(value);

  switch (field.kind) {
    case "text": {
      const needle = (condition.a || "").trim().toLowerCase();
      return !needle || String(value ?? "").toLowerCase().includes(needle);
    }
    case "select": case "gender": {
      if (!condition.a) return true;
      return String(value ?? "") === condition.a;
    }
    case "boolean": {
      if (!condition.a) return true;
      return Boolean(value) === (condition.a === "yes");
    }
    case "date": {
      if (isBlank(value)) return false;
      const day = jstDay(String(value));
      if (condition.op === "withinDays" || condition.op === "olderThanDays") {
        const days = toNumber(condition.a);
        if (days === null || !Number.isFinite(days)) return true;
        const elapsed = dayDiff(day, today);
        return condition.op === "withinDays" ? elapsed >= 0 && elapsed <= days : elapsed >= days;
      }
      if (condition.a && day < condition.a) return false;
      if (condition.b && day > condition.b) return false;
      return true;
    }
    default: {
      // 数値は未設定を0として比較する（「課金額 0円以上」で全員が出る素直な挙動）。
      const n = Number(value ?? 0) || 0;
      const min = toNumber(condition.a), max = toNumber(condition.b);
      if (min !== null && Number.isFinite(min) && n < min) return false;
      if (max !== null && Number.isFinite(max) && n > max) return false;
      return true;
    }
  }
}

function isActive(condition: Condition): boolean {
  if (condition.op === "isEmpty" || condition.op === "isNotEmpty") return true;
  return Boolean((condition.a && condition.a.trim()) || (condition.b && condition.b.trim()));
}

/**
 * 条件で絞り込む。search（名前・会員ID）は常にAND。
 * 入力途中で値が空の条件は無視する（ORのときに全員が一致してしまうのを防ぐ）。
 */
export function filterCustomers(customers: CustomerRecord[], options: { search?: string; conditions: Condition[]; mode: CombineMode; today: string }): CustomerRecord[] {
  const needle = (options.search || "").trim().toLowerCase();
  const active = options.conditions.filter(isActive);
  return customers.filter((customer) => {
    if (needle && !`${customer.name} ${customer.id}`.toLowerCase().includes(needle)) return false;
    if (!active.length) return true;
    return options.mode === "and"
      ? active.every((c) => matchesCondition(customer, c, options.today))
      : active.some((c) => matchesCondition(customer, c, options.today));
  });
}

/**
 * 並び替え。未設定は昇順・降順どちらでも常に末尾（「未設定が先頭に来て見たい値が埋もれる」を防ぐ）。
 * 数値は数値、日付は時刻、ランクは上位→下位、文字は五十音で比較する。同順位は登録日の古い順で安定させる。
 */
export function sortCustomers(customers: CustomerRecord[], key: string, dir: "asc" | "desc"): CustomerRecord[] {
  const field = fieldOf(key);
  const kind = field?.kind ?? "text";
  const sign = dir === "desc" ? -1 : 1;
  const comparable = (customer: CustomerRecord): number | string | null => {
    const value = valueOf(customer, key);
    if (key === "rank") return isBlank(value) ? null : rankIndex(value);
    if (kind === "boolean") return value ? 1 : 0;
    if (isBlank(value)) return null;
    if (kind === "date") { const t = Date.parse(String(value)); return Number.isNaN(t) ? null : t; }
    if (kind === "number" || kind === "money" || kind === "year") { const n = Number(value); return Number.isFinite(n) ? n : null; }
    return String(value);
  };
  return customers
    .map((customer, index) => ({ customer, index, v: comparable(customer) }))
    .sort((x, y) => {
      if (x.v === null && y.v === null) return x.index - y.index;
      if (x.v === null) return 1;
      if (y.v === null) return -1;
      let cmp = typeof x.v === "number" && typeof y.v === "number" ? x.v - y.v : String(x.v).localeCompare(String(y.v), "ja");
      if (key === "rank" && cmp === 0) cmp = String(valueOf(x.customer, key)).localeCompare(String(valueOf(y.customer, key)), "ja");
      return cmp !== 0 ? cmp * sign : x.index - y.index;
    })
    .map((x) => x.customer);
}

/** 画面の表示値。数値の0は「0」、未設定だけを「—」にする（両者を見分けられるようにする）。 */
export function displayValue(customer: CustomerRecord, field: CustomerField, format: { number: (n: number) => string; yen: (n: number) => string; date: (iso: string) => string; gender: (g: string) => string }): string {
  const value = valueOf(customer, field.key);
  if (field.kind === "boolean") return value ? "あり" : "なし";
  if (isBlank(value)) return "—";
  switch (field.kind) {
    case "number": return format.number(Number(value) || 0);
    case "money": return format.yen(Number(value) || 0);
    case "year": return Number(value) ? String(Number(value)) : "—";
    case "date": return format.date(String(value));
    case "gender": return format.gender(String(value));
    default: return String(value);
  }
}
