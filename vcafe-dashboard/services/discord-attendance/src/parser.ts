export type ShiftEventType = "absence" | "shift_change" | "shift_add" | "late" | "early_leave";

export interface ShiftTimeRange {
  startAt: string;
  endAt: string;
  localDate: string;
  startTime: string;
  endTime: string;
}

export interface ShiftSubmission {
  eventType: ShiftEventType;
  eventLabel: "欠勤" | "シフト変更" | "シフト追加" | "遅刻" | "早退";
  maidName: string;
  reason: string;
  targetRange?: ShiftTimeRange;
  removeRange?: ShiftTimeRange;
  addRange?: ShiftTimeRange;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pick(content: string, labels: string[]) {
  const names = labels.map(escapeRegExp).join("|");
  const match = content.match(new RegExp(`^(?:${names})\\s*[：:]\\s*(.+)$`, "im"));
  return (match?.[1] || "").trim().replace(/^\[|\]$/g, "").trim();
}

function nearestYear(month: number, day: number, receivedAt: Date) {
  const jst = new Date(receivedAt.getTime() + 9 * 60 * 60 * 1000);
  const referenceYear = jst.getUTCFullYear();
  const candidates = [referenceYear - 1, referenceYear, referenceYear + 1];
  return candidates.sort((a, b) => {
    const aDiff = Math.abs(Date.UTC(a, month - 1, day) - jst.getTime());
    const bDiff = Math.abs(Date.UTC(b, month - 1, day) - jst.getTime());
    return aDiff - bDiff;
  })[0];
}

function parseRange(value: string, receivedAt: Date): ShiftTimeRange | null {
  const match = value.match(/(?:(20\d{2})年)?\s*(\d{1,2})月\s*(\d{1,2})日[　\s]*([01]?\d|2[0-3])\s*[：:]\s*([0-5]\d)\s*[～〜~\-–—]\s*([01]?\d|2[0-3])\s*[：:]\s*([0-5]\d)/);
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const year = match[1] ? Number(match[1]) : nearestYear(month, day, receivedAt);
  const startHour = Number(match[4]);
  const startMinute = Number(match[5]);
  const endHour = Number(match[6]);
  const endMinute = Number(match[7]);
  if (month < 1 || month > 12) return null;
  const startAt = new Date(Date.UTC(year, month - 1, day, startHour - 9, startMinute));
  const localCheck = new Date(startAt.getTime() + 9 * 60 * 60 * 1000);
  if (localCheck.getUTCFullYear() !== year || localCheck.getUTCMonth() + 1 !== month || localCheck.getUTCDate() !== day || localCheck.getUTCHours() !== startHour || localCheck.getUTCMinutes() !== startMinute) return null;
  const endAt = new Date(Date.UTC(year, month - 1, day, endHour - 9, endMinute));
  if (endAt.getTime() <= startAt.getTime()) endAt.setUTCDate(endAt.getUTCDate() + 1);
  const two = (number: number) => String(number).padStart(2, "0");
  return {
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    localDate: `${year}-${two(month)}-${two(day)}`,
    startTime: `${two(startHour)}:${two(startMinute)}`,
    endTime: `${two(endHour)}:${two(endMinute)}`,
  };
}

const eventTypes: Record<string, ShiftEventType> = {
  "欠勤": "absence",
  "シフト変更": "shift_change",
  "シフト追加": "shift_add",
  "遅刻": "late",
  "早退": "early_leave",
};

export function parseShiftTemplate(content: string, receivedAt = new Date()): ShiftSubmission | null {
  const eventLabel = pick(content, ["依頼内容", "報告内容"]) as ShiftSubmission["eventLabel"];
  const eventType = eventTypes[eventLabel];
  const maidName = pick(content, ["メイド名"]);
  if (!eventType || !maidName || maidName.includes("●")) return null;

  const reason = pick(content, ["理由", "理由・補足"]);
  if (eventType === "shift_change") {
    const removeRange = parseRange(pick(content, ["削除する日時"]), receivedAt);
    const addRange = parseRange(pick(content, ["追加する日時"]), receivedAt);
    if (!removeRange || !addRange) return null;
    return { eventType, eventLabel, maidName, reason, removeRange, addRange };
  }
  if (eventType === "shift_add") {
    const addRange = parseRange(pick(content, ["追加する日時"]), receivedAt);
    return addRange ? { eventType, eventLabel, maidName, reason, addRange } : null;
  }
  const targetRange = parseRange(pick(content, ["対象日時"]), receivedAt);
  return targetRange ? { eventType, eventLabel, maidName, reason, targetRange } : null;
}
