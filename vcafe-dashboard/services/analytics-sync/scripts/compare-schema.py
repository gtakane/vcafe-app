#!/usr/bin/env python3
"""manifest と BigQuery の実スキーマ(CSV)を突き合わせる。

    python3 compare-schema.py <manifest.json> <actual.csv>

actual.csv は `table_name,column_name` の2列（ヘッダ無し）。
差分があれば非0で終了する。

なぜ別ファイルなのか:
    以前は check-bigquery-schema.sh の中で

        echo "${ACTUAL}" | python3 - manifest.json <<'PY' ... PY

    としていた。`python3 -` はプログラムを **標準入力から** 読むため、
    ヒアドキュメントが標準入力を占有し、パイプで渡した CSV は届かない。
    その結果 sys.stdin.read() が常に空文字列となり、
    **BigQuery の状態にかかわらず全テーブルを「存在しない」と報告していた。**
    データはファイル経由で渡し、比較処理はテストできる場所に置く。
"""
import collections
import json
import sys


def load_actual(path):
    actual = collections.defaultdict(set)
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            # ヘッダ行が残っていても無視する。
            if line == "table_name,column_name":
                continue
            if "," not in line:
                # bq がエラー文言を stdout に出した場合など。黙って0件扱いにしない。
                print(f"★ 想定外の行を受け取りました: {line[:120]}", file=sys.stderr)
                sys.exit(1)
            table, column = line.split(",", 1)
            actual[table.strip()].add(column.strip())
    return actual


def main():
    if len(sys.argv) != 3:
        print("usage: compare-schema.py <manifest.json> <actual.csv>", file=sys.stderr)
        return 2

    manifest = json.load(open(sys.argv[1], encoding="utf-8"))["tables"]
    actual = load_actual(sys.argv[2])

    # 1件も受け取っていないのに「全テーブルが無い」と報告しない。
    # 比較対象が届いていないだけの可能性が高く、それを差分として出すと
    # 正常なスキーマを異常と誤認させる（実際にそう誤認させた）。
    if not actual:
        print(
            "★ BigQuery から列情報を1件も受け取れませんでした。\n"
            "  データセット名・ロケーション・権限を確認してください。\n"
            "  （スキーマの差分ではありません。比較そのものが行えていません）",
            file=sys.stderr,
        )
        return 1

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

    print(f"照合したテーブル: {len(manifest)}（BigQuery 側の実テーブル/ビュー: {len(actual)}）")
    if problems:
        print(f"\n★ 差分 {len(problems)} 件:")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print("manifest と BigQuery のスキーマは一致しています。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
