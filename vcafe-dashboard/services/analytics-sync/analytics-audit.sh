#!/usr/bin/env bash
# データ品質監査。手動 grep 用の診断スクリプト群をここに統合し、
# 結果を dq_results テーブルへ記録する（BigQuery への読み書きのみ。本番Firestoreには触れない）。
#
#   bash analytics-audit.sh          # 実行して結果を dq_results へ記録
#   DRY_RUN=true bash analytics-audit.sh   # 記録せず表示のみ
#
# Cloud Scheduler から日次で叩くことを想定。fail が1件でもあれば非0終了する。
set -uo pipefail

PROJECT_ID="${PROJECT_ID:-vcafe-admin-analytics}"
DS="${BIGQUERY_DATASET:-vcafe_analytics}"
DRY_RUN="${DRY_RUN:-false}"
RUN_ID="audit-$(date -u +%Y%m%dT%H%M%SZ)"

echo "# project=${PROJECT_ID} dataset=${DS} runId=${RUN_ID} dryRun=${DRY_RUN}"

FAILURES=0
RESULTS=()

# check <名前> <SQL(単一の数値を返す)> <閾値> <比較: gt|lt> <説明>
check() {
  local name="$1" sql="$2" threshold="$3" op="$4" detail="$5"
  local value
  value="$(bq --project_id="${PROJECT_ID}" query --use_legacy_sql=false --format=csv "${sql}" 2>/dev/null | tail -1)"
  [[ -z "${value}" || "${value}" == "NULL" ]] && value=0

  # bc は入っていない環境がある（2026-07-29、この環境で実際に発生）。
  # `bc` が無いと `$(... | bc -l)` は空文字を返し、`(( "" ))` は構文エラーで
  # 常に偽になる。つまり閾値超過があっても常に「pass」と誤判定し、
  # しかもエラーは標準エラーに流れるだけで status には出ない、危険な壊れ方をする。
  # awk はどこにでもある。awk 側は「閾値を超えたか」を終了コードで返すだけにして、
  # bash 側で否定を重ねない（符号を間違えて常に pass/fail 側に倒れる事故を防ぐ）。
  local status="pass"
  if awk -v v="${value}" -v t="${threshold}" -v op="${op}" \
    'BEGIN { breached = (op == "gt") ? (v > t) : (v < t); exit breached ? 0 : 1 }'
  then
    status="fail"
  fi
  [[ "${status}" == "fail" ]] && FAILURES=$((FAILURES + 1))

  printf '%-32s %-6s 実測=%-12s 閾値=%-10s %s\n' "${name}" "${status}" "${value}" "${threshold}" "${detail}"
  RESULTS+=("${name}|${status}|${value}|${threshold}|${detail}")
}

echo
echo "== データ品質チェック =="

# 1. 課金ソースのカバレッジ: 台帳が無い月が残っていないか
check "payment_source_coverage" \
  "SELECT COUNTIF(ledger = 0) FROM (
     SELECT FORMAT_DATE('%Y%m', DATE(\`at\`, 'Asia/Tokyo')) AS ym,
            COUNTIF(source = 'userPayments') AS ledger
     FROM \`${PROJECT_ID}.${DS}.payments_raw\` GROUP BY ym)" \
  0 gt "台帳がカバーしていない月の数"

# 2. recordKey の重複（同一キーで異なる id ＝ HMAC 衝突）
check "duplicate_record_key" \
  "SELECT COUNT(*) FROM (
     SELECT recordKey FROM \`${PROJECT_ID}.${DS}.visits_raw\`
     WHERE recordKey IS NOT NULL GROUP BY recordKey HAVING COUNT(DISTINCT id) > 1)" \
  0 gt "HMAC衝突。0以外なら実装バグ"

# 3. 不正なタイムスタンプ
check "invalid_timestamps" \
  "SELECT COUNTIF(\`at\` IS NULL OR \`at\` < '2019-01-01' OR \`at\` > TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 1 DAY))
   FROM \`${PROJECT_ID}.${DS}.visits_current\`" \
  0 gt "範囲外・NULLのご帰宅日時"

# 4. 名簿に無いメイドID（同期側の reject が効いていれば0のはず）
check "orphan_maid_ids" \
  "SELECT COUNT(DISTINCT v.maidId) FROM \`${PROJECT_ID}.${DS}.visits_current\` v
   LEFT JOIN \`${PROJECT_ID}.${DS}.maid_profiles_current\` p ON p.id = v.maidId
   WHERE p.id IS NULL" \
  0 gt "名簿に存在しないメイドIDの数"

# 5. 滞在分の外れ値
check "minutes_outliers" \
  "SELECT COUNTIF(minutes IS NOT NULL AND (minutes <= 0 OR minutes > 240))
   FROM \`${PROJECT_ID}.${DS}.visits_current\`" \
  0 gt "0以下または240分超の滞在"

# 6. 売上の外れ値
check "revenue_outliers" \
  "SELECT COUNTIF(revenue < 0 OR revenue > 100000) FROM \`${PROJECT_ID}.${DS}.visits_current\`" \
  0 gt "負値または10万円超の売上"

# 7. 日次件数の不連続（前日比で9割以上落ちた日）
check "daily_count_discontinuity" \
  "WITH d AS (
     SELECT DATE(TIMESTAMP_SUB(\`at\`, INTERVAL 2 HOUR), 'Asia/Tokyo') AS business_date, COUNT(*) AS n
     FROM \`${PROJECT_ID}.${DS}.visits_current\`
     WHERE \`at\` >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
     GROUP BY business_date)
   SELECT COUNTIF(n < prev * 0.1) FROM (
     SELECT n, LAG(n) OVER (ORDER BY business_date) AS prev FROM d) WHERE prev IS NOT NULL" \
  0 gt "前日比9割減の日数（同期漏れの兆候）"

# 8. 鮮度: 最終同期からの経過
check "freshness_lag_minutes" \
  "SELECT COALESCE(MAX(freshnessLagMinutes), 99999) FROM \`${PROJECT_ID}.${DS}.sync_watermark\`" \
  180 gt "最終同期からの経過分"

# 9. 直近の同期に失敗・劣化がないか
check "recent_sync_failures" \
  "SELECT COUNTIF(status != 'ok') FROM \`${PROJECT_ID}.${DS}.sync_runs\`
   WHERE startedAt >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY)" \
  0 gt "直近24時間の失敗・劣化した同期の数"

# 10. 棄却率
check "reject_rate_24h" \
  "SELECT COALESCE(SAFE_DIVIDE(SUM(rejectedCount), NULLIF(SUM(readCount), 0)), 0)
   FROM \`${PROJECT_ID}.${DS}.sync_runs\`
   WHERE startedAt >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY)" \
  0.2 gt "直近24時間の変換棄却率"

echo
if [[ "${DRY_RUN}" != "true" ]]; then
  echo "== dq_results へ記録 =="
  VALUES=""
  for row in "${RESULTS[@]}"; do
    IFS='|' read -r name status value threshold detail <<< "${row}"
    # 文字列はシングルクォートをエスケープして埋め込む。
    detail_escaped="${detail//\'/\'\'}"
    [[ -n "${VALUES}" ]] && VALUES+=", "
    VALUES+="('${RUN_ID}', '${name}', '${status}', ${value}, ${threshold}, '${detail_escaped}', CURRENT_TIMESTAMP())"
  done
  bq --project_id="${PROJECT_ID}" query --use_legacy_sql=false \
    "INSERT INTO \`${PROJECT_ID}.${DS}.dq_results\`
       (runId, checkName, status, observedValue, threshold, details, checkedAt)
     VALUES ${VALUES}" >/dev/null && echo "記録しました（${#RESULTS[@]}件）"
else
  echo "（DRY_RUN のため記録しません）"
fi

echo
echo "----"
if (( FAILURES > 0 )); then
  echo "★ ${FAILURES}件のチェックが閾値を超えました。dq_results と sync_runs を確認してください。" >&2
  exit 1
fi
echo "すべてのチェックが閾値内です。"
