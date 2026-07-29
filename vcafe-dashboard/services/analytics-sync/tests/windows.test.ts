import assert from "node:assert/strict";
import test from "node:test";
import { buildSyncWindows } from "../src/windows.ts";

// 指摘8の再現テスト。
// 増分同期はイベント時刻で範囲選択するため、90分より古いイベントが後から修正されても
// 次回の窓に入らない。再走査窓でその期間を読み直せることを固定する。

const now = new Date("2026-07-28T12:00:00Z");
const incremental = { start: new Date("2026-07-28T10:30:00Z"), end: new Date("2026-07-28T12:00:00Z") };

test("再走査なしなら増分窓だけを返す（既存挙動）", () => {
  const windows = buildSyncWindows({ ...incremental, now });
  assert.equal(windows.length, 1);
  assert.equal(windows[0].kind, "incremental");
});

test("RESCAN_DAYS で直近N日を読み直す（90分より古い修正を拾える）", () => {
  const windows = buildSyncWindows({ ...incremental, rescanDays: 7, now });
  assert.equal(windows.length, 8); // 増分1 + 再走査7
  assert.equal(windows.filter((w) => w.kind === "rescan").length, 7);
});

test("3日前に発生したご帰宅の修正が再走査窓に含まれる", () => {
  const windows = buildSyncWindows({ ...incremental, rescanDays: 7, now });
  // 3日前のイベント時刻
  const oldEvent = new Date("2026-07-25T11:00:00Z").getTime();
  const covered = windows.some((w) => oldEvent >= w.start.getTime() && oldEvent < w.end.getTime());
  assert.ok(covered, "3日前のイベントがどの窓にも入っていない＝修正を取り込めない");
});

test("再走査窓は増分窓と重複しない（二重読み取りを避ける）", () => {
  const windows = buildSyncWindows({ ...incremental, rescanDays: 3, now });
  const inc = windows.find((w) => w.kind === "incremental")!;
  for (const w of windows.filter((x) => x.kind === "rescan")) {
    assert.ok(w.end.getTime() <= inc.start.getTime(), "再走査が増分窓と重なっている");
  }
});

test("再走査窓に隙間がない（連続した日次窓になる）", () => {
  const windows = buildSyncWindows({ ...incremental, rescanDays: 5, now })
    .filter((w) => w.kind === "rescan")
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  for (let i = 1; i < windows.length; i += 1) {
    assert.equal(windows[i].start.getTime(), windows[i - 1].end.getTime(), "窓の間に隙間がある");
  }
});

test("RESCAN_DAYS の上限を超えたら例外", () => {
  assert.throws(() => buildSyncWindows({ ...incremental, rescanDays: 60, now }), /RESCAN_DAYS/);
});

test("バックフィル指定時は再走査を付けない（重複するため）", () => {
  const windows = buildSyncWindows({ ...incremental, backfillFrom: "2026-07-20", backfillTo: "2026-07-23", rescanDays: 7, now });
  assert.equal(windows.length, 3);
  assert.ok(windows.every((w) => w.kind === "backfill"));
});

test("バックフィルの区間と上限は従来どおり", () => {
  const windows = buildSyncWindows({ ...incremental, backfillFrom: "2026-07-25", now });
  assert.equal(windows[0].start.toISOString(), "2026-07-25T00:00:00.000Z");
  assert.throws(() => buildSyncWindows({ ...incremental, backfillFrom: "2020-01-01", now }), /550/);
  assert.throws(() => buildSyncWindows({ ...incremental, backfillFrom: "2027-01-01", now }), /終了日以降/);
});

// 2026-07-29: RESCAN_DAYS を毎時大きくすると「N日×24回/日」の冗長読み取りが
// 売上規模に比例して増え続ける。直近だけ毎時読み直しつつ、それより古い期間は
// 1日1回のRESCAN_DEEP_DAYSでまとめて拾う階層化を固定する。
const jst5am = new Date("2026-07-28T20:00:00Z"); // JST 2026-07-29 05:00
const jst9am = new Date("2026-07-29T00:00:00Z"); // JST 2026-07-29 09:00（深い再走査の時刻ではない）

test("RESCAN_DEEP_DAYS指定時、深い再走査の時刻ならRESCAN_DAYSに加算される", () => {
  const windows = buildSyncWindows({ ...incremental, rescanDays: 1, rescanDeepDays: 2, rescanDeepHourJst: 5, now: jst5am });
  assert.equal(windows.filter((w) => w.kind === "rescan").length, 3); // 1(shallow) + 2(deep)
});

test("RESCAN_DEEP_DAYS指定時、深い再走査の時刻でなければRESCAN_DAYSのみ", () => {
  const windows = buildSyncWindows({ ...incremental, rescanDays: 1, rescanDeepDays: 2, rescanDeepHourJst: 5, now: jst9am });
  assert.equal(windows.filter((w) => w.kind === "rescan").length, 1); // shallowのみ
});

test("RESCAN_DEEP_DAYS未指定なら時刻に関わらずRESCAN_DAYSのみ（既存挙動）", () => {
  const windows = buildSyncWindows({ ...incremental, rescanDays: 1, now: jst5am });
  assert.equal(windows.filter((w) => w.kind === "rescan").length, 1);
});

test("RESCAN_DAYS + RESCAN_DEEP_DAYS の合計が上限を超えたら例外", () => {
  assert.throws(
    () => buildSyncWindows({ ...incremental, rescanDays: 20, rescanDeepDays: 20, rescanDeepHourJst: 5, now: jst5am }),
    /RESCAN_DAYS/,
  );
});
