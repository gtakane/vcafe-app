"""指摘10の契約テスト（Python側）。

TypeScript の tests/rounding-contract.test.ts と**同じ fixture** を読み、
core.py の実装が同じ値を返すことを検証する。

実行:
    python3 vcafe-dashboard/tests/rounding_contract_test.py

丸め規則は half-up（0.5は常に切り上げ）。Python 組み込みの round() は
偶数丸め（bankers rounding）のため、initialTime=50 で TypeScript と食い違っていた。
"""

import json
import pathlib
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

import core_metrics as core  # noqa: E402

FIXTURE = json.loads((pathlib.Path(__file__).parent / "fixtures" / "rounding-golden.json").read_text(encoding="utf-8"))

failures: list[str] = []


def check(label: str, actual, expected) -> None:
    if actual != expected:
        failures.append(f"{label}: actual={actual!r} expected={expected!r}")


def main() -> int:
    assert FIXTURE["rule"]["name"] == "half-up", "契約: 丸め規則は half-up"

    for item in FIXTURE["visitWeight"]:
        got = core.visit_weight(item["initialTime"])
        check(f"visitWeight initialTime={item['initialTime']!r} {item.get('note', '')}", got, item["expected"])

    for item in FIXTURE["visitRevenue"]:
        got = core.calc_revenue(item["type"], item["ticketId"], item["billedCoin"], item["billedReward"])
        check(
            f"visitRevenue {item['ticketId']} coin={item['billedCoin']} reward={item['billedReward']} {item.get('note', '')}",
            got,
            item["expected"],
        )

    for item in FIXTURE["businessDateJst"]:
        got = core.business_date_jst(item["atIso"])
        check(f"businessDateJst {item['atIso']} {item.get('note', '')}", got, item["expected"])

    total = len(FIXTURE["visitWeight"]) + len(FIXTURE["visitRevenue"]) + len(FIXTURE["businessDateJst"])
    if failures:
        print(f"# fail {len(failures)} / {total}")
        for line in failures:
            print(f"  not ok - {line}")
        return 1
    print(f"# pass {total} / {total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
