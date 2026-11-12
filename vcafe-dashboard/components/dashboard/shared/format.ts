// 画面共通の表示フォーマット。数値・通貨・日時の表記をここに集約する。
export const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
export const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
export const number = new Intl.NumberFormat("ja-JP");

// 書式の部品は一度だけ作って使い回す（表の全セルで作り直すとメモリと時間を大きく使う）。
const JST_DATE = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
const JST_DATE_TIME = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export const jstDate = (value: string | null) =>
  value ? JST_DATE.format(new Date(value)) : "未設定";

export const jstDateTime = (value: string) =>
  JST_DATE_TIME.format(new Date(value));

/** 遅刻時間などは小数点第3位以下を切り捨てる（四捨五入しない）。 */
export const truncate2 = (n: number) => Math.floor(n * 100) / 100;

const GENDER_LABELS: Record<string, string> = { male: "男性", female: "女性", other: "その他" };
export const genderLabel = (value: string) => GENDER_LABELS[value] || (value ? value : "未設定");
