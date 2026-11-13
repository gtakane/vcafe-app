import assert from "node:assert/strict";
import test from "node:test";
import { autoValues, buildMonthlyKpi, differs, EDITABLE_KEYS, KPI_COLUMNS, kpiCsv, monthRange, parseKpiInput, visitsOfMonth, type AutoMonth, type KpiKey } from "../lib/monthly-kpi.ts";
import { parseNewsHtml } from "../lib/official-news.ts";

const auto = (month: string, over: Partial<AutoMonth> = {}): AutoMonth => ({
  month, normal: 3000, normalVisits: 2800, reservation: 200, trial: 10, free: 0, total: 3210, uu: 200,
  buckets: { b1Users: 50, b2Users: 50, b2Visits: 150, b3Users: 60, b3Visits: 600, b4Users: 25, b4Visits: 900, b5Users: 15, b5Visits: 1500 },
  photos: 800, presentYen: 20000, serveMinutes: 80000, members: 5600, newMembers: 40, ...over,
});

test("運営のCSVの列の並び（画面だけの列を除く）と同じ", () => {
  const labels = KPI_COLUMNS.filter((c) => !c.screenOnly).map((c) => c.label);
  assert.deepEqual(labels, ["売上", "延べ客数", "客単価", "フォト", "プレゼント", "UU", "会員数", "平均ご帰宅数", "PUR", "ARPPU", "ARPU", "増分", "お試し",
    "1回", "2〜4回", "総数", "5〜19", "総数", "20〜49", "総数", "50〜", "総数", "お給仕時間", "メイド報酬", "差額", "原価率", "出来事", "URL", "入店", "退店"]);
});

test("比率はCSVと同じ式（客単価=売上÷延べ客数、平均=延べ÷UU、PUR=UU÷会員数、ARPPU=売上÷UU、ARPU=売上÷会員数、原価率=報酬÷売上）", () => {
  // 延べ客数は 通常3,000（予約・お試しは含めない。無料は0件）
  const values = autoValues(auto("2026-11"), { yen: 3000000, provisional: false, note: "" }, 2000000);
  assert.equal(values.visits, 3000);
  assert.equal(values.unitPrice, 1000);
  assert.equal(values.avgVisits, 3000 / 200);
  assert.equal(values.pur, 200 / 5600);
  assert.equal(values.arppu, 15000);
  assert.equal(values.arpu, 3000000 / 5600);
  assert.equal(values.profit, 1000000);
  assert.equal(values.costRate, 2000000 / 3000000);
  assert.equal(values.serveHours, 1333.3);
  // 売上が無ければ売上に依存する指標も出さない
  const noSales = autoValues(auto("2026-11"), undefined, undefined);
  assert.equal(noSales.unitPrice, null);
  assert.equal(noSales.costRate, null);
  assert.equal(noSales.avgVisits, 3000 / 200);
});

test("延べ客数は通常ご帰宅の枠数（ポータルのご帰宅枠数）。2026年11月からは無料ご帰宅も足す。予約・お試しは含めない", () => {
  assert.equal(visitsOfMonth({ month: "2026-10", normal: 3536, free: 0 }), 3536);
  assert.equal(visitsOfMonth({ month: "2026-10", normal: 3536, free: 5 }), 3536); // 10月以前は無料を足さない
  assert.equal(visitsOfMonth({ month: "2026-11", normal: 1286, free: 99 }), 1385);
});

test("CSVの月はCSVの値を正とし、出し直した値と違えば印を付ける。CSVに無い項目はデータで補う", () => {
  const rows = buildMonthlyKpi({
    months: ["2026-11", "2026-10"],
    auto: new Map([["2026-10", auto("2026-10", { normal: 3536 })], ["2026-11", auto("2026-11")]]),
    sales: new Map([["2026-11", { yen: 3000000, provisional: true, note: "暫定（11/12 の残高で計算）" }]]),
    manualReward: new Map([["2026-11", 1900000]]),
    history: new Map([["2026-10", { month: "2026-10", visits: 3536, photos: 807, trial: 30, presentYen: null }]]),
    news: [{ date: "2026-11-06", title: "【6周年記念】新情報のお知らせ", url: "https://virtual.cafe-athome.com/news/20261106" }],
    maids: [{ name: "りん", firstMonth: "2026-10", lastMonth: "2026-11", inactive: false }, { name: "あ", firstMonth: "2025-01", lastMonth: "2026-11", inactive: true }],
    historyCutoff: "2026-10",
  });
  const [nov, oct] = rows;
  assert.equal(oct.cells.visits.value, 3536);
  assert.equal(oct.cells.visits.source, "csv");
  assert.equal(oct.cells.visits.differs, false);
  assert.equal(oct.cells.trial.value, 30);
  assert.equal(oct.cells.trial.differs, true); // データでは10件
  assert.equal(oct.cells.uu.source, "auto"); // CSVが空 → データで補う
  assert.equal(oct.cells.joinedMaids.value, "りん");
  assert.equal(nov.cells.sales.value, 3000000);
  assert.equal(nov.cells.sales.provisional, true);
  assert.equal(nov.cells.unitPrice.provisional, true);
  assert.equal(nov.cells.maidReward.source, "manual");
  assert.equal(nov.cells.events.value, "【6周年記念】新情報のお知らせ");
  assert.equal(nov.cells.leftMaids.value, "あ"); // 非稼働で最後のシフトが11月
  assert.equal(nov.cells.joinedMaids.value, null);
});

test("2023年7月以前のCSVのプレゼントは件数として表示する", () => {
  const [row] = buildMonthlyKpi({
    months: ["2021-10"], auto: new Map(), sales: new Map(), manualReward: new Map(),
    history: new Map([["2021-10", { month: "2021-10", presentYen: null, presentCount: 884 }]]), news: [], maids: [], historyCutoff: "2026-10",
  });
  assert.equal(row.cells.presentYen.value, "884件");
});

test("差の判定は端数や丸めでは印を付けない", () => {
  assert.equal(differs("count", 224, 224), false);
  assert.equal(differs("count", 224, 225), false); // 1件差は許容
  assert.equal(differs("count", 224, 230), true);
  assert.equal(differs("pct", 0.0403, 0.0405), false);
  assert.equal(differs("pct", 0.0403, 0.0420), true);
  assert.equal(differs("yen", 3256979, 3257979), false); // 0.03%
  assert.equal(differs("yen", 3256979, 3400000), true);
});

test("CSV出力は運営のCSVと同じ並び・古い月から", () => {
  const rows = buildMonthlyKpi({
    months: ["2026-11", "2026-10"], auto: new Map([["2026-11", auto("2026-11")]]),
    sales: new Map([["2026-11", { yen: 3210000, provisional: false, note: "" }]]), manualReward: new Map(),
    history: new Map([["2026-10", { month: "2026-10", visits: 3536 }]]), news: [], maids: [], historyCutoff: "2026-10",
  });
  const csv = kpiCsv(rows);
  assert.equal(csv[0][0], "年月");
  assert.equal(csv[0].length, 31);
  assert.equal(csv[1][0], "2026/10");
  assert.equal(csv[2][1], 3210000);
  assert.equal(csv[2][9], "3.57%"); // PUR = UU 200 ÷ 会員数 5600
});

test("月の並び", () => {
  assert.deepEqual(monthRange("2025-11", "2026-02"), ["2025-11", "2025-12", "2026-01", "2026-02"]);
});

test("公式サイトのお知らせ一覧から公開日・タイトル・URLを取り出す（区分の表示はタイトルから外す）", () => {
  const html = `<a href="/news/20261106"><time>2026.11.6</time><span>お知らせ</span><span>新着</span><p>【6周年記念】新情報のお知らせ</p></a>
    <div>2026年10月16日(金)</div><a href="https://virtual.cafe-athome.com/news/halloween2026">シーズナルイベント『HappyHalloween2026』はじまります</a>
    <a href="/news?category=info">お知らせ</a>`;
  assert.deepEqual(parseNewsHtml(html), [
    { date: "2026-10-16", title: "シーズナルイベント『HappyHalloween2026』はじまります", url: "https://virtual.cafe-athome.com/news/halloween2026" },
    { date: "2026-11-06", title: "【6周年記念】新情報のお知らせ", url: "https://virtual.cafe-athome.com/news/20261106" },
  ]);
});

test("CSVに比率が無い月は、表示している基礎の値（CSVの売上・UUなど）から計算する（2026年7〜9月の ARPPU・ARPU）", () => {
  const [sep] = buildMonthlyKpi({
    months: ["2026-09"],
    auto: new Map([["2026-09", auto("2026-09", { uu: 200, members: 5600, total: 3600 })]]),
    sales: new Map(), manualReward: new Map(),
    history: new Map([["2026-09", { month: "2026-09", sales: 2874447, visits: 3719, unitPrice: 773, uu: 218, maidReward: 1983558, profit: 890889, costRate: 0.69 }]]),
    news: [], maids: [], historyCutoff: "2026-10",
  });
  // ARPPU = CSVの売上 ÷ CSVの UU（データの UU 200 ではない）
  assert.equal(sep.cells.arppu.source, "derived");
  assert.equal(Math.round(sep.cells.arppu.value as number), Math.round(2874447 / 218));
  // ARPU = CSVの売上 ÷ 会員数（CSVに無いのでデータの5,600）
  assert.equal(Math.round(sep.cells.arpu.value as number), Math.round(2874447 / 5600));
  // 平均ご帰宅数 = CSVの延べ客数 ÷ CSVの UU
  assert.equal(sep.cells.avgVisits.value, 3719 / 218);
  // PUR = CSVの UU ÷ データの会員数
  assert.equal(sep.cells.pur.value, 218 / 5600);
  // CSVにある比率はそのまま
  assert.equal(sep.cells.unitPrice.value, 773);
  assert.equal(sep.cells.unitPrice.source, "csv");
});

test("手入力の値はCSV・データより優先し、比率は手入力の値から計算し直す", () => {
  const overrides = new Map([
    ["2026-11", new Map<KpiKey, number | string>([["maidReward", 2000000], ["events", "横浜メイド博"]])],
    ["2026-10", new Map<KpiKey, number | string>([["sales", 3289514], ["uu", 220]])],
  ]);
  const [nov, oct] = buildMonthlyKpi({
    months: ["2026-11", "2026-10"],
    auto: new Map([["2026-10", auto("2026-10", { normal: 3536 })], ["2026-11", auto("2026-11")]]),
    sales: new Map([["2026-11", { yen: 3000000, provisional: true, note: "暫定" }]]), manualReward: new Map(),
    history: new Map([["2026-10", { month: "2026-10", visits: 3536, uu: 200, maidReward: 1900000 }]]),
    news: [{ date: "2026-11-06", title: "【6周年記念】新情報のお知らせ", url: "https://virtual.cafe-athome.com/news/20261106" }],
    maids: [], historyCutoff: "2026-10", overrides,
  });
  // 11月: メイド報酬を手入力 → 差額・原価率がそこから計算され、売上が暫定なので暫定のまま
  assert.equal(nov.cells.maidReward.source, "manual");
  assert.equal(nov.cells.maidReward.original, null);
  assert.equal(nov.cells.profit.value, 1000000);
  assert.equal(nov.cells.profit.source, "derived");
  assert.equal(nov.cells.profit.provisional, true);
  assert.equal(nov.cells.costRate.value, 2000000 / 3000000);
  assert.equal(nov.cells.events.value, "横浜メイド博"); // 公式サイトのお知らせより手入力を優先
  assert.equal(nov.cells.events.original, "【6周年記念】新情報のお知らせ");
  // 10月: CSVの空欄（売上）を埋め、CSVの UU を上書き → ARPPU・客単価・原価率を計算し直す
  assert.equal(oct.cells.sales.source, "manual");
  assert.equal(oct.cells.uu.value, 220);
  assert.equal(oct.cells.uu.original, 200);
  assert.equal(oct.cells.arppu.value, 3289514 / 220);
  assert.equal(oct.cells.unitPrice.value, 3289514 / 3536);
  assert.equal(oct.cells.costRate.value, 1900000 / 3289514);
  assert.ok(oct.cells.arppu.note?.includes("手入力"));
  // CSV出力にも手入力の値が入る
  const csv = kpiCsv([nov, oct]);
  assert.equal(csv[1][1], 3289514);
});

test("手入力できるのは運営のCSVにある列だけ（画面だけの内訳列は除く）", () => {
  assert.ok(EDITABLE_KEYS.has("maidReward"));
  assert.ok(EDITABLE_KEYS.has("events"));
  assert.ok(!EDITABLE_KEYS.has("normal"));
  assert.ok(!EDITABLE_KEYS.has("reservation"));
});

test("手入力の文字の読み取り（桁区切り・¥・括弧のマイナス・%・全角）", () => {
  const yen = { format: "yen" as const }, pct = { format: "pct" as const }, text = { format: "text" as const };
  assert.deepEqual(parseKpiInput(yen, "¥1,983,558"), { ok: true, value: 1983558 });
  assert.deepEqual(parseKpiInput(yen, "(¥132,000)"), { ok: true, value: -132000 });
  assert.deepEqual(parseKpiInput(yen, "１９８３５５８"), { ok: true, value: 1983558 });
  assert.deepEqual(parseKpiInput(pct, "69%"), { ok: true, value: 0.69 });
  assert.deepEqual(parseKpiInput(pct, "69"), { ok: true, value: 0.69 });
  assert.deepEqual(parseKpiInput(pct, "0.69"), { ok: true, value: 0.69 });
  assert.deepEqual(parseKpiInput(yen, ""), { ok: true, value: null }); // 空は手入力を消す
  assert.deepEqual(parseKpiInput(text, "  横浜メイド博 "), { ok: true, value: "横浜メイド博" });
  assert.equal(parseKpiInput(yen, "未定").ok, false);
});
