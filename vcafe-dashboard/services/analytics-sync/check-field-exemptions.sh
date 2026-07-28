#!/usr/bin/env bash
# Firestore の「除外(フィールド単一インデックス)」の中身を検査する（読み取りのみ・本番は変更しない）。
#
#   bash check-field-exemptions.sh
#
# 除外はインデックスを「追加」する設定ではなく、そのフィールドのインデックス構成を
# 丸ごと置き換える設定。チェックを入れなかったスコープのインデックスは削除される。
# コレクション スコープの昇順/降順が消えていると、アプリの通常のクエリが失敗する。
set -uo pipefail

PROJECT="${PRODUCTION_PROJECT_ID:-v-athome-cafe-app}"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

echo "# project=${PROJECT}"

cat >"${WORK}/fields.py" <<'PY'
import sys, json

try:
    fields = json.load(sys.stdin)
except Exception:
    print("取得できませんでした。gcloud firestore indexes fields list を直接実行してください。")
    sys.exit(0)

problems = []
for f in fields:
    parts = f.get("name", "").split("/")
    group = parts[parts.index("collectionGroups") + 1] if "collectionGroups" in parts else "?"
    field = parts[-1]
    if group == "__default__":
        continue

    have = set()
    for idx in ((f.get("indexConfig") or {}).get("indexes") or []):
        scope = idx.get("queryScope", "COLLECTION")
        for spec in idx.get("fields", []):
            have.add((scope, spec.get("order") or spec.get("arrayConfig") or "?"))

    col = sorted(m for s, m in have if s == "COLLECTION")
    grp = sorted(m for s, m in have if s == "COLLECTION_GROUP")

    print("")
    print("■ %s.%s" % (group, field))
    print("   コレクション スコープ        : %s" % (", ".join(col) if col else "★ なし（このフィールドでの通常クエリは失敗します）"))
    print("   コレクショングループ スコープ: %s" % (", ".join(grp) if grp else "なし"))

    # 通常のアプリは COLLECTION スコープの昇順/降順を使う。これが無いと壊れる。
    if not any(m in ("ASCENDING", "DESCENDING") for m in col):
        problems.append("%s.%s" % (group, field))

print("")
print("==================================================================")
print("2) 判定")
print("==================================================================")
if problems:
    print("★ コレクション スコープの並べ替えインデックスが消えているフィールド:")
    for p in problems:
        print("   - %s" % p)
    print("")
    print("   このフィールドを where / orderBy に使うクエリは FAILED_PRECONDITION で失敗します。")
    print("   コンソール > Firestore > インデックス > 一括除外(自動) から該当の除外を開き、")
    print("   コレクション スコープの「昇順」「降順」にチェックを入れて保存すれば復旧します。")
    print("   （除外そのものを削除しても既定のインデックスに戻るので復旧します）")
else:
    print("コレクション スコープのインデックスはすべて残っています。除外は原因ではありません。")
PY

cat >"${WORK}/composite.py" <<'PY'
import sys, json

try:
    idx = json.load(sys.stdin)
except Exception:
    print("取得できませんでした")
    sys.exit(0)

print("複合インデックス: %d件" % len(idx))
for i in idx:
    parts = i.get("name", "").split("/")
    group = parts[parts.index("collectionGroups") + 1] if "collectionGroups" in parts else "?"
    spec = ", ".join(
        ("%s %s" % (x.get("fieldPath"), x.get("order") or x.get("arrayConfig") or "")).strip()
        for x in i.get("fields", [])
    )
    print("- %s [%s] %s  state=%s" % (group, i.get("queryScope"), spec, i.get("state")))
PY

echo
echo "=================================================================="
echo "1) 除外が設定されているフィールドと、残っているインデックス"
echo "=================================================================="
gcloud firestore indexes fields list --project="${PROJECT}" --format=json 2>/dev/null \
  | python3 "${WORK}/fields.py"

echo
echo "=================================================================="
echo "3) 複合インデックスの全件数（コンソールの表示と一致するか）"
echo "=================================================================="
gcloud firestore indexes composite list --project="${PROJECT}" --format=json 2>/dev/null \
  | python3 "${WORK}/composite.py"

echo
echo "----"
echo "※ 問題が見つかった場合でも、本番の設定変更はそちらで実施してください。"
