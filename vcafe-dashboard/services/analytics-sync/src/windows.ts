/**
 * 同期する時間窓の組み立て。
 *
 * 増分同期はイベント時刻（enterDateTime / openTime / paymentDate 等）で範囲選択するため、
 * **過去のイベントが後から修正されても次回の窓に入らない**（指摘8）。
 * `*_current` ビューは sourceUpdatedAt 降順で最新行を選ぶので、
 * 再度取り込みさえすれば修正は反映される。つまり必要なのは「再度読むこと」。
 *
 * 対策として、通常の増分窓に加えて **日次の広めな再走査窓** を持たせる。
 * RESCAN_DAYS=7 なら直近7日を毎回読み直し、その期間内の修正を拾える。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SyncWindow {
  start: Date;
  end: Date;
  /** incremental=通常の増分窓, rescan=修正取り込みの再走査, backfill=明示的な過去取り込み */
  kind: "incremental" | "rescan" | "backfill";
}

export interface WindowInput {
  /** 増分同期の窓（config.start / config.end）。 */
  start: Date;
  end: Date;
  backfillFrom?: string;
  backfillTo?: string;
  backfillDays?: number;
  /** 直近N日を毎回読み直す。0/未設定なら再走査しない。 */
  rescanDays?: number;
  now?: Date;
}

export function buildSyncWindows(input: WindowInput): SyncWindow[] {
  const now = input.now ?? new Date();
  const backfillFrom = (input.backfillFrom || "").trim();
  const backfillTo = (input.backfillTo || "").trim();
  const backfillDays = Number(input.backfillDays || 0);

  // バックフィル指定があるときは、それだけを実行する（再走査は重複するため付けない）。
  if (backfillFrom || (Number.isInteger(backfillDays) && backfillDays > 0)) {
    let endMs = now.getTime();
    if (backfillTo) {
      const parsedTo = new Date(`${backfillTo}T00:00:00Z`);
      if (Number.isNaN(parsedTo.getTime())) throw new Error("BACKFILL_TOはYYYY-MM-DD形式で指定してください");
      endMs = Math.min(parsedTo.getTime(), now.getTime());
    }
    let startMs: number;
    if (backfillFrom) {
      const parsed = new Date(`${backfillFrom}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime())) throw new Error("BACKFILL_FROMはYYYY-MM-DD形式で指定してください");
      startMs = parsed.getTime();
    } else {
      startMs = endMs - backfillDays * DAY_MS;
    }
    const total = Math.ceil((endMs - startMs) / DAY_MS);
    if (total < 1) throw new Error("バックフィル開始日が終了日以降です");
    if (total > 550) throw new Error(`バックフィル窓が多すぎます(${total})。BACKFILL_TO で550日以内に区切って実行してください`);
    const windows: SyncWindow[] = [];
    for (let cursor = startMs; cursor < endMs; cursor += DAY_MS) {
      windows.push({ start: new Date(cursor), end: new Date(Math.min(cursor + DAY_MS, endMs)), kind: "backfill" });
    }
    return windows;
  }

  const windows: SyncWindow[] = [{ start: input.start, end: input.end, kind: "incremental" }];

  // 再走査: 増分窓より前の期間を日単位で読み直し、後から入った修正を取り込む。
  const rescanDays = Number(input.rescanDays || 0);
  if (Number.isInteger(rescanDays) && rescanDays > 0) {
    if (rescanDays > 31) throw new Error("RESCAN_DAYSは31以内で指定してください");
    const rescanEnd = input.start.getTime(); // 増分窓と重複させない
    for (let day = 0; day < rescanDays; day += 1) {
      const end = rescanEnd - day * DAY_MS;
      windows.push({ start: new Date(end - DAY_MS), end: new Date(end), kind: "rescan" });
    }
  }
  return windows;
}
