#!/usr/bin/env bash
# migrations/ 配下のSQLを分析用プロジェクトへ適用する（本番Firestoreには触れない）。
#   bash apply-migration.sh 001-record-key-dedup.sql
#
# ★ recordKey 系の切替は「全期間の再バックフィル完了後」にのみ適用すること。
#   途中で適用すると同じドキュメントが二重に現れる。docs/migration-recordkey.md を参照。
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-vcafe-admin-analytics}"
DATASET="${BIGQUERY_DATASET:-vcafe_analytics}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="${1:?適用するマイグレーション名を指定してください（例: 001-record-key-dedup.sql）}"
FILE="${SCRIPT_DIR}/migrations/${NAME}"
[[ -f "${FILE}" ]] || { echo "見つかりません: ${FILE}" >&2; exit 1; }

echo "# project=${PROJECT_ID} dataset=${DATASET} migration=${NAME}"

# recordKey 系は前提チェックを必須にする（未バックフィルでの適用を防ぐ）。
if [[ "${NAME}" == *record-key* ]]; then
  echo "== 前提チェック: recordKey が全行に入っているか =="
  MISSING="$(bq --project_id="${PROJECT_ID}" query --use_legacy_sql=false --format=csv \
    "SELECT
       (SELECT COUNT(*) FROM \`${PROJECT_ID}.${DATASET}.visits_raw\` WHERE recordKey IS NULL)
     + (SELECT COUNT(*) FROM \`${PROJECT_ID}.${DATASET}.cheki_raw\` WHERE recordKey IS NULL)
     + (SELECT COUNT(*) FROM \`${PROJECT_ID}.${DATASET}.shifts_raw\` WHERE recordKey IS NULL)
     + (SELECT COUNT(*) FROM \`${PROJECT_ID}.${DATASET}.presents_raw\` WHERE recordKey IS NULL)
     + (SELECT COUNT(*) FROM \`${PROJECT_ID}.${DATASET}.payments_raw\` WHERE recordKey IS NULL) AS missing" \
    2>/dev/null | tail -1)"
  echo "recordKey が NULL の行: ${MISSING}"
  if [[ "${MISSING}" != "0" ]]; then
    echo "★ 中止します。再バックフィルが未完了です。" >&2
    echo "  このまま適用すると、recordKey を持たない旧行と持つ新行が別々に残り二重計上になります。" >&2
    exit 1
  fi
fi

python3 - "${FILE}" "${PROJECT_ID}" "${DATASET}" <<'PY' > /tmp/vcafe-migration.sql
import sys, pathlib
sql = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
sys.stdout.write(sql.replace("PROJECT_ID", sys.argv[2]).replace("DATASET_ID", sys.argv[3]))
PY

# ステートメント単位で流す（; 区切り）。
python3 - <<'PY'
import pathlib, subprocess, sys
sql = pathlib.Path("/tmp/vcafe-migration.sql").read_text(encoding="utf-8")
statements = [s.strip() for s in sql.split(";") if s.strip() and not s.strip().startswith("--")]
for i, statement in enumerate(statements, 1):
    print(f"--- [{i}/{len(statements)}] {statement.splitlines()[0][:80]} ---")
    result = subprocess.run(["bq", "query", "--use_legacy_sql=false", statement], capture_output=True, text=True)
    sys.stdout.write(result.stdout)
    if result.returncode != 0:
        sys.stderr.write(result.stderr)
        sys.exit(result.returncode)
PY
rm -f /tmp/vcafe-migration.sql
echo "完了: ${NAME} を適用しました"
