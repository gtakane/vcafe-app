import assert from "node:assert/strict";
import test from "node:test";
import { fetchAllPages, type Page, type PageCursor } from "../src/paging.ts";

// 指摘4の再現テスト。
// 旧実装は .limit(maxDocuments) だけで上限到達を検知せず、超過分が無言で欠落していた。

/** dateField + パスでページングする擬似データソース。 */
function source(total: number) {
  const all = Array.from({ length: total }, (_, i) => ({
    path: `users/u${String(i).padStart(4, "0")}/userRecordVisits/v${i}`,
    at: new Date(Date.UTC(2026, 6, 21, 0, i)).toISOString(),
  }));
  let calls = 0;
  const fetchPage = async (cursor: PageCursor | null, size: number): Promise<Page<typeof all[number]>> => {
    calls += 1;
    const startIndex = cursor ? all.findIndex((d) => d.path === cursor.path) + 1 : 0;
    const documents = all.slice(startIndex, startIndex + size);
    const last = documents.at(-1);
    return { documents, cursor: last ? { dateValue: last.at, path: last.path } : null };
  };
  return { fetchPage, calls: () => calls };
}

test("複数ページにまたがっても全件を取得する", async () => {
  const s = source(250);
  const result = await fetchAllPages(s.fetchPage, { pageSize: 100, maxTotal: 5000 });
  assert.equal(result.documents.length, 250);
  assert.equal(result.readCount, 250);
  assert.equal(result.limitReached, false);
  assert.ok(s.calls() >= 3, "ページングが行われていない");
  // 重複・欠落がないこと
  assert.equal(new Set(result.documents.map((d) => d.path)).size, 250);
});

test("MAX_DOCUMENTS+1 件のとき limitReached を立てる（無言で欠落させない）", async () => {
  const s = source(101);
  const result = await fetchAllPages(s.fetchPage, { pageSize: 50, maxTotal: 100 });
  assert.equal(result.limitReached, true, "上限到達を検知できていない");
  assert.equal(result.documents.length, 100);
});

test("ちょうど上限件数のときは limitReached を立てない", async () => {
  const s = source(100);
  const result = await fetchAllPages(s.fetchPage, { pageSize: 50, maxTotal: 100 });
  assert.equal(result.limitReached, false);
  assert.equal(result.documents.length, 100);
});

test("1ページで収まる場合は1回で終わる", async () => {
  const s = source(10);
  const result = await fetchAllPages(s.fetchPage, { pageSize: 100, maxTotal: 5000 });
  assert.equal(result.pages, 1);
  assert.equal(result.documents.length, 10);
  assert.equal(result.limitReached, false);
});

test("0件でも安全に終了する", async () => {
  const s = source(0);
  const result = await fetchAllPages(s.fetchPage, { pageSize: 100, maxTotal: 5000 });
  assert.equal(result.documents.length, 0);
  assert.equal(result.limitReached, false);
});

test("同一時刻が並んでもパスで前進し無限ループしない", async () => {
  // すべて同じ日付フィールド値。dateValue だけをカーソルにすると進まない。
  const all = Array.from({ length: 30 }, (_, i) => ({ path: `p/${i}`, at: "2026-07-21T00:00:00Z" }));
  const fetchPage = async (cursor: PageCursor | null, size: number): Promise<Page<typeof all[number]>> => {
    const startIndex = cursor ? all.findIndex((d) => d.path === cursor.path) + 1 : 0;
    const documents = all.slice(startIndex, startIndex + size);
    const last = documents.at(-1);
    return { documents, cursor: last ? { dateValue: last.at, path: last.path } : null };
  };
  const result = await fetchAllPages(fetchPage, { pageSize: 10, maxTotal: 5000 });
  assert.equal(result.documents.length, 30);
  assert.equal(new Set(result.documents.map((d) => d.path)).size, 30);
});

test("不正なページ設定は例外にする", async () => {
  const s = source(1);
  await assert.rejects(() => fetchAllPages(s.fetchPage, { pageSize: 0, maxTotal: 10 }), /pageSize/);
  await assert.rejects(() => fetchAllPages(s.fetchPage, { pageSize: 10, maxTotal: 0 }), /maxTotal/);
});
