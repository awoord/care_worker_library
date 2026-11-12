#!/usr/bin/env python3
"""介護過程攻略マップを HTML / JSON 化する。"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_hikaku import build_questions_json  # noqa: E402
from build_jiritsu_hikaku import (  # noqa: E402
    collect_qids,
    page_shell,
    parse_seikai_map,
    seikai_table_html,
)
from jiritsu_qb import load_qb_qids  # noqa: E402

STUDY_DIR = ROOT / "work" / "study"
THEMES_DIR = ROOT / "kaigo" / "kakomon" / "themes"
DATA_DIR = THEMES_DIR / "data"
MD_PATH = STUDY_DIR / "介護過程_攻略マップ.md"
HTML_NAME = "hikaku-kaigo-katei.html"
JSON_NAME = "hikaku-kaigo-katei.json"
TITLE = "介護過程攻略マップ"
JSON_URL = f"data/{JSON_NAME}"


def main() -> None:
    md = MD_PATH.read_text(encoding="utf-8")
    sections = parse_seikai_map(md)
    if not sections:
        raise SystemExit(f"カテゴリが読めません: {MD_PATH}")

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    qb_ids = load_qb_qids()
    qids = collect_qids(sections)
    payload = build_questions_json(qids)
    payload["title"] = TITLE
    (DATA_DIR / JSON_NAME).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    main_html = seikai_table_html(sections, qb_ids)
    (THEMES_DIR / HTML_NAME).write_text(
        page_shell(
            TITLE,
            "hikaku-page hikaku-page--seikai hikaku-page--kaigo-katei",
            JSON_URL,
            main_html,
        ),
        encoding="utf-8",
    )

    n = sum(len(s["entries"]) for s in sections)
    print(
        f"介護過程攻略マップ HTML: {THEMES_DIR / HTML_NAME}"
        f"（{len(sections)} 段階 / 適切 {n}）"
    )
    print(
        f"介護過程攻略マップ JSON: {DATA_DIR / JSON_NAME}"
        f"（{payload.get('count', len(qids))} 問, "
        f"欠落 {len(payload.get('missing') or [])}）"
    )


if __name__ == "__main__":
    main()
