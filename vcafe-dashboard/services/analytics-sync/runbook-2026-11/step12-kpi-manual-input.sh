#!/usr/bin/env bash
# 月次指標の表から手入力できるようにする（分析用BigQueryのみ）。
#   1. 手入力の値を記録する表 monthly_kpi_overrides を作る（既にあれば何もしない）
#   2. ダッシュボードの実行SAに、この表だけ書き込み権限（BigQuery データ編集者）を付ける
#      ほかの表は今までどおり読み取りのみ。本番のアプリ（v-athome-cafe-app）は触らない。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
TABLE="${P}:${DS}.monthly_kpi_overrides"
SA=$(gcloud run services describe vcafe-dashboard --region=$R --project=$P --format='value(spec.template.spec.serviceAccountName)')
[[ -n "${SA}" ]] || { echo "ダッシュボードの実行SAを取得できませんでした"; exit 1; }
echo "  表        : ${TABLE}"
echo "  書き込む人: ${SA}（この表だけ）"
confirm "表を作り、上の実行SAにこの表だけ書き込み権限を付けます。"
bq query --project_id=$P --use_legacy_sql=false --quiet "
CREATE TABLE IF NOT EXISTS \`${P}.${DS}.monthly_kpi_overrides\` (
  month STRING NOT NULL, field STRING NOT NULL, numberValue FLOAT64, textValue STRING,
  cleared BOOL, enteredAt TIMESTAMP NOT NULL, enteredBy STRING
)"
bq add-iam-policy-binding --member="serviceAccount:${SA}" --role="roles/bigquery.dataEditor" "${TABLE}" >/dev/null
echo "→ 完了。ダッシュボードの月次指標で、セルをクリックすると手入力できます（配備後）。"
