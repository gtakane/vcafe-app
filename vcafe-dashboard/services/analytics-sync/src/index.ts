import { BigQuery } from "@google-cloud/bigquery";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { loadSyncConfig } from "./config.ts";
import { buildMaidMap, mapCheki, mapMaidProfile, mapMonthlyReport, mapPayment, mapPresent, mapPurchase, mapShift, mapUser, mapVisit, type SourceDocument } from "./transform.ts";

// 例外・Promise拒否の詳細を確実にログへ出す（Cloud Run Jobでの原因特定用）。
process.on("unhandledRejection", (error) => {
  const err = error as { name?: string; message?: string; errors?: unknown[]; response?: { insertErrors?: unknown[] } };
  console.error(`UNHANDLED_REJECTION name=${err?.name} message=${err?.message} detail=${JSON.stringify((err?.errors ?? err?.response?.insertErrors ?? []).slice(0, 5))}`);
  process.exit(1);
});

const config = loadSyncConfig(process.env);
const sourceApp = initializeApp({ credential: applicationDefault(), projectId: config.productionProjectId }, "production-readonly");
const sourceDb = getFirestore(sourceApp);
const bigquery = new BigQuery({ projectId: config.analyticsProjectId });
const syncedAt = new Date().toISOString();

async function readGroup(group: string, dateField: string, start: Date, end: Date) {
  const snapshots = await sourceDb.collectionGroup(group)
    .where(dateField, ">=", Timestamp.fromDate(start))
    .where(dateField, "<", Timestamp.fromDate(end))
    .limit(config.maxDocuments)
    .get();
  return snapshots.docs.map((document): SourceDocument => ({
    id: document.id,
    parentId: document.ref.parent.parent?.id,
    data: document.data(),
    updatedAt: document.updateTime.toDate().toISOString(),
  }));
}

// トップレベルコレクションを日付範囲で読む。単一フィールドの自動インデックスで動くため
// collectionGroup と違い追加のインデックス作成が不要。
async function readCollection(name: string, dateField: string, start: Date, end: Date) {
  const snapshots = await sourceDb.collection(name)
    .where(dateField, ">=", Timestamp.fromDate(start))
    .where(dateField, "<", Timestamp.fromDate(end))
    .limit(config.maxDocuments)
    .get();
  return snapshots.docs.map((document): SourceDocument => ({
    id: document.id,
    data: document.data(),
    updatedAt: document.updateTime.toDate().toISOString(),
  }));
}

async function readUsers(ids: string[]) {
  const documents: SourceDocument[] = [];
  for (let index = 0; index < ids.length; index += 250) {
    const references = ids.slice(index, index + 250).map((id) => sourceDb.collection("users").doc(id));
    const snapshots = await sourceDb.getAll(...references);
    snapshots.forEach((document) => { if (document.exists) documents.push({ id: document.id, data: document.data() || {}, updatedAt: document.updateTime?.toDate().toISOString() }); });
  }
  return documents;
}

// ストリーミング挿入の重複排除キー。id が無い行（月次レポート等）は maidId:month で一意化する。
// 全行が同一 insertId になると BigQuery が1件を残して残りを重複破棄してしまうため。
function rowInsertId(row: Record<string, unknown>): string {
  const identity = row.id ?? (row.maidId != null && row.month != null ? `${row.maidId}:${row.month}` : "row");
  return `${String(identity)}:${String(row.sourceUpdatedAt || syncedAt)}`;
}

async function insertRows(tableName: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length || config.dryRun) return;
  const rawRows = rows.map((row) => ({ insertId: rowInsertId(row), json: row }));
  try {
    await bigquery.dataset(config.dataset).table(tableName).insert(rawRows, { raw: true, ignoreUnknownValues: false });
  } catch (error) {
    const err = error as { name?: string; message?: string; errors?: unknown[]; response?: { insertErrors?: unknown[] } };
    const reasons = (err.errors ?? err.response?.insertErrors ?? []).slice(0, 3);
    console.error(`INSERT_FAILED table=${tableName} name=${err.name} message=${err.message} reasons=${JSON.stringify(reasons)}`);
    throw error;
  }
}

// 指定した [start, end) の24時間窓を1回分同期する。
async function syncWindow(start: Date, end: Date) {
  const [visitDocuments, chekiDocuments, shiftDocuments, paymentDocuments, purchaseDocuments, presentDocuments] = await Promise.all([
    readGroup("userRecordVisits", "enterDateTime", start, end),
    readGroup("userAlbum", "date", start, end),
    readGroup("workshifts", "openTime", start, end),
    readCollection("payments", "requestDate", start, end),
    readCollection("purchaseLog", "confirmPurchaseTime", start, end),
    // プレゼントは本番に collection group インデックスが必要。未作成でも他の同期を止めないよう握りつぶす。
    readGroup("userRecordPresents", "presentDateTime", start, end).catch((error) => {
      console.warn(`PRESENTS_SKIPPED ${(error as Error).message}`);
      return [] as SourceDocument[];
    }),
  ]);
  const userIds = [...new Set([...visitDocuments, ...chekiDocuments].map((document) => document.parentId).filter((id): id is string => Boolean(id)))];
  const userDocuments = await readUsers(userIds);
  const excludedUsers = new Set(userDocuments.filter((document) => !mapUser(document, config.hmacSecret)).map((document) => document.id));
  const maidMap = buildMaidMap(shiftDocuments);
  const customers = userDocuments.map((document) => mapUser(document, config.hmacSecret)).filter((row): row is NonNullable<typeof row> => Boolean(row));
  const visits = visitDocuments.filter((document) => !excludedUsers.has(document.parentId || "")).map((document) => mapVisit(document, config.hmacSecret, maidMap)).filter((row): row is NonNullable<typeof row> => Boolean(row));
  const cheki = chekiDocuments.filter((document) => !excludedUsers.has(document.parentId || "")).map((document) => mapCheki(document, config.hmacSecret, maidMap, syncedAt)).filter((row): row is NonNullable<typeof row> => Boolean(row));
  const shifts = shiftDocuments.map(mapShift).filter((row): row is NonNullable<typeof row> => Boolean(row));
  // 課金ログ: Webstore(円) と アプリ内課金(コイン) を payments_raw に統合して保持する。
  const payments = [
    ...paymentDocuments.map((document) => mapPayment(document, config.hmacSecret)),
    ...purchaseDocuments.map((document) => mapPurchase(document, config.hmacSecret)),
  ].filter((row): row is NonNullable<typeof row> => Boolean(row));
  const presents = presentDocuments
    .filter((document) => !excludedUsers.has(document.parentId || ""))
    .map((document) => mapPresent(document, config.hmacSecret, maidMap))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  await Promise.all([
    insertRows("customers_raw", customers.map((row) => ({ ...row, syncedAt, sourceUpdatedAt: null }))),
    insertRows("visits_raw", visits.map((row) => ({ ...row, syncedAt, sourceUpdatedAt: visitDocuments.find((document) => document.id === row.id)?.updatedAt || null }))),
    insertRows("cheki_raw", cheki),
    insertRows("shifts_raw", shifts.map((row) => ({ ...row, syncedAt, sourceUpdatedAt: shiftDocuments.find((document) => document.id === row.id)?.updatedAt || null }))),
    insertRows("payments_raw", payments.map((row) => ({ ...row, syncedAt }))),
    insertRows("presents_raw", presents.map((row) => ({ ...row, syncedAt }))),
  ]);

  console.info(JSON.stringify({ dryRun: config.dryRun, window: { start: start.toISOString(), end: end.toISOString() }, counts: { customers: customers.length, visits: visits.length, cheki: cheki.length, shifts: shifts.length, payments: payments.length, presents: presents.length } }));
}

// maidWorkReport（メイド名簿＋月次実績）を全件スナップショット同期する。
// 時系列イベントではないため窓は使わず、実行ごとに1回だけ最新状態を取り込む。
async function syncMaidReports() {
  const profileSnapshot = await sourceDb.collection("maidWorkReport").limit(5000).get();
  const profiles = profileSnapshot.docs.map((document) => mapMaidProfile(document.id, document.data()));

  const monthlySnapshot = await sourceDb.collectionGroup("monthlyReport").limit(50000).get();
  const monthly = monthlySnapshot.docs
    .filter((document) => document.ref.parent.parent?.parent?.id === "maidWorkReport")
    .map((document) => mapMonthlyReport(document.ref.parent.parent!.id, document.id, document.data()));

  await Promise.all([
    insertRows("maid_profiles_raw", profiles.map((row) => ({ ...row, syncedAt }))),
    insertRows("maid_monthly_raw", monthly.map((row) => ({ ...row, syncedAt }))),
  ]);
  console.info(JSON.stringify({ maidReports: { profiles: profiles.length, monthly: monthly.length } }));
}

// users を全件スナップショット同期する（ユーザーDBを「来店のあった人」だけでなく全会員にする）。
// 件数が多いためドキュメントID順にページングし、1000件ずつ挿入する。
async function syncAllUsers() {
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let total = 0, skipped = 0;
  for (;;) {
    let query = sourceDb.collection("users").orderBy("__name__").limit(1000);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    const documents = snapshot.docs.map((document): SourceDocument => ({ id: document.id, data: document.data(), updatedAt: document.updateTime.toDate().toISOString() }));
    const rows = documents.map((document) => mapUser(document, config.hmacSecret)).filter((row): row is NonNullable<typeof row> => Boolean(row));
    skipped += documents.length - rows.length; // テストユーザーは除外済み
    await insertRows("customers_raw", rows.map((row) => ({ ...row, syncedAt, sourceUpdatedAt: null })));
    total += rows.length;
    // 途中でタイムアウトしても、どこまで進んだかログで分かるようにする。
    console.info(`ALL_USERS_PROGRESS synced=${total}`);
    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < 1000) break;
  }
  console.info(JSON.stringify({ allUsers: { synced: total, excludedTestUsers: skipped } }));
}

// メイドレポート(月次)は本番を全件読むため負荷が大きい。毎時の同期では読まず、
// 既定では JST の指定時刻(MAID_REPORTS_HOUR_JST、既定5時)の実行時のみ取り込む。
//   MAID_REPORTS=always … 毎回取り込む（バックフィル時など明示的に使う）
//   MAID_REPORTS=never  … 取り込まない
// 旧 SKIP_MAID_REPORTS=true も互換のため never として扱う。
function shouldSyncMaidReports(): boolean {
  const mode = (process.env.MAID_REPORTS || "").trim().toLowerCase();
  if (process.env.SKIP_MAID_REPORTS === "true" || mode === "never") return false;
  if (mode === "always") return true;
  const hour = Number(process.env.MAID_REPORTS_HOUR_JST ?? 5);
  const jstHour = new Date(Date.now() + 9 * 3600000).getUTCHours();
  return Number.isInteger(hour) ? jstHour === hour : true;
}

if (shouldSyncMaidReports()) {
  await syncMaidReports();
} else {
  console.info("MAID_REPORTS_SKIPPED 本番の読み取り負荷を抑えるため今回は月次レポートを同期しません");
}

// 全会員の同期（SYNC_ALL_USERS=true のときのみ）。初回およびユーザー属性を最新化したいときに使う。
if (process.env.SYNC_ALL_USERS === "true") {
  await syncAllUsers();
}

// バックフィル設定（いずれも無ければ通常の単一窓＝増分同期）:
//   BACKFILL_FROM=YYYY-MM-DD … その日(UTC)から現在までを24時間窓で取り込む
//   BACKFILL_DAYS=N          … 過去N日を24時間窓で取り込む
const DAY_MS = 24 * 60 * 60 * 1000;
const backfillFrom = (process.env.BACKFILL_FROM || "").trim();
const backfillDays = Number(process.env.BACKFILL_DAYS || 0);

const windows: Array<[Date, Date]> = [];
if (backfillFrom || (Number.isInteger(backfillDays) && backfillDays > 0)) {
  const now = Date.now();
  let startMs: number;
  if (backfillFrom) {
    const parsed = new Date(`${backfillFrom}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) throw new Error("BACKFILL_FROMはYYYY-MM-DD形式で指定してください");
    startMs = parsed.getTime();
  } else {
    startMs = now - backfillDays * DAY_MS;
  }
  const totalWindows = Math.ceil((now - startMs) / DAY_MS);
  if (totalWindows < 1) throw new Error("バックフィル開始日が未来です");
  if (totalWindows > 550) throw new Error(`バックフィル窓が多すぎます(${totalWindows})。550日以内にしてください`);
  for (let cursor = startMs; cursor < now; cursor += DAY_MS) {
    windows.push([new Date(cursor), new Date(Math.min(cursor + DAY_MS, now))]);
  }
} else {
  windows.push([config.start, config.end]);
}

// 窓ごとに実行。1窓失敗しても残りは続行し、最後にまとめて報告する（大量バックフィルの耐障害性）。
let failedWindows = 0;
let windowIndex = 0;
for (const [windowStart, windowEnd] of windows) {
  windowIndex += 1;
  // 途中でタイムアウトしても、どこまで進んだかログで分かるようにする。
  if (windows.length > 1) console.info(`WINDOW_PROGRESS ${windowIndex}/${windows.length} ${windowStart.toISOString().slice(0, 10)}`);
  try {
    if (windows.length > 1) console.info(`WINDOW ${windowStart.toISOString()} .. ${windowEnd.toISOString()}`);
    await syncWindow(windowStart, windowEnd);
  } catch (error) {
    failedWindows += 1;
    const err = error as { message?: string };
    console.error(`WINDOW_FAILED ${windowStart.toISOString()} .. ${windowEnd.toISOString()} : ${err?.message}`);
  }
}
if (failedWindows > 0) {
  console.error(`バックフィル完了: ${failedWindows}/${windows.length} 窓が失敗`);
  if (failedWindows === windows.length) process.exit(1);
}
