"""過去問ドットコム（kaigofukushi.kakomonn.com）の問題URLを返す。

第29〜38回について、(回, 問題番号) → questions/{id} を組み立てる。
サイト側の欠番・ID飛びは実測に基づく。
"""

from __future__ import annotations

BASE_URL = "https://kaigofukushi.kakomonn.com/questions"

# 各回の問1の questions ID
_SESSION_START_ID: dict[int, int] = {
    29: 28062,
    30: 33135,
    31: 41844,
    32: 48707,
    33: 56936,
    34: 63193,
    35: 70251,
    36: 75007,
    37: 83468,
    38: 93166,
}


def question_id(session: int | str, number: int | str) -> int | None:
    """公式の回・問題番号から過去問ドットコムの questions ID を返す。無ければ None。"""
    try:
        s = int(session)
        n = int(number)
    except (TypeError, ValueError):
        return None

    start = _SESSION_START_ID.get(s)
    if start is None or n < 1:
        return None

    # 第29回: ID 28125 欠番。問64以降は +1。サイトは問124まで。
    if s == 29:
        if n >= 125:
            return None
        if n >= 64:
            return start + n
        return start + n - 1

    # 第33回: ID 57051（公式問116相当）欠番。それ以外は連続。
    if s == 33 and n == 116:
        return None

    return start + n - 1


def question_url(session: int | str, number: int | str) -> str | None:
    """解説ページURL。対応がなければ None。"""
    qid = question_id(session, number)
    if qid is None:
        return None
    return f"{BASE_URL}/{qid}"
