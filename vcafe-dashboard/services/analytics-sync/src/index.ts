import { BigQuery } from "@google-cloud/bigquery";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { loadSyncConfig } from "./config.ts";
import { fetchAllPages, type PageCursor } from "./paging.ts";
import { buildSyncWindows } from "./windows.ts";
import { assertRejectRate, mapSafely, type RejectEntry } from "./safe-map.ts";
import { validateRows } from "./row-validation.ts";
import { assertLiveSchema, liveColumnsSql, type LiveColumn } from "./schema-precheck.ts";
import { looksLikeMissingColumn, summarizeInsertErrors } from "./insert-errors.ts";
import { buildMaidDirectory, mapCheki, pseudonymizeCustomerId, recordKeyOf, mapMaidProfile, mapMonthlyReport, mapPayment, mapPresent, mapPurchase, mapShift, mapUser, mapUserPayment, mapVisit, type SourceDocument } from "./transform.ts";

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
// 実行識別子。同一 syncedAt の行が複数実行にまたがったときの順序決定に使う。
const runId = `${syncedAt}-${Math.random().toString(36).slice(2, 10)}`;

/** 取得結果。上限に到達した場合は limitReached=true（呼び出し側で失敗させる）。 */
interface ReadResult {
  documents: SourceDocument[];
  readCount: number;
  limitReached: boolean;
}

/**
 * 日付範囲＋ドキュメントIDの複合カーソルでページングして読む。
 * 旧実装は .limit() のみで、上限を超えた分が無言で欠落していた。
 */
async function readPaged(
  baseQuery: FirebaseFirestore.Query,
  dateField: string,
  start: Date,
  end: Date,
  withParent: boolean,
): Promise<ReadResult> {
  const ranged = baseQuery
    .where(dateField, ">=", Timestamp.fromDate(start))
    .where(dateField, "<", Timestamp.fromDate(end))
    .orderBy(dateField)
    .orderBy("__name__"); // 同一時刻が並んでも前進できるようにする

  const result = await fetchAllPages<SourceDocument & { __cursor: PageCursor }>(
    async (cursor, size) => {
      let query = ranged.limit(size);
      if (cursor) query = query.startAfter(cursor.dateValue, cursor.path);
      const snapshot = await query.get();
      const documents = snapshot.docs.map((document) => ({
        id: document.id,
        parentId: withParent ? document.ref.parent.parent?.id : undefined,
        // recordKey の材料。生パスは分析側へ保存せず、HMAC化した結果だけを持つ。
        path: document.ref.path,
        data: document.data(),
        updatedAt: document.updateTime.toDate().toISOString(),
        __cursor: { dateValue: document.get(dateField), path: document.ref.path },
      }));
      const last = documents.at(-1);
      return { documents, cursor: last ? { dateValue: last.__cursor.dateValue, path: last.__cursor.path } : null };
    },
    { pageSize: config.pageSize, maxTotal: config.maxDocuments },
  );

  return {
    documents: result.documents.map(({ __cursor, ...document }) => document),
    readCount: result.readCount,
    limitReached: result.limitReached,
  };
}

async function readGroup(group: string, dateField: string, start: Date, end: Date): Promise<ReadResult> {
  return readPaged(sourceDb.collectionGroup(group), dateField, start, end, true);
}

// トップレベルコレクションを日付範囲で読む。
async function readCollection(name: string, dateField: string, start: Date, end: Date): Promise<ReadResult> {
  return readPaged(sourceDb.collection(name), dateField, start, end, false);
}

async function readUsers(ids: string[]) {
  const documents: SourceDocument[] = [];
  for (let index = 0; index < ids.length; index += 250) {
    const references = ids.slice(index, index + 250).map((id) => sourceDb.collection("users").doc(id));
    const snapshots = await sourceDb.getAll(...references);
    snapshots.forEach((document) => { if (document.exists) documents.push({ id: document.id, path: document.ref.path, data: document.data() || {}, updatedAt: document.updateTime?.toDate().toISOString() }); });
  }
  return documents;
}

// ストリーミング挿入の重複排除キー。id が無い行（月次レポート等）は maidId:month で一意化する。
// 全行が同一 insertId になると BigQuery が1件を残して残りを重複破棄してしまうため。
function rowInsertId(row: object): string {
  const r = row as Record<string, unknown>;
  // recordKey（フルパスのHMAC）があればそれを使う。document.id は collection group で
  // 一意にならず、同名別親のドキュメントが重複排除で消える恐れがある。
  const identity = r.recordKey
    ?? r.id
    ?? (r.maidId != null && r.month != null ? `${r.maidId}:${r.month}` : "row");
  return `${String(identity)}:${String(r.sourceUpdatedAt || syncedAt)}`;
}

// インターフェース型は index signature を持たないため Record<string, unknown> では受けられない。
// 行の形はテーブルごとに異なるので object[] で受ける。
async function insertRows(tableName: string, rows: object[]) {
  if (!rows.length || config.dryRun) return;
  // manifest（schema.sql 由来）と突き合わせて挿入前に検証する。
  // 不正行を混ぜると ignoreUnknownValues:false によりバッチ全体が失敗するため、
  // 該当行だけを理由つきで除外する。生の値はログに出さない。
  const { valid, rejected } = validateRows(tableName, rows as Array<Record<string, unknown>>, (rejection) => {
    console.warn(JSON.stringify({ rowRejected: rejection }));
  });
  if (rejected > 0) console.warn(JSON.stringify({ validation: { table: tableName, rejected, total: rows.length } }));
  if (!valid.length) return;
  const rawRows = valid.map((row) => ({ insertId: rowInsertId(row), json: row }));
  try {
    await bigquery.dataset(config.dataset).table(tableName).insert(rawRows, { raw: true, ignoreUnknownValues: false });
  } catch (error) {
    // 生の errors 配列をそのまま出すとログが切り詰められて原因が読めない。
    // 件数・理由・列名だけに要約する（行の値は本番データなので出さない）。
    const summary = summarizeInsertErrors(error);
    console.error(`INSERT_FAILED table=${tableName} name=${(error as Error).name} ${JSON.stringify(summary)}`);
    if (looksLikeMissingColumn(summary)) {
      console.error("INSERT_FAILED_HINT BigQuery に列がありません。bash services/analytics-sync/apply-schema.sh を実行してください（配備手順1）。");
    }
    throw error;
  }
}

/**
 * 起動時のスキーマ事前検査。
 * 列が足りないまま走ると全テーブルが PartialFailureError で失敗し、本番を無駄に読む。
 * 窓を1つも処理しないうちに、不足列と対処法を添えて停止する。
 */
async function precheckSchema() {
  let rows: LiveColumn[];
  try {
    const [result] = await bigquery.query({
      query: liveColumnsSql(config.analyticsProjectId, config.dataset),
      location: process.env.BIGQUERY_LOCATION || "asia-northeast1",
    });
    rows = (result as Array<{ table: string; column: string }>).map((row) => ({ table: row.table, column: row.column }));
  } catch (error) {
    throw new Error(
      `SCHEMA_PRECHECK_FAILED BigQuery のスキーマを確認できませんでした（${config.analyticsProjectId}.${config.dataset}）: ${(error as Error).message}\n` +
      "対処: データセットが存在しない場合は bash services/analytics-sync/apply-schema.sh を実行してください（配備手順1）。",
    );
  }
  assertLiveSchema(rows);
  console.info(JSON.stringify({ schemaPrecheck: { dataset: config.dataset, columns: rows.length, status: "ok" } }));
}


// メイド名簿(maidWorkReport)は小規模（100件未満）なので、窓ごとに全件取得してよい。
// 実行内で使い回すためキャッシュする。
let maidDirectoryCache: Map<string, string> | null = null;
async function loadMaidDirectory(): Promise<Map<string, string>> {
  if (maidDirectoryCache) return maidDirectoryCache;
  const snapshot = await sourceDb.collection("maidWorkReport").select("nickname").limit(5000).get();
  maidDirectoryCache = buildMaidDirectory(snapshot.docs.map((document) => ({
    id: document.id,
    nickname: String(document.get("nickname") ?? "").trim(),
  })));
  console.info(JSON.stringify({ maidDirectory: { profiles: snapshot.size, resolvable: maidDirectoryCache.size } }));
  return maidDirectoryCache;
}

/**
 * 変換で落ちた件数を理由つきで数える。生データ・UID・ニックネームは記録しない
 * （分析側に本番の識別子を残さないため）。
 */
function countRejects(readCount: number, acceptedCount: number, source: string, reasonCode: string) {
  const rejected = readCount - acceptedCount;
  if (rejected > 0) {
    console.warn(JSON.stringify({ reject: { source, reasonCode, rejected, read: readCount } }));
  }
  return rejected;
}

/** 実行記録。監視・鮮度表示の根拠になるため、失敗した窓についても必ず1行残す。 */
interface SyncRunRow {
  runId: string;
  source: string;
  windowKind: string;
  windowStart: string;
  windowEnd: string;
  readCount: number;
  acceptedCount: number;
  rejectedCount: number;
  insertedCount: number;
  maxEventAt: string | null;
  maxSourceUpdatedAt: string | null;
  limitReached: boolean;
  status: "ok" | "degraded" | "failed";
  errorCode: string | null;
  startedAt: string;
  completedAt: string | null;
}

const maxOf = (values: Array<string | null | undefined>): string | null => {
  const valid = values.filter((v): v is string => Boolean(v)).sort();
  return valid.length ? valid[valid.length - 1] : null;
};

async function recordRuns(rows: SyncRunRow[]) {
  if (!rows.length) return;
  try {
    await insertRows("sync_runs", rows);
  } catch (error) {
    // 記録の失敗で同期本体を止めない。ただし気づけるようログには必ず残す。
    console.error(`SYNC_RUNS_INSERT_FAILED ${(error as Error).message}`);
  }
}

async function recordRejects(runId: string, entries: Array<{ source: string; reasonCode: string; count: number }>) {
  const rows = entries.filter((entry) => entry.count > 0).map((entry) => ({
    runId, source: entry.source, reasonCode: entry.reasonCode,
    // 生データ・UID・ニックネームは保存しない。件数と理由だけを残す。
    fieldNames: null, hashedPath: null, rejectedAt: new Date().toISOString(),
  }));
  if (!rows.length) return;
  try {
    await insertRows("sync_rejects", rows);
  } catch (error) {
    console.error(`SYNC_REJECTS_INSERT_FAILED ${(error as Error).message}`);
  }
}

// 指定した [start, end) の24時間窓を1回分同期する。
async function syncWindow(start: Date, end: Date, windowKind = "incremental"): Promise<{ degraded: Array<{ source: string; reasonCode: string; message: string }> }> {
  const startedAt = new Date().toISOString();
  // 必須ソース: 失敗したら窓ごと失敗させる（欠けたまま成功にしない）。
  const [visitsRead, chekiRead, shiftsRead, paymentsRead, purchaseRead] = await Promise.all([
    readGroup("userRecordVisits", "enterDateTime", start, end),
    readGroup("userAlbum", "date", start, end),
    readGroup("workshifts", "openTime", start, end),
    readCollection("payments", "requestDate", start, end),
    readCollection("purchaseLog", "confirmPurchaseTime", start, end),
  ]);

  // 任意ソース: 本番に collection group インデックスが必要。取得できない場合は
  // 空配列で「0件」と偽らず、degraded として記録し最終的にジョブを失敗させる。
  const degraded: Array<{ source: string; reasonCode: string; message: string }> = [];
  const optional = async (source: string, run: () => Promise<ReadResult>): Promise<ReadResult> => {
    try {
      return await run();
    } catch (error) {
      degraded.push({ source, reasonCode: "SOURCE_UNAVAILABLE", message: (error as Error).message });
      console.error(JSON.stringify({ degraded: { source, reasonCode: "SOURCE_UNAVAILABLE", message: (error as Error).message } }));
      return { documents: [], readCount: 0, limitReached: false };
    }
  };
  const [presentsRead, userPaymentsRead] = await Promise.all([
    optional("userRecordPresents", () => readGroup("userRecordPresents", "presentDateTime", start, end)),
    optional("userPayments", () => readGroup("userPayments", "paymentDate", start, end)),
  ]);

  const reads = { visits: visitsRead, cheki: chekiRead, shifts: shiftsRead, payments: paymentsRead, purchase: purchaseRead, presents: presentsRead, userPayments: userPaymentsRead };
  // 上限到達＝取りこぼし。無言で欠落させず、窓を失敗させる。
  const truncated = Object.entries(reads).filter(([, r]) => r.limitReached).map(([name]) => name);
  if (truncated.length) {
    throw new Error(`取得件数が上限(MAX_DOCUMENTS=${config.maxDocuments})に達しました: ${truncated.join(", ")}。期間を分割するか上限を引き上げてください`);
  }

  const visitDocuments = visitsRead.documents;
  const chekiDocuments = chekiRead.documents;
  const shiftDocuments = shiftsRead.documents;
  const paymentDocuments = paymentsRead.documents;
  const purchaseDocuments = purchaseRead.documents;
  const presentDocuments = presentsRead.documents;
  const userPaymentDocuments = userPaymentsRead.documents;

  // 課金者(userPayments の親)も含めて users を読む。テストユーザー除外を課金にも効かせ、
  // ご帰宅が無く課金だけあるユーザーも customers_raw に載せるため。
  const userIds = [...new Set([...visitDocuments, ...chekiDocuments, ...userPaymentDocuments].map((document) => document.parentId).filter((id): id is string => Boolean(id)))];
  const userDocuments = await readUsers(userIds);
  const excludedUsers = new Set(userDocuments.filter((document) => !mapUser(document, config.hmacSecret)).map((document) => document.id));
  // メイド解決表は名簿(maidWorkReport)から作る。同期窓に含まれるシフトだけでは
  // 19時開始シフト＋翌1時訪問のようなケースを解決できず、nickname:* へ分裂するため。
  const maidMap = await loadMaidDirectory();
  // 変換は mapSafely 経由で行う。1件の壊れた文書で窓全体を落とさないため。
  const rejectEntries: RejectEntry[] = [];
  const onReject = (entry: RejectEntry) => rejectEntries.push(entry);
  const safe = <T>(documents: SourceDocument[], mapper: (d: SourceDocument) => T | null, source: string) =>
    mapSafely(documents, mapper, { source, secret: config.hmacSecret, onReject });

  const customersResult = safe(userDocuments, (d) => mapUser(d, config.hmacSecret), "users");
  const visitsResult = safe(visitDocuments.filter((d) => !excludedUsers.has(d.parentId || "")), (d) => mapVisit(d, config.hmacSecret, maidMap), "userRecordVisits");
  const chekiResult = safe(chekiDocuments.filter((d) => !excludedUsers.has(d.parentId || "")), (d) => mapCheki(d, config.hmacSecret, maidMap, syncedAt), "userAlbum");
  const shiftsResult = safe(shiftDocuments, (d) => mapShift(d, maidMap, config.hmacSecret), "workshifts");
  const customers = customersResult.accepted;
  const visits = visitsResult.accepted;
  const cheki = chekiResult.accepted;
  const shifts = shiftsResult.accepted;
  // 課金ログ: userPayments（全時代の台帳・実払い円）を正とし、
  // 旧2ソース(payments/purchaseLog)も検証用に raw へ残す（集計はビュー側で userPayments に限定）。
  const payments = [
    ...paymentDocuments.map((document) => mapPayment(document, config.hmacSecret)),
    ...purchaseDocuments.map((document) => mapPurchase(document, config.hmacSecret)),
    ...userPaymentDocuments.filter((document) => !excludedUsers.has(document.parentId || ""))
      .map((document) => mapUserPayment(document, config.hmacSecret)),
  ].filter((row): row is NonNullable<typeof row> => Boolean(row));
  const presentsResult = safe(presentDocuments.filter((d) => !excludedUsers.has(d.parentId || "")), (d) => mapPresent(d, config.hmacSecret, maidMap), "userRecordPresents");
  const presents = presentsResult.accepted;

  // 棄却率が高い＝ソース側の形が変わった可能性。静かに欠損させず窓を失敗させる。
  // 既定20%。REJECT_RATE_THRESHOLD で調整できる。
  const rejectThreshold = Number(process.env.REJECT_RATE_THRESHOLD || 0.2);
  assertRejectRate([
    { source: "userRecordVisits", ...visitsResult },
    { source: "userAlbum", ...chekiResult },
    { source: "workshifts", ...shiftsResult },
    { source: "userRecordPresents", ...presentsResult },
    { source: "users", ...customersResult },
  ], rejectThreshold);

  await Promise.all([
    // customers は取得済みの updateTime を捨てずに保持する（旧実装は null 固定だった）。
    insertRows("customers_raw", customers.map((row) => {
      const source = userDocuments.find((document) => pseudonymizeCustomerId(document.id, config.hmacSecret) === row.id);
      return {
        ...row, syncedAt, runId,
        recordKey: recordKeyOf(source?.path || `users/${row.id}`, config.hmacSecret),
        sourceUpdatedAt: source?.updatedAt ?? null,
      };
    })),
    insertRows("visits_raw", visits.map((row) => ({ ...row, syncedAt, runId }))),
    insertRows("cheki_raw", cheki.map((row) => ({ ...row, runId }))),
    insertRows("shifts_raw", shifts.map((row) => ({ ...row, syncedAt, runId }))),
    insertRows("payments_raw", payments.map((row) => ({ ...row, syncedAt, runId }))),
    insertRows("presents_raw", presents.map((row) => ({ ...row, syncedAt, runId }))),
  ]);

  const rejects = {
    visits: countRejects(visitDocuments.length, visits.length, "userRecordVisits", "UNRESOLVED_MAID_OR_INVALID"),
    cheki: countRejects(chekiDocuments.length, cheki.length, "userAlbum", "UNRESOLVED_MAID_OR_INVALID"),
    shifts: countRejects(shiftDocuments.length, shifts.length, "workshifts", "UNRESOLVED_MAID_OR_INVALID"),
    presents: countRejects(presentDocuments.length, presents.length, "userRecordPresents", "UNRESOLVED_MAID_OR_INVALID"),
  };
  const completedAt = new Date().toISOString();
  const runStatus: SyncRunRow["status"] = degraded.length ? "degraded" : "ok";
  await recordRuns([
    { runId, source: "userRecordVisits", windowKind, windowStart: start.toISOString(), windowEnd: end.toISOString(),
      readCount: visitDocuments.length, acceptedCount: visits.length, rejectedCount: rejects.visits, insertedCount: config.dryRun ? 0 : visits.length,
      maxEventAt: maxOf(visits.map((v) => v.at)), maxSourceUpdatedAt: maxOf(visitDocuments.map((d) => d.updatedAt)),
      limitReached: false, status: runStatus, errorCode: null, startedAt, completedAt },
    { runId, source: "userAlbum", windowKind, windowStart: start.toISOString(), windowEnd: end.toISOString(),
      readCount: chekiDocuments.length, acceptedCount: cheki.length, rejectedCount: rejects.cheki, insertedCount: config.dryRun ? 0 : cheki.length,
      maxEventAt: maxOf(cheki.map((c) => c.at)), maxSourceUpdatedAt: maxOf(chekiDocuments.map((d) => d.updatedAt)),
      limitReached: false, status: runStatus, errorCode: null, startedAt, completedAt },
    { runId, source: "workshifts", windowKind, windowStart: start.toISOString(), windowEnd: end.toISOString(),
      readCount: shiftDocuments.length, acceptedCount: shifts.length, rejectedCount: rejects.shifts, insertedCount: config.dryRun ? 0 : shifts.length,
      maxEventAt: maxOf(shifts.map((s) => s.scheduledStart)), maxSourceUpdatedAt: maxOf(shiftDocuments.map((d) => d.updatedAt)),
      limitReached: false, status: runStatus, errorCode: null, startedAt, completedAt },
    { runId, source: "payments", windowKind, windowStart: start.toISOString(), windowEnd: end.toISOString(),
      readCount: paymentDocuments.length + purchaseDocuments.length + userPaymentDocuments.length, acceptedCount: payments.length,
      rejectedCount: 0, insertedCount: config.dryRun ? 0 : payments.length,
      maxEventAt: maxOf(payments.map((p) => p.at)), maxSourceUpdatedAt: maxOf(payments.map((p) => p.sourceUpdatedAt)),
      limitReached: false, status: degraded.some((d) => d.source === "userPayments") ? "degraded" : runStatus,
      errorCode: degraded.find((d) => d.source === "userPayments")?.reasonCode ?? null, startedAt, completedAt },
    { runId, source: "userRecordPresents", windowKind, windowStart: start.toISOString(), windowEnd: end.toISOString(),
      readCount: presentDocuments.length, acceptedCount: presents.length, rejectedCount: rejects.presents, insertedCount: config.dryRun ? 0 : presents.length,
      maxEventAt: maxOf(presents.map((p) => p.at)), maxSourceUpdatedAt: maxOf(presents.map((p) => p.sourceUpdatedAt)),
      limitReached: false, status: degraded.some((d) => d.source === "userRecordPresents") ? "degraded" : runStatus,
      errorCode: degraded.find((d) => d.source === "userRecordPresents")?.reasonCode ?? null, startedAt, completedAt },
  ]);
  // 理由コード別に集計して記録する（生データ・UID・パスは含めない）。
  const rejectCounts = new Map<string, number>();
  for (const entry of rejectEntries) {
    const key = `${entry.source}|${entry.reasonCode}`;
    rejectCounts.set(key, (rejectCounts.get(key) || 0) + 1);
  }
  await recordRejects(runId, [...rejectCounts.entries()].map(([key, count]) => {
    const [source, reasonCode] = key.split("|");
    return { source, reasonCode, count };
  }));

  console.info(JSON.stringify({
    dryRun: config.dryRun,
    window: { start: start.toISOString(), end: end.toISOString() },
    read: { visits: visitDocuments.length, cheki: chekiDocuments.length, shifts: shiftDocuments.length, payments: paymentDocuments.length + purchaseDocuments.length + userPaymentDocuments.length, presents: presentDocuments.length },
    accepted: { customers: customers.length, visits: visits.length, cheki: cheki.length, shifts: shifts.length, payments: payments.length, presents: presents.length },
    rejected: rejects,
  }));

  return { degraded };
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
    insertRows("maid_profiles_raw", profiles.map((row) => ({ ...row, syncedAt, runId }))),
    insertRows("maid_monthly_raw", monthly.map((row) => ({ ...row, syncedAt, runId }))),
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
    await insertRows("customers_raw", rows.map((row, index) => ({
      ...row, syncedAt, runId,
      recordKey: recordKeyOf(documents[index]?.path || `users/${row.id}`, config.hmacSecret),
      sourceUpdatedAt: documents[index]?.updatedAt ?? null,
    })));
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

// 本番を読み始める前にスキーマを確認する。列不足のまま走ると全テーブルの挿入が失敗し、
// 本番Firestoreの読み取りだけが無駄に発生する（2026-07-27 の事故）。
// DRY_RUN でも実行する。予行演習で列不足に気づけないと意味がないため。
await precheckSchema();

if (shouldSyncMaidReports()) {
  await syncMaidReports();
} else {
  console.info("MAID_REPORTS_SKIPPED 本番の読み取り負荷を抑えるため今回は月次レポートを同期しません");
}

// 全会員の同期（SYNC_ALL_USERS=true のときのみ）。初回およびユーザー属性を最新化したいときに使う。
if (process.env.SYNC_ALL_USERS === "true") {
  await syncAllUsers();
}

// 窓の組み立ては src/windows.ts の純関数へ委譲する（テスト可能にするため）。
//   BACKFILL_FROM / BACKFILL_TO / BACKFILL_DAYS … 過去の明示的な取り込み
//   RESCAN_DAYS                                  … 直近N日を毎回読み直し、後から入った
//                                                  イベントの修正を取り込む（指摘8の短期対策）
const windows = buildSyncWindows({
  start: config.start,
  end: config.end,
  backfillFrom: process.env.BACKFILL_FROM,
  backfillTo: process.env.BACKFILL_TO,
  backfillDays: Number(process.env.BACKFILL_DAYS || 0),
  rescanDays: Number(process.env.RESCAN_DAYS || 0),
});

// 窓ごとに実行。1窓失敗しても残りは続行し、最後にまとめて報告する（大量バックフィルの耐障害性）。
let failedWindows = 0;
let windowIndex = 0;
const degradedSources = new Set<string>();
for (const { start: windowStart, end: windowEnd, kind } of windows) {
  windowIndex += 1;
  // 途中でタイムアウトしても、どこまで進んだかログで分かるようにする。
  if (windows.length > 1) console.info(`WINDOW_PROGRESS ${windowIndex}/${windows.length} ${kind} ${windowStart.toISOString().slice(0, 10)}`);
  try {
    if (windows.length > 1) console.info(`WINDOW ${windowStart.toISOString()} .. ${windowEnd.toISOString()}`);
    const outcome = await syncWindow(windowStart, windowEnd, kind);
    for (const item of outcome.degraded) degradedSources.add(item.source);
  } catch (error) {
    failedWindows += 1;
    const err = error as { message?: string };
    console.error(`WINDOW_FAILED ${windowStart.toISOString()} .. ${windowEnd.toISOString()} : ${err?.message}`);
  }
}
// 一部の窓だけ失敗した状態を「成功」で終えると、欠損に気づけないまま
// Scheduler が次回を走らせてしまう。1窓でも失敗したら非0で終了する。
const status = failedWindows > 0 ? "failed" : degradedSources.size > 0 ? "degraded" : "ok";
console.info(JSON.stringify({
  run: { status, windows: windows.length, failedWindows, degradedSources: [...degradedSources] },
}));
if (status !== "ok") {
  console.error(
    failedWindows > 0
      ? `同期失敗: ${failedWindows}/${windows.length} 窓が失敗しました`
      : `同期は degraded です: ${[...degradedSources].join(", ")} を取得できませんでした`,
  );
  process.exit(1);
}
