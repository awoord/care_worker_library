#!/usr/bin/env python3
"""第2ラウンド: meaning 内の N3 超寄り・硬い表現を平易な日本語へ（見出し語の example は触らない）。"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
JSON_PATH = ROOT / "extracted_words.json"

# 長いフレーズから先に置換（部分一致の取りこぼし防止）
PHRASE_REPLACEMENTS: list[tuple[str, str]] = [
    (
        "分けて調べ、性質や理由を明らかにすること。",
        "分けてよく調べ、どうなっているか・なぜそうかまでわかるようにすること。",
    ),
    (
        "ほかと区別される、目立った性質や様子。",
        "ほかとちがって見わけやすいようす。",
    ),
    ("基準に合うと、正式に認めること。", "決められた条件に合うと、正式に認めること。"),
    (
        "組織や細胞の性質が、病気で変わること。",
        "からだの細かい部分のようすが、病気で変わること。",
    ),
    ("特に目立つ性質があること。", "とくにほかより目立つこと。"),
    ("できないと決めることして、やめること。", "できないと決めて、やめること。"),
    ("途切れず、同じようすや行為を続けること。", "途切れず、同じようなようすや同じことを続けること。"),
    ("計画をはっきりしたに考えて作ること。", "計画を、はっきり考えて作ること。"),
    ("ほかに作用して、結果を変えること。", "ほかからの働きかけで、結果が変わること。"),
    ("実際に起こる、観察できるできごと。", "実際に起こり、見てわかるできごと。"),
    ("全体を見て、必要な指示を出すこと。", "全体を見て、必要なことを言って進め方を伝えること。"),
]

# 見出し語ごとの意味全文（置換のあと上書きしたい場合）
WORD_MEANING_OVERRIDE: dict[str, str] = {}


def apply_phrases(meaning: str) -> str:
    for old, new in PHRASE_REPLACEMENTS:
        if old in meaning:
            meaning = meaning.replace(old, new)
    return meaning


def main() -> None:
    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    for entry in data:
        w = entry["word"]
        m = entry["meaning"]
        m = apply_phrases(m)
        if w in WORD_MEANING_OVERRIDE:
            m = WORD_MEANING_OVERRIDE[w]
        entry["meaning"] = m
    JSON_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {JSON_PATH}")


if __name__ == "__main__":
    main()
