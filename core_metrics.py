"""収益・訪問分類・営業日・重みの共通ロジック（Python側）。

vcafe-dashboard/lib/metrics.ts と**同じ値**を返すことが契約。
両者は vcafe-dashboard/tests/fixtures/rounding-golden.json を共有し、
TypeScript と Python の双方のテストから同じ fixture を実行して一致を検証する。

pandas に依存しないため、契約テストが依存関係なしで動く。
core.py はこのモジュールを利用する（定数と計算の二重定義を避けるため）。

丸め規則: **half-up**（0.5は常に切り上げ）。
Python 組み込みの round() は偶数丸め（round(2.5) == 2）であり、
JavaScript の Math.round（0.5切り上げ）と食い違うため使用しない。
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

JST = timezone(timedelta(hours=9))

TICKET_PRICES = {
    "gokitaku30minutes": 840,
    "premiumGokitaku1": 960,
    "luckyGokitaku": 650,
}
RESERVATION_PRICE = 3920
CHEKI_PRICE = 500
COIN_TO_YEN = 1.4
FREE_TICKET_IDS = frozenset({"trial10minutes"})
DEFAULT_INITIAL_TIME = 20


def round_half_up(value: float) -> int:
    """0.5を常に切り上げる。JavaScript の Math.round と同じ挙動。"""
    return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def visit_weight(initial_time) -> int:
    """滞在時間による重み。20分=1枠。lib/metrics.ts の visitWeight と一致する。"""
    try:
        raw = float(initial_time) if initial_time is not None else float(DEFAULT_INITIAL_TIME)
    except (TypeError, ValueError):
        raw = float(DEFAULT_INITIAL_TIME)
    safe = raw if raw > 0 else float(DEFAULT_INITIAL_TIME)
    return max(1, round_half_up(safe / DEFAULT_INITIAL_TIME))


def classify_visit(ticket_id: str, room_type: str) -> str:
    """訪問種別。lib/metrics.ts の classifyVisit と一致する。"""
    if ticket_id in FREE_TICKET_IDS:
        return "trial"
    if room_type == "reservation":
        return "reservation"
    return "paid"


def calc_revenue(visit_type: str, ticket_id: str, billed_coin: float, billed_reward: float) -> int:
    """収益。lib/metrics.ts の visitRevenue と一致する。"""
    if visit_type in ("trial", "free"):
        return 0
    if visit_type == "reservation":
        return RESERVATION_PRICE
    if ticket_id in TICKET_PRICES:
        return TICKET_PRICES[ticket_id]
    return round_half_up((float(billed_coin) + float(billed_reward)) * COIN_TO_YEN)


def business_date_jst(at_iso: str) -> str:
    """営業日（JST, 'YYYY-MM-DD'）。JSTの0:00〜1:59は前日の営業日として扱う。"""
    parsed = datetime.fromisoformat(at_iso.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    shifted = parsed.astimezone(JST) - timedelta(hours=2)
    return shifted.date().isoformat()
