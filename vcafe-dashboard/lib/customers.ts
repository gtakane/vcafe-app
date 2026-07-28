import type { Customer } from "./types";
import { customers as mockCustomers } from "./mock-data.ts";

// ユーザーDBはダッシュボード上部の期間フィルタから独立して「全会員」を扱う。
// 既定は登録日(registrationDate)の昇順＝古い会員から。

export interface NumericFilter {
  key: string; // CUSTOMER_NUMERIC_KEYS のいずれか
  min?: number;
  max?: number;
}

export interface CustomerQuery {
  q?: string;
  rank?: string;
  gender?: string;
  paying?: "yes" | "no" | "";
  regFrom?: string; // YYYY-MM-DD
  regTo?: string;
  numeric?: NumericFilter[]; // 数値指標の範囲絞り込み（例: 課金額(通算) 10万円以上）
  sort?: string;
  dir?: "asc" | "desc";
  limit?: number;
}

export interface CustomerListResult {
  total: number; // 条件に一致した総数
  returned: number; // 実際に返した件数（limitで打ち切られる場合がある）
  customers: Customer[];
}

export const CUSTOMER_SORT_KEYS = new Set([
  "registeredAt", "name", "rank", "gender", "birthYear", "lastVisitAt", "lastPaymentAt",
  "lastPurchasedItemAt", "lastPresentAt", "purchasedItemCoin", "purchasedItemQuantity",
  "presentAmount", "coin", "rewardPoint", "totalVisitAmount", "maxConsecutiveVisitDays",
  "paymentCount", "paymentAmount",
]);

// 数値範囲フィルタを許可する列（ホワイトリスト。SQLへはこの名前しか埋め込まない）。
export const CUSTOMER_NUMERIC_KEYS = new Set([
  "birthYear", "purchasedItemCoin", "purchasedItemQuantity", "presentAmount",
  "coin", "rewardPoint", "totalVisitAmount", "maxConsecutiveVisitDays",
  "paymentCount", "paymentAmount",
]);

// 未設定(NULL)は0として比較する（「課金額 0円以上」で全員が出る素直な挙動にする）。
function numericFilters(query: CustomerQuery): NumericFilter[] {
  return (query.numeric || []).filter((f) =>
    CUSTOMER_NUMERIC_KEYS.has(f.key) &&
    ((typeof f.min === "number" && Number.isFinite(f.min)) || (typeof f.max === "number" && Number.isFinite(f.max))));
}

const MAX_LIMIT = 5000;

function normalizeLimit(limit?: number) {
  const value = Number(limit) || 1000;
  return Math.min(Math.max(value, 1), MAX_LIMIT);
}

function filterMock(query: CustomerQuery): CustomerListResult {
  const q = (query.q || "").trim().toLowerCase();
  const matched = mockCustomers.filter((customer) => {
    if (q && !`${customer.name} ${customer.id}`.toLowerCase().includes(q)) return false;
    if (query.rank && customer.rank !== query.rank) return false;
    if (query.gender && customer.gender !== query.gender) return false;
    const paid = Boolean(customer.lastPaymentAt);
    if (query.paying === "yes" && !paid) return false;
    if (query.paying === "no" && paid) return false;
    const registered = customer.registeredAt ? customer.registeredAt.slice(0, 10) : "";
    if (query.regFrom && (!registered || registered < query.regFrom)) return false;
    if (query.regTo && (!registered || registered > query.regTo)) return false;
    for (const f of numericFilters(query)) {
      const value = Number(customer[f.key as keyof Customer] ?? 0) || 0;
      if (typeof f.min === "number" && value < f.min) return false;
      if (typeof f.max === "number" && value > f.max) return false;
    }
    return true;
  });
  const key = (CUSTOMER_SORT_KEYS.has(query.sort || "") ? query.sort : "registeredAt") as keyof Customer;
  const direction = query.dir === "desc" ? -1 : 1;
  const sorted = [...matched].sort((a, b) => {
    const av = a[key] ?? "", bv = b[key] ?? "";
    const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "ja");
    return cmp * direction;
  });
  const limit = normalizeLimit(query.limit);
  return { total: sorted.length, returned: Math.min(sorted.length, limit), customers: sorted.slice(0, limit) };
}

function isoOf(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "object" && "value" in (value as Record<string, unknown>)) return String((value as { value: unknown }).value);
  return String(value);
}

export async function loadCustomers(query: CustomerQuery): Promise<CustomerListResult> {
  if (process.env.ANALYTICS_BACKEND !== "bigquery") return filterMock(query);

  const projectId = process.env.BIGQUERY_PROJECT_ID;
  const dataset = process.env.BIGQUERY_DATASET;
  if (!projectId || !dataset) throw new Error("BigQueryの環境変数が設定されていません");
  const { BigQuery } = await import("@google-cloud/bigquery");
  const bigquery = new BigQuery({ projectId });
  const location = process.env.BIGQUERY_LOCATION || "asia-northeast1";
  const maximumBytesBilled = process.env.BIGQUERY_MAX_BYTES_BILLED || "1073741824";

  // 並び替えキーはホワイトリスト経由でのみSQLに埋め込む（インジェクション防止）。
  const sortKey = CUSTOMER_SORT_KEYS.has(query.sort || "") ? query.sort! : "registeredAt";
  const direction = query.dir === "desc" ? "DESC" : "ASC";
  const limit = normalizeLimit(query.limit);

  const conditions: string[] = [];
  const params: Record<string, string | number> = {};
  if (query.q) { conditions.push("(LOWER(c.name) LIKE @q OR LOWER(c.id) LIKE @q)"); params.q = `%${query.q.trim().toLowerCase()}%`; }
  if (query.rank) { conditions.push("c.rank = @rank"); params.rank = query.rank; }
  if (query.gender) { conditions.push("c.gender = @gender"); params.gender = query.gender; }
  if (query.regFrom) { conditions.push('DATE(c.registeredAt, "Asia/Tokyo") >= DATE(@regFrom)'); params.regFrom = query.regFrom; }
  if (query.regTo) { conditions.push('DATE(c.registeredAt, "Asia/Tokyo") <= DATE(@regTo)'); params.regTo = query.regTo; }
  if (query.paying === "yes") conditions.push("(c.lastPaymentAt IS NOT NULL OR p.paymentCount > 0)");
  if (query.paying === "no") conditions.push("(c.lastPaymentAt IS NULL AND COALESCE(p.paymentCount, 0) = 0)");
  numericFilters(query).forEach((f, index) => {
    // 課金2列はJOIN側(p)、それ以外はcustomers側(c)。列名はホワイトリスト済みのみ。
    const table = f.key === "paymentCount" || f.key === "paymentAmount" ? "p" : "c";
    const expr = `COALESCE(${table}.${f.key}, 0)`;
    if (typeof f.min === "number" && Number.isFinite(f.min)) { conditions.push(`${expr} >= @nmin${index}`); params[`nmin${index}`] = f.min; }
    if (typeof f.max === "number" && Number.isFinite(f.max)) { conditions.push(`${expr} <= @nmax${index}`); params[`nmax${index}`] = f.max; }
  });
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [rows] = await bigquery.query({
    location, params, maximumBytesBilled,
    query: `
      WITH pay AS (
        SELECT customerId, COUNT(*) AS paymentCount, SUM(amount) AS paymentAmount
        FROM \`${projectId}.${dataset}.payments_current\` GROUP BY customerId
      ), joined AS (
        SELECT c.*, COALESCE(p.paymentCount, 0) AS paymentCount, COALESCE(p.paymentAmount, 0) AS paymentAmount
        FROM \`${projectId}.${dataset}.customers_current\` c
        LEFT JOIN pay p ON p.customerId = c.id
        ${where}
      )
      SELECT (SELECT COUNT(*) FROM joined) AS total, TO_JSON_STRING(t) AS payload
      FROM joined t
      ORDER BY t.${sortKey} ${direction} NULLS LAST
      LIMIT ${limit}
    `,
  });

  const customers = rows.map((row) => {
    const value = JSON.parse(String(row.payload)) as Record<string, unknown>;
    return {
      ...value,
      registeredAt: isoOf(value.registeredAt),
      lastVisitAt: isoOf(value.lastVisitAt),
      lastPaymentAt: isoOf(value.lastPaymentAt),
      lastPurchasedItemAt: isoOf(value.lastPurchasedItemAt),
      lastPresentAt: isoOf(value.lastPresentAt),
    } as unknown as Customer;
  });
  const total = rows.length ? Number(rows[0].total) : 0;
  return { total, returned: customers.length, customers };
}
