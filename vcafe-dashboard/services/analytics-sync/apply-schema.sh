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
# schema.sql は先頭が "--" コメント行のため、SQLを引数で渡すと bq がフラグと誤認して
# RecursionError になる。stdin から渡してSQLコメントとして正しく解釈させる。
bq --project_id="${PROJECT_ID}" --location="${LOCATION}" query --use_legacy_sql=false < "${FILLED_SQL}"

echo "完了: テーブルと *_current ビューを ${PROJECT_ID}:${DATASET_ID} に適用しました。"
