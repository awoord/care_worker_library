"""利用者本位マップ: クエスチョン・バンク掲載問の判定と「もっと見る」HTML。"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
QUESTION_BANK_TXT = ROOT / "work" / "question_bank" / "question_bank_2027.txt"
RE_QID = re.compile(r"【\s*(\d+)\s*-\s*(\d+)")


def load_qb_qids() -> set[str]:
    """テキスト問題バンクのID＋第38回全問（QB全掲載）を返す。"""
    ids: set[str] = set()
    if QUESTION_BANK_TXT.is_file():
        for line in QUESTION_BANK_TXT.read_text(encoding="utf-8").splitlines():
            m = RE_QID.search(line)
            if m:
                ids.add(f"{int(m.group(1))}-{int(m.group(2))}")
    for n in range(1, 126):
        ids.add(f"38-{n}")
    return ids


def partition_qb_entries(
    entries: list[dict], qb_ids: set[str]
) -> tuple[list[dict], list[dict]]:
    """QB該当を先、それ以外を後。元の相対順はそれぞれ維持。"""
    in_qb: list[dict] = []
    out_qb: list[dict] = []
    for e in entries:
        if e.get("qid") in qb_ids:
            in_qb.append(e)
        else:
            out_qb.append(e)
    return in_qb, out_qb


def more_block_html(inner: str, count: int) -> str:
    """折りたたみブロック。inner は項目HTMLの連結。"""
    return (
        f'<div class="jiritsu-more">'
        f'<button type="button" class="jiritsu-more-toggle" '
        f'aria-expanded="false" data-more-count="{count}">'
        f'<span class="jiritsu-more-chevron" aria-hidden="true">▸</span>'
        f"QB以外を見る（{count}）</button>"
        f'<div class="jiritsu-more-body" hidden>{inner}</div>'
        f"</div>"
    )


def entries_with_qb_more_html(
    sec: dict,
    *,
    qb_ids: set[str],
    entry_line_html,
    lead_html: str = "",
) -> str:
    """リード＋QB先出し＋（あれば）QB外のもっと見る。番号は表示順で振り直し。

    QB該当が無いカテゴリも、QB以外を折りたたんで出す。
    """
    parts: list[str] = []
    if lead_html:
        parts.append(lead_html)
    in_qb, out_qb = partition_qb_entries(sec.get("entries") or [], qb_ids)

    idx = 1
    for entry in in_qb:
        parts.append(entry_line_html(sec["num"], idx, entry))
        idx += 1
    if out_qb:
        more_parts = []
        for entry in out_qb:
            more_parts.append(entry_line_html(sec["num"], idx, entry))
            idx += 1
        parts.append(more_block_html("".join(more_parts), len(out_qb)))
    return "".join(parts)
