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

async function readGroup(group: string, dateField: string) {
  const snapshots = await sourceDb.collectionGroup(group)
    .where(dateField, ">=", Timestamp.fromDate(config.start))
    .where(dateField, "<", Timestamp.fromDate(config.end))
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

const [visitDocuments, chekiDocuments, shiftDocuments] = await Promise.all([
  readGroup("userRecordVisits", "enterDateTime"),
  readGroup("userAlbum", "date"),
  readGroup("workshifts", "openTime"),
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

console.info(JSON.stringify({ dryRun: config.dryRun, range: { start: config.start.toISOString(), end: config.end.toISOString() }, counts: { customers: customers.length, visits: visits.length, cheki: cheki.length, shifts: shifts.length } }));
