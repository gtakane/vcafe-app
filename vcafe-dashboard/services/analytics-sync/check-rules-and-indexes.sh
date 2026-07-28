#!/usr/bin/env bash
# メイド実績管理アプリの ALL 表示が止まっている件で、
# 「データではなく設定が変わったのか」を確認する（すべて読み取りのみ・本番は変更しない）。
#
#   bash check-rules-and-indexes.sh
#
# 見るもの:
#   1. Firestore セキュリティルールの更新履歴（いつ・誰が変えたか）
#   2. 現在有効なルールの中身（maidWorkReport の list 権限）
#   3. 複合インデックスとフィールド除外の一覧
#   4. Hosting のリリース履歴（本当にアプリを出していないかの裏取り）
set -uo pipefail

PROJECT="${PRODUCTION_PROJECT_ID:-v-athome-cafe-app}"
SITE="${HOSTING_SITE:-app-vmaid-mgr}"
TOKEN="$(gcloud auth print-access-token 2>/dev/null)"

if [[ -z "${TOKEN}" ]]; then
  echo "gcloud のアクセストークンを取得できませんでした。gcloud auth login を実行してください。" >&2
  exit 1
fi

api() { curl -sS -H "Authorization: Bearer ${TOKEN}" "$1"; }
py() { python3 -c "$1" 2>/dev/null; }

echo "# project=${PROJECT}"

echo
echo "=================================================================="
echo "1) Firestore セキュリティルールの更新履歴（新しい順）"
echo "=================================================================="
echo "   ★ 障害が起きた日付の直前に作成されたルールがあれば、それが原因です"
RULESETS="$(api "https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets?pageSize=20")"
echo "${RULESETS}" | py "
import sys,json
d=json.load(sys.stdin)
if 'error' in d:
    print('取得できませんでした:', d['error'].get('message'))
    print('→ Firebase Rules API が無効な場合は、コンソールの Firestore > ルール > 履歴 で確認してください')
    sys.exit()
rs=sorted(d.get('rulesets',[]), key=lambda r: r.get('createTime',''), reverse=True)
if not rs: print('（0件）')
for r in rs[:20]:
    print(f\"- {r.get('createTime')}  {r['name'].split('/')[-1]}\")
"

echo
echo "-- 現在ブラウザに適用されているルール（release: cloud.firestore） --"
RELEASE="$(api "https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases")"
LIVE="$(echo "${RELEASE}" | py "
import sys,json
d=json.load(sys.stdin)
for r in d.get('releases',[]):
    if r['name'].endswith('cloud.firestore'):
        print(r['rulesetName'])
        break
")"
echo "${RELEASE}" | py "
import sys,json
d=json.load(sys.stdin)
for r in d.get('releases',[]):
    if r['name'].endswith('cloud.firestore'):
        print('有効化された日時:', r.get('updateTime'), ' ruleset:', r.get('rulesetName','').split('/')[-1])
"

echo
echo "=================================================================="
echo "2) 現在有効なルールの中身"
echo "=================================================================="
if [[ -n "${LIVE}" ]]; then
  api "https://firebaserules.googleapis.com/v1/${LIVE}" | py "
import sys,json
d=json.load(sys.stdin)
files=d.get('source',{}).get('files',[])
for f in files:
    print('----', f.get('name'), '----')
    print(f.get('content',''))
"
else
  echo "有効なルールを特定できませんでした。コンソールの Firestore > ルール を確認してください。"
fi

echo
echo "=================================================================="
echo "3) 複合インデックス（削除されていないか）"
echo "=================================================================="
gcloud firestore indexes composite list --project="${PROJECT}" --format="table(name.basename(),collectionGroup,queryScope,fields)" 2>&1 | head -60

echo
echo "-- フィールドの除外設定（除外を付けるとそのフィールドで検索できなくなります） --"
gcloud firestore indexes fields list --project="${PROJECT}" --format="table(name,indexConfig.usesAncestorConfig)" 2>&1 | head -60

echo
echo "=================================================================="
echo "4) Hosting のリリース履歴（アプリを出していないかの裏取り）"
echo "=================================================================="
api "https://firebasehosting.googleapis.com/v1beta1/sites/${SITE}/releases?pageSize=10" | py "
import sys,json
d=json.load(sys.stdin)
if 'error' in d:
    print('取得できませんでした:', d['error'].get('message'))
    sys.exit()
for r in d.get('releases',[]):
    v=r.get('version',{})
    print(f\"- {r.get('releaseTime')}  type={r.get('type')}  by={ (r.get('releaseUser') or {}).get('email','?') }\")
"

echo
echo "----"
echo "読み方:"
echo "・1) に障害発生直前のルール更新があれば、それが原因。直前のルールへ戻せば復旧します"
echo "・2) で maidWorkReport の allow list / allow read の条件を確認してください"
echo "   get（1件取得）は通るのに list（一覧取得）が拒否されると、ALLだけが止まります"
echo "・4) にアプリのリリースがあれば、デプロイしていないという前提が崩れます"
