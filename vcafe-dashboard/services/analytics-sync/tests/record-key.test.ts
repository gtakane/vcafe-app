import assert from "node:assert/strict";
import test from "node:test";
import { mapCheki, mapPresent, mapUserPayment, mapVisit, recordKeyOf, type SourceDocument } from "../src/transform.ts";

// 指摘7の再現テスト。
// collection group の document.id はグローバル一意ではない（親が違えば重複し得る）。
// BigQuery の insertId と ROW_NUMBER(PARTITION BY id) が id を一意前提にしていたため、
// 別ユーザー配下の同名ドキュメントが衝突し、片方が消える可能性があった。
// recordKey は「Firestoreのフルパス」から作るため親が違えば必ず別キーになる。

const secret = "0123456789abcdef0123456789abcdef";
const timestamp = (iso: string) => ({ toDate: () => new Date(iso) });
const maidMap = new Map([["こはる", "maid-01"]]);

test("recordKey は同じパスに対して決定的", () => {
  const path = "users/uid-a/userRecordVisits/v1";
  assert.equal(recordKeyOf(path, secret), recordKeyOf(path, secret));
  assert.equal(recordKeyOf(path, secret).length, 64);
});

test("recordKey に生のパス・ユーザーIDを含めない", () => {
  const key = recordKeyOf("users/uid-abcdef/userRecordVisits/v1", secret);
  assert.ok(!key.includes("uid-abcdef"));
  assert.ok(!key.includes("users"));
  assert.ok(!key.includes("v1"));
  assert.match(key, /^[0-9a-f]{64}$/);
});

test("同じ document.id でも親パスが違えば別の recordKey になる", () => {
  // 本番で起こり得る形: 別ユーザー配下に同じIDのドキュメント。
  const a = recordKeyOf("users/uid-a/userRecordVisits/same-id", secret);
  const b = recordKeyOf("users/uid-b/userRecordVisits/same-id", secret);
  assert.notEqual(a, b, "親が違うのに同じキーになると片方が重複排除で消える");
});

test("同じパスでも別コレクションなら別キーになる", () => {
  assert.notEqual(
    recordKeyOf("users/uid-a/userRecordVisits/x", secret),
    recordKeyOf("users/uid-a/userRecordPresents/x", secret),
  );
});

test("mapVisit が recordKey と sourceUpdatedAt を出力する", () => {
  const document: SourceDocument = {
    id: "same-id", parentId: "uid-a", path: "users/uid-a/userRecordVisits/same-id",
    updatedAt: "2026-07-21T12:00:00.000Z",
    data: { enterDateTime: timestamp("2026-07-21T11:00:00Z"), maidNickname: "こはる", usedTicketItemId: "ATCOIN" },
  };
  const row = mapVisit(document, secret, maidMap)!;
  assert.equal(row.recordKey, recordKeyOf("users/uid-a/userRecordVisits/same-id", secret));
  assert.equal(row.sourceUpdatedAt, "2026-07-21T12:00:00.000Z");
});

test("別ユーザーの同名ご帰宅は recordKey で区別される", () => {
  const base = { id: "v1", data: { enterDateTime: timestamp("2026-07-21T11:00:00Z"), maidNickname: "こはる", usedTicketItemId: "ATCOIN" } };
  const a = mapVisit({ ...base, parentId: "uid-a", path: "users/uid-a/userRecordVisits/v1" } as SourceDocument, secret, maidMap)!;
  const b = mapVisit({ ...base, parentId: "uid-b", path: "users/uid-b/userRecordVisits/v1" } as SourceDocument, secret, maidMap)!;
  assert.equal(a.id, b.id, "document.id は同じ（衝突の前提条件）");
  assert.notEqual(a.recordKey, b.recordKey);
});

test("cheki / present / userPayment も recordKey を持つ", () => {
  const cheki = mapCheki({ id: "c1", parentId: "uid-a", path: "users/uid-a/userAlbum/c1", data: { date: timestamp("2026-07-21T11:00:00Z"), maidNickname: "こはる" } } as SourceDocument, secret, maidMap, "2026-07-28T00:00:00Z")!;
  assert.match(cheki.recordKey, /^[0-9a-f]{64}$/);

  const present = mapPresent({ id: "p1", parentId: "uid-a", path: "users/uid-a/userRecordPresents/p1", data: { presentDateTime: timestamp("2026-07-21T11:00:00Z"), maidNickname: "こはる" } } as SourceDocument, secret, maidMap)!;
  assert.match(present.recordKey, /^[0-9a-f]{64}$/);

  const payment = mapUserPayment({ id: "up1", parentId: "uid-a", path: "users/uid-a/userPayments/up1", data: { amount: 1100, paymentDate: timestamp("2026-07-21T11:00:00Z") } } as SourceDocument, secret)!;
  assert.match(payment.recordKey, /^[0-9a-f]{64}$/);
  // 旧実装は id に仮名化IDの先頭8文字を連結して衝突回避していた。recordKey により不要。
  assert.equal(payment.id, "up1");
});

test("path が無い場合はコレクション名+idで代替キーを作る（衝突可能性を残さない）", () => {
  // トップレベルコレクション(payments/purchaseLog)は親が無いのでパスが単純。
  const a = recordKeyOf("payments/doc-1", secret);
  const b = recordKeyOf("purchaseLog/doc-1", secret);
  assert.notEqual(a, b, "同じdocument.idでもコレクションが違えば別キー");
});
