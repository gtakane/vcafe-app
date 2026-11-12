#!/usr/bin/env bash
# 運営の月次指標CSVを、月次指標の画面の「2026年10月以前の値」として取り込む（丸ごと入れ替え）。
#   1. Cloud Shell の右上「︙」→「アップロード」で CSV を送る（ホームに置かれる）
#   2. bash import-monthly-kpi-csv.sh ~/ファイル名.csv
# 分析用BigQueryのみに書き込む。CSV は公開リポジトリに置かないこと（売上・報酬・メイド名を含むため）。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
CSV=${1:-}
if [[ ! -f "${CSV}" ]]; then
  [[ -n "${CSV}" ]] && echo "ファイルが見つかりません: ${CSV}"
  echo "使い方: bash import-monthly-kpi-csv.sh ~/monthly-kpi.csv（名前に空白があるときは \"\" で囲む）"
  echo "ホームにあるCSV:"
  ls -1 ~/*.csv 2>/dev/null | sed 's/^/  /' || echo "  （ありません。Cloud Shell の「︙」→「アップロード」で送ってください）"
  exit 2
fi
WORK=$(mktemp -d); trap 'rm -rf "${WORK}"' EXIT
python3 "${HERE}/monthly-kpi-csv.py" "${CSV}" "${WORK}/rows.ndjson" "${WORK}/schema.json"
confirm "上の内容で monthly_kpi_history を入れ替えます。"
bq load --project_id=$P --replace --source_format=NEWLINE_DELIMITED_JSON "${DS}.monthly_kpi_history" "${WORK}/rows.ndjson" "${WORK}/schema.json"
echo "→ 取り込みました。月次指標の画面を開き直すと反映されます。"
