// 月次指標（運営が毎月作っていた月次CSVと同じ項目）。2026-11-12 追加。
//
// 値の出どころ:
//   - 2026年10月以前 … 運営のCSV（monthly_kpi_history）を正とする。データから出し直した値と差がある項目には印を付ける
//   - 2026年11月以降 … 分析用データから自動で出す。メイド報酬だけは手入力（monthly_kpi_manual）
// 月は営業日（JST 2:00 区切り）でまとめる。会員数は暦月末時点。

export type KpiFormat = "yen" | "count" | "decimal" | "pct" | "hours" | "text";

export type KpiNumberKey =
  | "sales" | "visits" | "normal" | "reservation" | "free" | "unitPrice" | "photos" | "presentYen" | "uu" | "members"
  | "avgVisits" | "pur" | "arppu" | "arpu" | "newMembers" | "trial"
  | "b1Users" | "b2Users" | "b2Visits" | "b3Users" | "b3Visits" | "b4Users" | "b4Visits" | "b5Users" | "b5Visits"
  | "serveHours" | "maidReward" | "profit" | "costRate";
export type KpiTextKey = "events" | "url" | "joinedMaids" | "leftMaids";
export type KpiKey = KpiNumberKey | KpiTextKey;

export interface KpiColumn {
  key: KpiKey;
  label: string; // 画面・CSVの見出し（運営のCSVと同じ）
  format: KpiFormat;
  definition: string;
  /** 運営のCSVに無い列（画面だけに出す）。 */
  screenOnly?: boolean;
  /** アプリが集計した値でテストユーザーの切り替えが効かない。 */
  appAggregated?: boolean;
}

/** 列の並びは運営のCSVと同じ（screenOnly を除く）。 */
export const KPI_COLUMNS: KpiColumn[] = [
  { key: "sales", label: "売上", format: "yen", definition: "経理と同じ計上方法の売上（税抜。経理資料の「売上合計（税抜）」）。購入額＋前月末の未使用残高−当月末の未使用残高を税抜にしたもの。各社の報告額を登録するまでは暫定" },
  { key: "visits", label: "延べ客数", format: "decimal", definition: "通常ご帰宅の枠数（メイドお給仕ポータルの「ご帰宅枠数」と同じ。滞在時間÷20分、20分=1件・40分=2件・20分未満は0.5件）。2026年11月からは無料ご帰宅（1回を1件）も含める。予約・お試しは含めない" },
  { key: "normal", label: "うち通常", format: "decimal", definition: "通常ご帰宅（滞在時間÷20分で換算）。メイドお給仕ポータルの「ご帰宅枠数」の月合計にあたる（ポータルはテストユーザーを含む）", screenOnly: true },
  { key: "reservation", label: "うち予約", format: "count", definition: "予約ご帰宅（1回を1件）", screenOnly: true },
  { key: "free", label: "うち無料", format: "count", definition: "無料ご帰宅券・新規ユーザー無料・新人メイド無料（1回を1件。2026年11月6日開始）", screenOnly: true },
  { key: "unitPrice", label: "客単価", format: "yen", definition: "売上 ÷ 延べ客数" },
  { key: "photos", label: "フォト", format: "count", definition: "記念撮影の枚数" },
  { key: "presentYen", label: "プレゼント", format: "yen", definition: "プレゼントの金額（アプリのメイド月次実績の合計）", appAggregated: true },
  { key: "uu", label: "UU", format: "count", definition: "その月に通常ご帰宅をしたユーザーの人数" },
  { key: "members", label: "会員数", format: "count", definition: "月末までに登録した会員の数" },
  { key: "avgVisits", label: "平均ご帰宅数", format: "decimal", definition: "延べ客数 ÷ UU" },
  { key: "pur", label: "PUR", format: "pct", definition: "UU ÷ 会員数" },
  { key: "arppu", label: "ARPPU", format: "yen", definition: "売上 ÷ UU" },
  { key: "arpu", label: "ARPU", format: "yen", definition: "売上 ÷ 会員数" },
  { key: "newMembers", label: "増分", format: "count", definition: "会員数の前月からの増加（その月の新規登録数）" },
  { key: "trial", label: "お試し", format: "count", definition: "お試しご帰宅の件数" },
  { key: "b1Users", label: "1回", format: "count", definition: "その月に通常ご帰宅を1回したユーザーの数" },
  { key: "b2Users", label: "2〜4回", format: "count", definition: "その月に通常ご帰宅を2〜4回したユーザーの数" },
  { key: "b2Visits", label: "総数", format: "count", definition: "2〜4回のユーザーの通常ご帰宅の回数の合計" },
  { key: "b3Users", label: "5〜19", format: "count", definition: "その月に通常ご帰宅を5〜19回したユーザーの数" },
  { key: "b3Visits", label: "総数", format: "count", definition: "5〜19回のユーザーの通常ご帰宅の回数の合計" },
  { key: "b4Users", label: "20〜49", format: "count", definition: "その月に通常ご帰宅を20〜49回したユーザーの数" },
  { key: "b4Visits", label: "総数", format: "count", definition: "20〜49回のユーザーの通常ご帰宅の回数の合計" },
  { key: "b5Users", label: "50〜", format: "count", definition: "その月に通常ご帰宅を50回以上したユーザーの数" },
  { key: "b5Visits", label: "総数", format: "count", definition: "50回以上のユーザーの通常ご帰宅の回数の合計" },
  { key: "serveHours", label: "お給仕時間", format: "hours", definition: "ご帰宅の滞在時間の合計（メイドがご帰宅でお給仕した時間）" },
  { key: "maidReward", label: "メイド報酬", format: "yen", definition: "手入力（表のセルをクリックして入力）" },
  { key: "profit", label: "差額", format: "yen", definition: "売上 − メイド報酬" },
  { key: "costRate", label: "原価率", format: "pct", definition: "メイド報酬 ÷ 売上" },
  { key: "events", label: "出来事", format: "text", definition: "公式サイトのお知らせのうち、その月に公開された記事" },
  { key: "url", label: "URL", format: "text", definition: "出来事の記事のURL" },
  { key: "joinedMaids", label: "入店", format: "text", definition: "その月に初めてシフトに入ったメイド（出張お給仕を含む）" },
  { key: "leftMaids", label: "退店", format: "text", definition: "名簿で非稼働になっているメイドのうち、最後のシフトがその月だった人" },
];

/** 分析用データから出した、その月の基礎の値。 */
export interface AutoMonth {
  month: string;
  normal: number;
  normalVisits: number;
  reservation: number;
  trial: number;
  free: number;
  total: number;
  uu: number;
  buckets: { b1Users: number; b2Users: number; b2Visits: number; b3Users: number; b3Visits: number; b4Users: number; b4Visits: number; b5Users: number; b5Visits: number };
  photos: number;
  presentYen: number | null;
  serveMinutes: number;
  members: number | null;
  newMembers: number | null;
}

export interface MonthSales { yen: number; provisional: boolean; note: string }
export interface NewsItem { date: string; title: string; url: string }
export interface MaidMove { name: string; firstMonth: string | null; lastMonth: string | null; inactive: boolean }

export type HistoryRow = Partial<Record<KpiNumberKey, number | null>> & Partial<Record<KpiTextKey, string | null>> & {
  month: string;
  /** 2023年7月以前のCSVの「プレゼント」は金額ではなく件数。 */
  presentCount?: number | null;
};

export interface KpiCell {
  value: number | string | null;
  /** csv: 運営のCSV／auto: データから算出／manual: 手入力／derived: 表示している値（CSVを含む）から計算した比率 */
  source: "csv" | "auto" | "manual" | "derived" | "none";
  /** CSVの月で、データから出し直した値（比較用）。 */
  recomputed?: number | string | null;
  /** 手入力の値で上書きしたとき、上書き前の値（CSV・データ・計算）。 */
  original?: number | string | null;
  /** CSVの値と出し直した値が食い違う。 */
  differs?: boolean;
  provisional?: boolean;
  note?: string;
}

export interface KpiRow { month: string; cells: Record<KpiKey, KpiCell> }

/** 画面で手入力できる列（運営のCSVにある列すべて。画面だけの内訳列は除く）。 */
export const EDITABLE_KEYS: ReadonlySet<KpiKey> = new Set(KPI_COLUMNS.filter((c) => !c.screenOnly).map((c) => c.key));

/** 手入力の値。月 → 列 → 値。 */
export type KpiOverrides = Map<string, Map<KpiKey, number | string>>;

/**
 * 画面で入力された文字を値にする。空なら null（手入力を消す）。
 * 金額の ¥・円・桁区切り、件・h、括弧のマイナスを受け付ける。率は「69%」「69」「0.69」のどれでもよい（1より大きければ%とみなす）。
 */
export function parseKpiInput(column: Pick<KpiColumn, "format">, text: string): { ok: true; value: number | string | null } | { ok: false; error: string } {
  const raw = text.trim();
  if (!raw) return { ok: true, value: null };
  if (column.format === "text") {
    if (raw.length > 2000) return { ok: false, error: "2,000文字以内で入力してください" };
    return { ok: true, value: raw };
  }
  let cleaned = raw.normalize("NFKC").replace(/[¥￥,円件人回h\s]/g, "");
  const negative = /^\(.*\)$/.test(cleaned) || cleaned.startsWith("-") || cleaned.startsWith("▲");
  cleaned = cleaned.replace(/^[(▲-]+|\)$/g, "");
  const percent = cleaned.endsWith("%");
  cleaned = cleaned.replace(/%$/, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return { ok: false, error: "数値を入力してください（例: 1,983,558 / 69%）" };
  let value = Number(cleaned) * (negative ? -1 : 1);
  if (column.format === "pct" && (percent || Math.abs(value) > 1)) value /= 100;
  return { ok: true, value };
}

/** 延べ客数に無料ご帰宅を含め始める月（無料ご帰宅3種は2026年11月6日開始。それより前の月は通常ご帰宅だけ）。 */
export const FREE_IN_VISITS_FROM = "2026-11";

/** 延べ客数＝通常ご帰宅の枠数（＋2026年11月からは無料ご帰宅）。予約・お試しは含めない。 */
export function visitsOfMonth(auto: Pick<AutoMonth, "month" | "normal" | "free">): number {
  return auto.normal + (auto.month >= FREE_IN_VISITS_FROM ? auto.free : 0);
}

const ratio = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) || b === 0 ? null : a / b;

/** 月の指標をデータから出す（比率は基礎の値から計算する）。 */
export function autoValues(auto: AutoMonth | undefined, sales: MonthSales | undefined, maidReward: number | undefined): Partial<Record<KpiNumberKey, number | null>> {
  const salesYen = sales ? sales.yen : null;
  const reward = maidReward ?? null;
  const values: Partial<Record<KpiNumberKey, number | null>> = { sales: salesYen, maidReward: reward };
  if (auto) {
    Object.assign(values, {
      visits: visitsOfMonth(auto), normal: auto.normal, reservation: auto.reservation, free: auto.free, trial: auto.trial,
      photos: auto.photos, presentYen: auto.presentYen, uu: auto.uu, members: auto.members, newMembers: auto.newMembers,
      ...auto.buckets,
      serveHours: Math.round(auto.serveMinutes / 6) / 10,
      avgVisits: ratio(visitsOfMonth(auto), auto.uu),
      pur: ratio(auto.uu, auto.members),
    });
    values.unitPrice = ratio(salesYen, visitsOfMonth(auto));
    values.arppu = ratio(salesYen, auto.uu);
    values.arpu = ratio(salesYen, auto.members);
  }
  values.profit = salesYen != null && reward != null ? salesYen - reward : null;
  values.costRate = ratio(reward, salesYen);
  return values;
}

/**
 * 比率・差額の計算式（運営のCSVと同じ）。CSVにこの列が無い月は、表示している基礎の値
 * （CSVの値、無ければデータから算出した値）から計算する。例: 2026年7〜9月の ARPPU = CSVの売上 ÷ CSVの UU。
 */
export const DERIVED: Partial<Record<KpiNumberKey, { inputs: KpiNumberKey[]; compute: (v: Record<string, number>) => number | null }>> = {
  unitPrice: { inputs: ["sales", "visits"], compute: (v) => ratio(v.sales, v.visits) },
  avgVisits: { inputs: ["visits", "uu"], compute: (v) => ratio(v.visits, v.uu) },
  pur: { inputs: ["uu", "members"], compute: (v) => ratio(v.uu, v.members) },
  arppu: { inputs: ["sales", "uu"], compute: (v) => ratio(v.sales, v.uu) },
  arpu: { inputs: ["sales", "members"], compute: (v) => ratio(v.sales, v.members) },
  profit: { inputs: ["sales", "maidReward"], compute: (v) => v.sales - v.maidReward },
  costRate: { inputs: ["maidReward", "sales"], compute: (v) => ratio(v.maidReward, v.sales) },
};

/** CSVの値と出し直した値が「違う」とみなす幅。端数や丸めの違いでは印を付けない。 */
export function differs(format: KpiFormat, recorded: number, recomputed: number): boolean {
  const gap = Math.abs(recorded - recomputed);
  if (format === "pct") return gap > 0.001; // 0.1ポイント
  if (format === "count") return gap > Math.max(1, Math.abs(recorded) * 0.01);
  return gap > Math.max(0.5, Math.abs(recorded) * 0.01);
}

export function buildMonthlyKpi(input: {
  months: string[];
  auto: Map<string, AutoMonth>;
  sales: Map<string, MonthSales>;
  manualReward: Map<string, number>;
  history: Map<string, HistoryRow>;
  news: NewsItem[];
  maids: MaidMove[];
  /** これ以前（を含む）の月はCSVを正とする。CSVが未登録なら null。 */
  historyCutoff: string | null;
  /** 画面で手入力した値。CSV・データより優先する。 */
  overrides?: KpiOverrides;
}): KpiRow[] {
  return input.months.map((month) => {
    const history = input.history.get(month);
    const useHistory = Boolean(history) && input.historyCutoff != null && month <= input.historyCutoff;
    const sales = input.sales.get(month);
    const values = autoValues(input.auto.get(month), sales, input.manualReward.get(month));
    const newsOfMonth = input.news.filter((n) => n.date.slice(0, 7) === month);
    const text: Record<KpiTextKey, string | null> = {
      events: newsOfMonth.length ? newsOfMonth.map((n) => n.title).join("／") : null,
      url: newsOfMonth.length ? newsOfMonth.map((n) => n.url).join("\n") : null,
      joinedMaids: input.maids.filter((m) => m.firstMonth === month).map((m) => m.name).join("、") || null,
      leftMaids: input.maids.filter((m) => m.inactive && m.lastMonth === month).map((m) => m.name).join("、") || null,
    };
    const cells = {} as Record<KpiKey, KpiCell>;
    for (const column of KPI_COLUMNS) {
      const key = column.key;
      if (column.format === "text") {
        const recorded = history?.[key as KpiTextKey];
        const computed = text[key as KpiTextKey];
        cells[key] = useHistory && recorded ? { value: recorded, source: "csv", recomputed: computed } : { value: computed, source: computed ? "auto" : "none" };
        continue;
      }
      const computed = values[key as KpiNumberKey] ?? null;
      const recorded = history?.[key as KpiNumberKey];
      if (key === "presentYen" && useHistory && recorded == null && history?.presentCount != null) {
        cells[key] = { value: `${history.presentCount}件`, source: "csv", note: "この月のCSVは金額ではなく件数" };
        continue;
      }
      if (useHistory && recorded != null) {
        cells[key] = {
          value: recorded, source: "csv", recomputed: computed,
          differs: computed != null && differs(column.format, recorded, computed),
        };
        continue;
      }
      const source = key === "maidReward" && computed != null ? "manual" : computed != null ? "auto" : "none";
      const dependsOnSales = key === "sales" || key === "unitPrice" || key === "arppu" || key === "arpu" || key === "profit" || key === "costRate";
      cells[key] = {
        value: computed, source,
        ...(dependsOnSales && sales?.provisional && computed != null ? { provisional: true, note: sales.note } : {}),
      };
    }
    // 手入力の値で上書きする（CSV・データより優先）。
    for (const [key, value] of input.overrides?.get(month) ?? []) {
      if (!cells[key]) continue;
      cells[key] = { value, source: "manual", original: cells[key].value };
    }
    // CSVや手入力に比率・差額が無い月は、表示している基礎の値から計算し直す
    // （CSVの売上がある月の ARPPU、手入力したメイド報酬からの原価率など）。
    for (const [key, rule] of Object.entries(DERIVED) as Array<[KpiNumberKey, NonNullable<(typeof DERIVED)[KpiNumberKey]>]>) {
      if (cells[key].source === "csv" || cells[key].source === "manual") continue;
      const inputs = rule.inputs.map((input) => cells[input]);
      if (inputs.some((cell) => typeof cell.value !== "number")) continue;
      if (!inputs.some((cell) => cell.source === "csv" || cell.source === "manual")) continue; // すべてデータ由来なら上で計算済み
      const bases = Object.fromEntries(rule.inputs.map((input) => [input, cells[input].value as number]));
      const value = rule.compute(bases);
      if (value == null) continue;
      const kinds = [inputs.some((c) => c.source === "csv") ? "CSV" : "", inputs.some((c) => c.source === "manual") ? "手入力" : ""].filter(Boolean).join("・");
      cells[key] = {
        value, source: "derived", note: `${kinds}の値を含む ${rule.inputs.map((i) => KPI_COLUMNS.find((c) => c.key === i)?.label).join("・")} から計算`,
        ...(inputs.some((cell) => cell.provisional) ? { provisional: true } : {}),
      };
    }
    return { month, cells };
  });
}

/** 運営のCSVと同じ並びの行（画面だけの列は除く）。 */
export function kpiCsv(rows: KpiRow[]): Array<Array<string | number>> {
  const columns = KPI_COLUMNS.filter((c) => !c.screenOnly);
  const header = ["年月", ...columns.map((c) => c.label)];
  const body = [...rows].sort((a, b) => a.month.localeCompare(b.month)).map((row) => [
    row.month.replace("-", "/"),
    ...columns.map((c) => {
      const value = row.cells[c.key].value;
      if (value == null) return "";
      if (typeof value === "string") return value;
      if (c.format === "pct") return `${(value * 100).toFixed(2)}%`;
      if (c.format === "yen") return Math.round(value);
      return Math.round(value * 100) / 100;
    }),
  ]);
  return [header, ...body];
}

/** 営業月の範囲（JST 2:00 区切り）の初日と末日（YYYY-MM-DD）。 */
export function monthDays(month: string): { first: string; last: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(last).padStart(2, "0")}` };
}

export function monthRange(from: string, to: string): string[] {
  const months: string[] = [];
  let [y, m] = from.split("-").map(Number);
  for (let guard = 0; guard < 600; guard += 1) {
    const month = `${y}-${String(m).padStart(2, "0")}`;
    if (month > to) break;
    months.push(month);
    m += 1;
    if (m === 13) { y += 1; m = 1; }
  }
  return months;
}
