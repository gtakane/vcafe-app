#!/usr/bin/env python3
"""運営の月次指標CSVを BigQuery 取り込み用の NDJSON に変換する（import-monthly-kpi-csv.sh から使う）。

  python3 monthly-kpi-csv.py <CSV> <出力NDJSON> <出力スキーマJSON>

列は位置で読む（見出しに「総数」が4つあるため）。金額の ¥・桁区切り・括弧のマイナス・% を数値に直す。
2023年7月以前の「プレゼント」は件数（¥が無い）なので presentCount に入れる。
"""
import csv
import datetime
import io
import json
import re
import sys

COLUMNS = [
    ("sales", "num"), ("visits", "num"), ("unitPrice", "num"), ("photos", "num"), ("presentYen", "present"),
    ("uu", "num"), ("members", "num"), ("avgVisits", "num"), ("pur", "num"), ("arppu", "num"), ("arpu", "num"),
    ("newMembers", "num"), ("trial", "num"),
    ("b1Users", "num"), ("b2Users", "num"), ("b2Visits", "num"), ("b3Users", "num"), ("b3Visits", "num"),
    ("b4Users", "num"), ("b4Visits", "num"), ("b5Users", "num"), ("b5Visits", "num"),
    ("serveHours", "num"), ("maidReward", "num"), ("profit", "num"), ("costRate", "num"),
    ("events", "text"), ("url", "text"), ("joinedMaids", "text"), ("leftMaids", "text"),
]


def read_text(path):
    raw = open(path, "rb").read()
    for encoding in ("utf-8-sig", "cp932"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise SystemExit("CSVの文字コードを読めません（UTF-8 か Shift_JIS で保存してください）")


def number(cell):
    text = (cell or "").strip().replace("¥", "").replace("￥", "").replace(",", "").replace(" ", "")
    if text in ("", "-", "ー", "—"):
        return None
    negative = text.startswith("(") and text.endswith(")")
    text = text.strip("()")
    percent = text.endswith("%")
    text = text.rstrip("%")
    try:
        value = float(text)
    except ValueError:
        return None
    if percent:
        value /= 100
    return -value if negative else value


def month_of(cell):
    match = re.match(r"\s*(20\d{2})\s*[/\-年.]\s*(\d{1,2})", cell or "")
    return f"{match.group(1)}-{int(match.group(2)):02d}" if match else None


def convert(path):
    rows = []
    reader = csv.reader(io.StringIO(read_text(path)))
    header = next(reader)
    if len(header) < 31 or "年月" not in header[0]:
        raise SystemExit(f"見出しが想定と違います（31列・先頭が年月）: {header[:5]}…")
    imported_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    for record in reader:
        month = month_of(record[0] if record else "")
        if not month:
            continue
        record = record + [""] * (31 - len(record))
        row = {"month": month, "importedAt": imported_at}
        for index, (key, kind) in enumerate(COLUMNS, start=1):
            cell = record[index]
            if kind == "text":
                text = (cell or "").strip()
                row[key] = text or None
            elif kind == "present":
                # ¥付きは金額、¥なしは件数（2023年7月以前）
                value = number(cell)
                if value is not None and ("¥" in cell or "￥" in cell):
                    row["presentYen"] = value
                elif value is not None:
                    row["presentCount"] = value
            else:
                row[key] = number(cell)
        rows.append(row)
    return rows


def schema():
    fields = [{"name": "month", "type": "STRING", "mode": "REQUIRED"}]
    for key, kind in COLUMNS:
        fields.append({"name": key, "type": "STRING" if kind == "text" else "FLOAT64"})
        if kind == "present":
            fields.append({"name": "presentCount", "type": "FLOAT64"})
    fields.append({"name": "importedAt", "type": "TIMESTAMP", "mode": "REQUIRED"})
    return fields


def main():
    source, out_rows, out_schema = sys.argv[1:4]
    rows = convert(source)
    if not rows:
        raise SystemExit("取り込める行がありません")
    with open(out_rows, "w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    with open(out_schema, "w", encoding="utf-8") as handle:
        json.dump(schema(), handle, ensure_ascii=False)
    first, last = rows[0]["month"], rows[-1]["month"]
    print(f"{len(rows)} か月分（{first}〜{last}）")
    for row in rows[-3:]:
        shown = {k: row.get(k) for k in ("sales", "visits", "uu", "members", "trial", "serveHours", "maidReward")}
        print(f"  {row['month']}: {shown}")


if __name__ == "__main__":
    main()
