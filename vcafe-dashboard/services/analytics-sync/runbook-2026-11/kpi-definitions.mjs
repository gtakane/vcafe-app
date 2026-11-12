// 月次指標CSVの定義を、本番Firestoreから直接集計して確かめる（読み取りのみ・個人を特定する値は出さない）。
// 使い方: node kpi-definitions.mjs 2026-04 2026-10
// BigQuery はテストユーザーを取り込んでいないため、テストユーザーを含む UU はここでしか出せない。
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { BUCKETS, businessMonthRange, summarizeMonth } from "./kpi-definitions-lib.mjs";

const [from = "2026-04", to = "2026-10"] = process.argv.slice(2);
const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId: "v-athome-cafe-app" }));

const months = [];
for (let [y, m] = from.split("-").map(Number); `${y}-${String(m).padStart(2, "0")}` <= to; m === 12 ? (y += 1, m = 1) : (m += 1)) {
  months.push(`${y}-${String(m).padStart(2, "0")}`);
}

// 手元のCSVの値（2026年4月〜10月）
const CSV = {
  "2026-04": { total: 3774, photo: 862, present: 36900, uu: 224, members: 5561, trial: 10, b1: [53], b2: [54, 156], b3: [66, 630], b4: [32, 1032], b5: [19, 1463], hours: 1434 },
  "2026-05": { total: 3996, photo: 820, present: 30650, uu: 250, members: 5607, trial: 18, b1: [65], b2: [64, 176], b3: [72, 802], b4: [29, 976], b5: [20, 1547], hours: 1413 },
  "2026-06": { total: 3673, photo: 723, present: 22150, uu: 231, members: 5607, trial: 14, b1: [53], b2: [59, 56], b3: [68, 717], b4: [38, 1272], b5: [20, 1547], hours: 1400 },
  "2026-07": { total: 3967, photo: 938, present: 40800, uu: 232, trial: 20, b1: [59], b2: [55, 146], b3: [63, 663], b4: [39, 1238], b5: [16, 1344], hours: 1353 },
  "2026-08": { total: 4001, photo: 780, present: 30800, uu: 214, trial: 7, b1: [52], b2: [52, 136], b3: [56, 575], b4: [31, 1069], b5: [23, 1832], hours: 1334 },
  "2026-09": { total: 3719, photo: 773, present: 21350, uu: 218, trial: 11, b1: [58], b2: [45, 120], b3: [65, 582], b4: [28, 931], b5: [21, 1768], hours: 1333 },
  "2026-10": { total: 3536, photo: 807, present: 21300, trial: 15 },
};

// テストユーザー（users.testUser / testUesrFlag）
const testUserIds = new Set();
for (const field of ["testUser", "testUesrFlag"]) {
  for (const value of [true, "true"]) {
    const snapshot = await db.collection("users").where(field, "==", value).select().get();
    snapshot.docs.forEach((document) => testUserIds.add(document.id));
  }
}

// メイドの月次実績（アプリ管理画面の月次）。月ごとに合計する。
const monthlyReport = new Map();
const reportSnapshot = await db.collectionGroup("monthlyReport")
  .select("totalVisits", "totalOtameshi", "totalPhoto", "totalPresentsPrice", "totalWorkTimes", "totalWorkTimesReserve").get();
for (const document of reportSnapshot.docs) {
  if (document.ref.parent.parent?.parent?.id !== "maidWorkReport") continue;
  const digits = document.id.replace(/\D/g, "");
  const ym = `${digits.slice(0, 4)}-${digits.slice(4, 6)}`;
  const sum = monthlyReport.get(ym) || { visits: 0, otameshi: 0, photo: 0, presentYen: 0, work: 0, workReserve: 0 };
  const n = (key) => Number(document.get(key)) || 0;
  sum.visits += n("totalVisits"); sum.otameshi += n("totalOtameshi"); sum.photo += n("totalPhoto");
  sum.presentYen += n("totalPresentsPrice"); sum.work += n("totalWorkTimes"); sum.workReserve += n("totalWorkTimesReserve");
  monthlyReport.set(ym, sum);
}

const columns = new Map(); // ym -> { label -> value }
const fieldNames = new Map();
const histogram = new Map();
for (const ym of months) {
  const { start, end } = businessMonthRange(ym);
  const snapshot = await db.collectionGroup("userRecordVisits")
    .where("enterDateTime", ">=", Timestamp.fromDate(start)).where("enterDateTime", "<", Timestamp.fromDate(end))
    .get();
  const visits = snapshot.docs.map((document) => ({ userId: document.ref.parent.parent?.id || "", data: document.data() }));
  // ご帰宅記録にどんな項目があるか（お給仕時間の候補を探すため。項目名と件数のみ）
  for (const { data } of visits) for (const key of Object.keys(data)) fieldNames.set(key, (fieldNames.get(key) || 0) + 1);

  const withTest = summarizeMonth(visits, testUserIds, { includeTestUsers: true });
  const withoutTest = summarizeMonth(visits, testUserIds, { includeTestUsers: false });
  for (const [minutes, count] of withTest.minutesHistogram) {
    const row = histogram.get(minutes) || {};
    row[ym] = count;
    histogram.set(minutes, row);
  }
  const photoCount = (await db.collectionGroup("userAlbum")
    .where("date", ">=", Timestamp.fromDate(start)).where("date", "<", Timestamp.fromDate(end)).count().get()).data().count;
  const membersAll = (await db.collection("users").where("registrationDate", "<", Timestamp.fromDate(end)).count().get()).data().count;
  const report = monthlyReport.get(ym) || {};
  const csv = CSV[ym] || {};
  const c = new Map();
  const put = (label, value) => c.set(label, value);
  put("01 延べ客数【CSV】", csv.total);
  put("01 延べ客数 = 合計ご帰宅数（テスト含む）", withTest.total);
  put("01 延べ客数 = 合計ご帰宅数（テスト除く）", withoutTest.total);
  put("01   内訳: 通常（換算）", withTest.normalUnits);
  put("01   内訳: 通常（実回数）", withTest.normalCount);
  put("01   内訳: 予約", withTest.reservation);
  put("01   内訳: お試し", withTest.trial);
  put("01   内訳: 無料3種", withTest.free);
  put("01   (参考)月次実績 totalVisits 合計", report.visits);
  put("02 UU【CSV】", csv.uu);
  put("02 UU 通常ご帰宅した人（テスト含む）", withTest.uu);
  put("02 UU 通常ご帰宅した人（テスト除く）", withoutTest.uu);
  put("02   うちテストユーザー", withTest.uuTest);
  for (const bucket of BUCKETS) {
    const [csvUsers, csvTotal] = csv[bucket.key] || [];
    const slot = withTest.buckets[bucket.key];
    put(`03 ${bucket.label} 人数【CSV】`, csvUsers);
    put(`03 ${bucket.label} 人数`, slot.users);
    if (bucket.key !== "b1") {
      put(`03 ${bucket.label} 総数【CSV】`, csvTotal);
      put(`03 ${bucket.label} 総数? その人たちの合計ご帰宅数（全区分）`, slot.units);
      put(`03 ${bucket.label} 総数? その人たちの通常ご帰宅（実回数）`, slot.normalCount);
    }
  }
  put("04 お試し【CSV】", csv.trial);
  put("04 お試し お試しご帰宅の件数", withTest.trial);
  put("04   (参考)月次実績 totalOtameshi 合計", report.otameshi);
  put("05 お給仕時間【CSV】", csv.hours);
  put("05 お給仕時間? 全ご帰宅の滞在時間合計(h)", Math.round(withTest.minutesAll / 6) / 10);
  put("05 お給仕時間? 通常ご帰宅の滞在時間合計(h)", Math.round(withTest.minutesNormal / 6) / 10);
  put("05   (参考)月次実績 totalWorkTimes 合計", report.work);
  put("05   (参考)月次実績 totalWorkTimesReserve 合計", report.workReserve);
  put("06 フォト【CSV】", csv.photo);
  put("06 フォト 記念撮影の枚数", photoCount);
  put("06   (参考)月次実績 totalPhoto 合計", report.photo);
  put("07 プレゼント【CSV】", csv.present);
  put("07 プレゼント 月次実績 totalPresentsPrice 合計(円)", report.presentYen);
  put("08 会員数【CSV】", csv.members);
  put("08 会員数 月末までの登録者（テスト含む）", membersAll);
  columns.set(ym, c);
}

const labels = [...new Set([...columns.values()].flatMap((c) => [...c.keys()]))];
const format = (value) => (value === undefined || value === null ? "" : Number.isInteger(value) ? String(value) : value.toFixed(1));
const width = Math.max(...labels.map((l) => [...l].reduce((w, ch) => w + (ch.charCodeAt(0) > 0xff ? 2 : 1), 0)));
const pad = (label) => label + " ".repeat(width - [...label].reduce((w, ch) => w + (ch.charCodeAt(0) > 0xff ? 2 : 1), 0));
console.log(`${pad("指標")}  ${months.map((m) => m.slice(2).padStart(7)).join(" ")}`);
for (const label of labels) {
  if (label.includes("【CSV】")) console.log("");
  console.log(`${pad(label)}  ${months.map((m) => format(columns.get(m).get(label)).padStart(7)).join(" ")}`);
}

console.log("\n=== 通常ご帰宅の滞在時間（initialTime）の分布（件数） ===");
console.log(`${"分".padStart(5)}  ${months.map((m) => m.slice(2).padStart(7)).join(" ")}`);
for (const minutes of [...histogram.keys()].sort((a, b) => a - b)) {
  console.log(`${String(minutes).padStart(5)}  ${months.map((m) => String(histogram.get(minutes)[m] || "").padStart(7)).join(" ")}`);
}

console.log("\n=== ご帰宅記録の項目名（お給仕時間の候補を探すため。値は出さない） ===");
console.log([...fieldNames.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}(${n})`).join(", "));
console.log(`\nテストユーザー数: ${testUserIds.size}`);
process.exit(0);
