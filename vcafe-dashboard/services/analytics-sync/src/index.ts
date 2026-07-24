import { BigQuery } from "@google-cloud/bigquery";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { loadSyncConfig } from "./config.ts";
import { buildMaidMap, mapCheki, mapShift, mapUser, mapVisit, type SourceDocument } from "./transform.ts";

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

async function readUsers(ids: string[]) {
  const documents: SourceDocument[] = [];
  for (let index = 0; index < ids.length; index += 250) {
    const references = ids.slice(index, index + 250).map((id) => sourceDb.collection("users").doc(id));
    const snapshots = await sourceDb.getAll(...references);
    snapshots.forEach((document) => { if (document.exists) documents.push({ id: document.id, data: document.data() || {}, updatedAt: document.updateTime?.toDate().toISOString() }); });
  }
  return documents;
}

async function insertRows(tableName: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length || config.dryRun) return;
  const rawRows = rows.map((row) => ({ insertId: `${String(row.id)}:${String(row.sourceUpdatedAt || syncedAt)}`, json: row }));
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
  const [visitDocuments, chekiDocuments, shiftDocuments] = await Promise.all([
    readGroup("userRecordVisits", "enterDateTime", start, end),
    readGroup("userAlbum", "date", start, end),
    readGroup("workshifts", "openTime", start, end),
  ]);
  const userIds = [...new Set([...visitDocuments, ...chekiDocuments].map((document) => document.parentId).filter((id): id is string => Boolean(id)))];
  const userDocuments = await readUsers(userIds);
  const excludedUsers = new Set(userDocuments.filter((document) => !mapUser(document, config.hmacSecret)).map((document) => document.id));
  const maidMap = buildMaidMap(shiftDocuments);
  const customers = userDocuments.map((document) => mapUser(document, config.hmacSecret)).filter((row): row is NonNullable<typeof row> => Boolean(row));
  const visits = visitDocuments.filter((document) => !excludedUsers.has(document.parentId || "")).map((document) => mapVisit(document, config.hmacSecret, maidMap)).filter((row): row is NonNullable<typeof row> => Boolean(row));
  const cheki = chekiDocuments.filter((document) => !excludedUsers.has(document.parentId || "")).map((document) => mapCheki(document, config.hmacSecret, maidMap, syncedAt)).filter((row): row is NonNullable<typeof row> => Boolean(row));
  const shifts = shiftDocuments.map(mapShift).filter((row): row is NonNullable<typeof row> => Boolean(row));

  await Promise.all([
    insertRows("customers_raw", customers.map((row) => ({ ...row, syncedAt, sourceUpdatedAt: null }))),
    insertRows("visits_raw", visits.map((row) => ({ ...row, syncedAt, sourceUpdatedAt: visitDocuments.find((document) => document.id === row.id)?.updatedAt || null }))),
    insertRows("cheki_raw", cheki),
    insertRows("shifts_raw", shifts.map((row) => ({ ...row, syncedAt, sourceUpdatedAt: shiftDocuments.find((document) => document.id === row.id)?.updatedAt || null }))),
  ]);

  console.info(JSON.stringify({ dryRun: config.dryRun, window: { start: start.toISOString(), end: end.toISOString() }, counts: { customers: customers.length, visits: visits.length, cheki: cheki.length, shifts: shifts.length } }));
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
for (const [windowStart, windowEnd] of windows) {
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
