#!/usr/bin/env bash
# 分析用プロジェクトのBigQueryへ schema.sql（テーブル＋重複排除ビュー）を適用する。
# 分析用プロジェクトにのみ書き込む安全な操作。本番プロジェクトには一切触れない。
set -euo pipefail

PROJECT_ID="${ANALYTICS_PROJECT_ID:-vcafe-admin-analytics}"
DATASET_ID="${BIGQUERY_DATASET:-vcafe_analytics}"
LOCATION="${BIGQUERY_LOCATION:-asia-northeast1}"

if [[ "${PROJECT_ID}" == "v-athome-cafe-app" ]]; then
  echo "本番プロジェクトにスキーマを適用しようとしています。中止します。" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "データセットを作成（存在すれば無視）: ${PROJECT_ID}:${DATASET_ID} (${LOCATION})"
bq --project_id="${PROJECT_ID}" --location="${LOCATION}" mk --dataset --force "${PROJECT_ID}:${DATASET_ID}" || true

echo "schema.sql のプレースホルダを置換して実行します。"
FILLED_SQL="$(mktemp)"
trap 'rm -f "${FILLED_SQL}"' EXIT
sed -e "s/PROJECT_ID/${PROJECT_ID}/g" -e "s/DATASET_ID/${DATASET_ID}/g" "${SCRIPT_DIR}/schema.sql" > "${FILLED_SQL}"

# schema.sql を「;」区切りで1文ずつ実行する。
# 理由: bq query に複数文をまとめて渡すと一部の文しか実行されず、テーブルが部分的に
#       しか作られないことがある。1文ずつ stdin で渡すことで、
#       (1) 先頭の "--" コメント行をフラグと誤認する問題を回避し、
#       (2) どの文が失敗したかを明示し、部分適用を防ぐ。
python3 - "${FILLED_SQL}" "${PROJECT_ID}" "${LOCATION}" <<'PY'
import subprocess
import sys

sql = open(sys.argv[1], encoding="utf-8").read()
project, location = sys.argv[2], sys.argv[3]
statements = [s.strip() for s in sql.split(";") if s.strip()]
failed = 0
for index, statement in enumerate(statements, start=1):
    label = next(
        (line.strip() for line in statement.splitlines() if line.strip() and not line.strip().startswith("--")),
        statement,
    )[:72]
    print(f"--- [{index}/{len(statements)}] {label} ---")
    result = subprocess.run(
        ["bq", f"--project_id={project}", f"--location={location}", "query", "--use_legacy_sql=false", "--format=none"],
        input=statement,
        text=True,
    )
    if result.returncode != 0:
        failed += 1
        print(f"!! 文 {index} が失敗しました")
if failed:
    print(f"!! {failed} 文が失敗しました")
    sys.exit(1)
print("OK: 全文の適用が完了しました")
PY

echo "完了: テーブルと *_current ビューを ${PROJECT_ID}:${DATASET_ID} に適用しました。"
