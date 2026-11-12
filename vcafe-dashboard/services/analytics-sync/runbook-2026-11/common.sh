# 各手順スクリプトの共通設定（直接は実行しない）。
P=vcafe-admin-analytics
R=asia-northeast1
JOB=vcafe-analytics-sync
SCHEDULER=vcafe-analytics-sync-schedule
DS=vcafe_analytics
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYNC_DIR="$(cd "${HERE}/.." && pwd)"
DASHBOARD_DIR="$(cd "${SYNC_DIR}/../.." && pwd)"
PREV_IMAGE_FILE="${HOME}/.vcafe-sync-prev-image"

confirm() {
  echo
  read -r -p "$1 よろしければ yes と入力してください: " answer
  if [[ "${answer}" != "yes" ]]; then echo "中止しました。何も変更していません。"; exit 1; fi
}

# 同期ジョブが現在使っているプログラム（コンテナイメージ）名。
# gcloud の --format のフィールド指定は版によって階層が違うため、YAML から image 行を拾う。
current_job_image() {
  gcloud run jobs describe $JOB --region=$R --project=$P --format=yaml \
    | awk '$1 == "image:" || $1 == "-" && $2 == "image:" { print $NF; exit }'
}
