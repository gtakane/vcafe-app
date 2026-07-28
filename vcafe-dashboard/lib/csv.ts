/**
 * CSV 出力。
 *
 * 先頭が = + - @ の値は表計算ソフトで数式として実行され得る（CSVインジェクション）。
 * シングルクォートを前置して無害化する。BOM を付けて Excel の文字化けを防ぐ。
 */
export function toCsv(rows: Array<Array<string | number>>): string {
  const safe = (value: string | number) => {
    const raw = String(value);
    const escaped = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${escaped.replaceAll('"', '""')}"`;
  };
  return "﻿" + rows.map((row) => row.map(safe).join(",")).join("\r\n");
}

/** ブラウザでCSVをダウンロードさせる。 */
export function downloadCsv(filename: string, rows: Array<Array<string | number>>): void {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
