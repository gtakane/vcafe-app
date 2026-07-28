#!/usr/bin/env bash
# manifest と実際の BigQuery スキーマを INFORMATION_SCHEMA.COLUMNS で照合する。
#
#   bash check-bigquery-schema.sh                    # 既存データセットと照合（読み取りのみ）
#   TEMP_DATASET=true bash check-bigquery-schema.sh  # 一時データセットへ schema.sql を適用して照合し、削除する
#
# CI / nightly から実行する想定。差分があれば非0終了する。
# 本番Firestoreには一切触れない（分析用プロジェクトのみ）。
set -uo pipefail

PROJECT_ID="${PROJECT_ID:-vcafe-admin-analytics}"
LOCATION="${BIGQUERY_LOCATION:-asia-northeast1}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${TEMP_DATASET:-false}" == "true" ]]; then
  DS="schema_check_$(date -u +%Y%m%d%H%M%S)_$RANDOM"
  echo "# 一時データセット ${DS} を作成して schema.sql を適用します"
  bq --project_id="${PROJECT_ID}" --location="${LOCATION}" mk --dataset \
    --default_table_expiration=3600 "${PROJECT_ID}:${DS}" >/dev/null
  cleanup() {
    echo "# 一時データセット ${DS} を削除します"
    bq --project_id="${PROJECT_ID}" rm -r -f -d "${PROJECT_ID}:${DS}" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT
  BIGQUERY_DATASET="${DS}" bash "${SCRIPT_DIR}/apply-schema.sh" >/dev/null || {
    echo "★ schema.sql の適用に失敗しました" >&2; exit 1;
  }
else
  DS="${BIGQUERY_DATASET:-vcafe_analytics}"
  echo "# 既存データセット ${DS} と照合します（読み取りのみ）"
fi

echo "# project=${PROJECT_ID} dataset=${DS}"

ACTUAL="$(bq --project_id="${PROJECT_ID}" query --use_legacy_sql=false --format=csv \
  "SELECT table_name, column_name FROM \`${PROJECT_ID}.${DS}.INFORMATION_SCHEMA.COLUMNS\` ORDER BY table_name, column_name" 2>/dev/null | tail -n +2)"

if [[ -z "${ACTUAL}" ]]; then
  echo "★ INFORMATION_SCHEMA を取得できませんでした" >&2
  exit 1
fi

echo "${ACTUAL}" | python3 - "${SCRIPT_DIR}/src/schema-manifest.json" <<'PY'
import json, sys, collections

manifest = json.load(open(sys.argv[1]))["tables"]
actual = collections.defaultdict(set)
for line in sys.stdin.read().splitlines():
    if not line.strip():
        continue
    table, column = line.split(",", 1)
    actual[table.strip()].add(column.strip())

problems = []
for table, columns in manifest.items():
    expected = set(columns)
    if table not in actual:
        # ビューは manifest に含めないため、テーブルのみを対象にする。
        problems.append(f"{table}: BigQuery に存在しない（schema.sql 未適用の可能性）")
        continue
    missing = expected - actual[table]
    extra = actual[table] - expected
    if missing:
        problems.append(f"{table}: BigQuery に無い列 {sorted(missing)}（schema.sql を適用してください）")
    if extra:
        problems.append(f"{table}: manifest に無い列 {sorted(extra)}（npm run schema:manifest で再生成、または不要列を確認）")

print(f"照合したテーブル: {len(manifest)}")
if problems:
    print(f"\n★ 差分 {len(problems)} 件:")
    for p in problems:
        print(f"  - {p}")
    sys.exit(1)
print("manifest と BigQuery のスキーマは一致しています。")
PY
STATUS=$?

echo
if (( STATUS != 0 )); then
  echo "★ スキーマに差分があります。TypeScript の型と BigQuery のずれは実行時まで表面化しないため、必ず解消してください。" >&2
fi
exit "${STATUS}"
