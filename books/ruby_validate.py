"""LLM 出力のルビ付き HTML が、元テキストの漢字を漏れなくカバーしているか検証する。"""

from __future__ import annotations

import html
import re
from collections import Counter


def is_kanji(ch: str) -> bool:
    return len(ch) == 1 and ("\u4e00" <= ch <= "\u9fff" or ch == "\u3005")


def kanji_multiset(text: str) -> Counter[str]:
    return Counter(c for c in text if is_kanji(c))


# <ruby>親<rt>よみ</rt></ruby>（親・よみに < を含まない単純形）
_RUBY_RE = re.compile(r"<ruby>([^<]+)<rt>[^<]*</rt></ruby>", re.IGNORECASE)


def strip_noise_tags(fragment: str) -> str:
    """検証前に LLM が付けた可能性のある span 等を除去。"""
    s = re.sub(r"</?span\b[^>]*>", "", fragment, flags=re.IGNORECASE)
    return s.strip()


def kanji_outside_ruby(fragment: str) -> str:
    """<ruby>…</ruby> 外に残る漢字（ルビ漏れ）を列挙。"""
    s = strip_noise_tags(fragment)
    s = _RUBY_RE.sub("", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    return "".join(c for c in s if is_kanji(c))


def kanji_inside_ruby_bases(fragment: str) -> Counter[str]:
    """各 <ruby> の親文字に含まれる漢字の multiset。"""
    s = strip_noise_tags(fragment)
    bases: list[str] = []
    for m in _RUBY_RE.finditer(s):
        bases.append(m.group(1))
    combined = "".join(bases)
    return kanji_multiset(combined)


def visible_text_from_ruby_html(fragment: str) -> str:
    """ルビを親文字に置換しタグを除いた可視テキスト（原文との照合用）。"""
    s = strip_noise_tags(fragment)
    s = _RUBY_RE.sub(r"\1", s)
    s = re.sub(r"<[^>]+>", "", s)
    return html.unescape(s)


def validate_ruby_html(plain: str, fragment: str, *, label: str) -> tuple[bool, str]:
    """
    plain に含まれる漢字がすべて ruby の親文字側に現れ、ruby 外に漢字が無いこと。
    可視テキストは plain と一致すること（文字単位）。
    """
    if not plain.strip():
        if not fragment.strip():
            return True, ""
        return False, f"{label}: 元テキストが空なのに HTML があります"

    frag = strip_noise_tags(fragment)
    if not frag:
        if kanji_multiset(plain):
            return False, f"{label}: 漢字があるのにルビ HTML が空です"
        return visible_text_from_ruby_html(plain) == plain or True, ""

    outside = kanji_outside_ruby(frag)
    if outside:
        return False, f"{label}: <ruby> 外に漢字が残っています: {outside!r}"

    want = kanji_multiset(plain)
    got = kanji_inside_ruby_bases(frag)
    if want != got:
        return (
            False,
            f"{label}: 漢字の数が一致しません want={dict(want)} got={dict(got)}",
        )

    vis = visible_text_from_ruby_html(frag)
    if vis != plain:
        return (
            False,
            f"{label}: 可視テキストが原文と一致しません\n"
            f"  原文 repr: {plain!r}\n"
            f"  生成 repr: {vis!r}",
        )

    return True, ""


if __name__ == "__main__":
    ok, msg = validate_ruby_html(
        "勧める",
        "<ruby>勧<rt>すす</rt></ruby>める",
        label="t",
    )
    assert ok, msg
    ok, msg = validate_ruby_html(
        "に関するテスト",
        "に<ruby>関<rt>かん</rt></ruby>するテスト",
        label="t",
    )
    assert ok, msg
    ok, msg = validate_ruby_html("勧める", "勧める", label="t")
    assert not ok
    print("ruby_validate: ok")
