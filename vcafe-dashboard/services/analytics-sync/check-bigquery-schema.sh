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

# 後片付けは1つの trap にまとめる。EXIT の trap は上書きされるため、
# 一時データセットの削除と一時ファイルの削除を別々に仕掛けてはいけない。
ACTUAL_FILE="$(mktemp)"
TEMP_DS=""
cleanup() {
  rm -f "${ACTUAL_FILE}"
  if [[ -n "${TEMP_DS}" ]]; then
    echo "# 一時データセット ${TEMP_DS} を削除します"
    bq --project_id="${PROJECT_ID}" rm -r -f -d "${PROJECT_ID}:${TEMP_DS}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ "${TEMP_DATASET:-false}" == "true" ]]; then
  DS="schema_check_$(date -u +%Y%m%d%H%M%S)_$RANDOM"
  echo "# 一時データセット ${DS} を作成して schema.sql を適用します"
  bq --project_id="${PROJECT_ID}" --location="${LOCATION}" mk --dataset \
    --default_table_expiration=3600 "${PROJECT_ID}:${DS}" >/dev/null
  TEMP_DS="${DS}"
  BIGQUERY_DATASET="${DS}" bash "${SCRIPT_DIR}/apply-schema.sh" >/dev/null || {
    echo "★ schema.sql の適用に失敗しました" >&2; exit 1;
  }
else
  DS="${BIGQUERY_DATASET:-vcafe_analytics}"
  echo "# 既存データセット ${DS} と照合します（読み取りのみ）"
fi

echo "# project=${PROJECT_ID} dataset=${DS}"

# --location は必須。省略すると既定ロケーション(US)で探しに行き、
# asia-northeast1 のデータセットが「見つからない」扱いになる。
# --max_rows も必須。既定は100行までで、テーブル数×列数がそれを超えると
# 後半のテーブルが黙って欠落し、実在するテーブルを「存在しない」と誤報告する
# （2026-07-29 に実際に発生。schema.sql は適用済みだった）。
ACTUAL="$(bq --project_id="${PROJECT_ID}" --location="${LOCATION}" query --use_legacy_sql=false --format=csv --max_rows=100000 \
  "SELECT table_name, column_name FROM \`${PROJECT_ID}.${DS}.INFORMATION_SCHEMA.COLUMNS\` ORDER BY table_name, column_name" 2>/dev/null | tail -n +2)"

if [[ -z "${ACTUAL}" ]]; then
  echo "★ INFORMATION_SCHEMA を取得できませんでした（project=${PROJECT_ID} dataset=${DS} location=${LOCATION}）" >&2
  echo "  データセット名・ロケーション・権限を確認してください。" >&2
  exit 1
fi

# 比較はファイル経由で渡す。`python3 - <<'PY'` はヒアドキュメントが標準入力を
# 占有するため、パイプで渡したデータは届かない（全テーブルを「存在しない」と
# 誤報告していた原因）。比較処理は scripts/compare-schema.py にありテスト済み。
printf '%s\n' "${ACTUAL}" > "${ACTUAL_FILE}"

python3 "${SCRIPT_DIR}/scripts/compare-schema.py" "${SCRIPT_DIR}/src/schema-manifest.json" "${ACTUAL_FILE}"
STATUS=$?

echo
if (( STATUS != 0 )); then
  echo "★ スキーマに差分があります。TypeScript の型と BigQuery のずれは実行時まで表面化しないため、必ず解消してください。" >&2
fi
exit "${STATUS}"
