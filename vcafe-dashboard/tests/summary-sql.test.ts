import assert from "node:assert/strict";
import test from "node:test";
import { buildSummarySql, buildTrendSql } from "../lib/summary-sql.ts";
import { CHEKI_PRICE } from "../lib/metrics.ts";

// 段階1（サーバー集計）の前提テスト。
// SQL とクライアント集計（lib/analytics.ts の summarize / buildTrend）で
// 指標の定義がずれると、同じ画面の同じ指標が経路によって別の値になる。
// 指摘9で実際に起きた事故と同じ構図なので、定義の対応をここで固定する。
//
// SQL の実行結果そのものは BigQuery が必要なため、ここでは
// 「SQLが正しい定義を表現しているか」を構文レベルで検証する。
// 実データでの一致は services/analytics-sync/verify-summary-sql.sh で確認する。

const sql = buildSummarySql("proj", "ds");

test("ご帰宅数は重み合計（件数ではない）", () => {
  assert.match(sql, /SUM\(weight\)[\s\S]*?AS visits/);
  assert.ok(!/COUNT\(\*\)\s+AS visits/.test(sql), "件数で数えている");
});

test("有料数は trial 以外の重み合計（予約も有料に含む）", () => {
  assert.match(sql, /SUM\(IF\(type != 'trial', weight, 0\)\)[\s\S]*?AS paid/);
  // 予約を除外していないこと（core.py: 有料=非trial）
  assert.ok(!/type != 'reservation'/.test(sql), "予約を有料から除外している");
});

test("売上はチェキ単価を定数として含む", () => {
  assert.ok(sql.includes(`revenue + cheki * ${CHEKI_PRICE}`), "チェキ単価が定数と一致しない");
});

test("ユニークユーザーは DISTINCT customerId", () => {
  assert.match(sql, /COUNT\(DISTINCT customerId\)[\s\S]*?AS customerCount/);
});

test("実働時間は未打刻を予定時刻で補完する", () => {
  // shiftActualHours と同じ: actualStart/End が無ければ scheduled で補完
  assert.match(sql, /COALESCE\(actualEnd, scheduledEnd\)/);
  assert.match(sql, /COALESCE\(actualStart, scheduledStart\)/);
});

test("遅刻は負値にならない（GREATEST で0止め）", () => {
  assert.match(sql, /GREATEST\(TIMESTAMP_DIFF\(COALESCE\(actualStart, scheduledStart\), scheduledStart, SECOND\), 0\)/);
});

test("営業日は JST から2時間引いた日付（0:00〜1:59は前日）", () => {
  assert.ok(sql.includes('TIMESTAMP_SUB(`at`, INTERVAL 2 HOUR), "Asia/Tokyo"'));
  assert.ok(sql.includes('TIMESTAMP_SUB(scheduledStart, INTERVAL 2 HOUR), "Asia/Tokyo"'));
});

test("maidId 指定時のみ絞り込みが入る（パラメータ化されている）", () => {
  const withMaid = buildSummarySql("proj", "ds", "maid-01");
  assert.ok(withMaid.includes("AND maidId = @maidId"), "メイド絞り込みが無い");
  assert.ok(!sql.includes("AND maidId = @maidId"), "未指定なのに絞り込みが入っている");
  // 値を直接埋め込んでいないこと（インジェクション対策）
  assert.ok(!withMaid.includes("maid-01"), "maidId を SQL へ直接埋め込んでいる");
});

test("推移は粒度ごとに正しいバケットを使う", () => {
  assert.match(buildTrendSql("p", "d", "hour"), /FORMAT_TIMESTAMP\("%m\/%d %H:00"/);
  assert.match(buildTrendSql("p", "d", "day"), /FORMAT_DATE\("%m\/%d"/);
  assert.match(buildTrendSql("p", "d", "week"), /WEEK\(MONDAY\)/);
  assert.match(buildTrendSql("p", "d", "month"), /FORMAT_DATE\("%Y\/%m"/);
  // 時間別だけは実時刻（営業日ではない）
  assert.ok(!buildTrendSql("p", "d", "hour").includes('FORMAT_TIMESTAMP("%m/%d %H:00", TIMESTAMP_SUB'));
});

test("推移も重み合計で数え、時系列順に並べる", () => {
  const trend = buildTrendSql("p", "d", "day");
  assert.match(trend, /SUM\(weight\) AS visits/);
  assert.match(trend, /ORDER BY sortAt/);
});
