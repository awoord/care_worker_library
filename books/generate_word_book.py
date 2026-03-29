#!/usr/bin/env python3
"""books/words.json を Jinja2 で HTML にレンダリングする。"""

from __future__ import annotations

import argparse
import html
import json
import webbrowser
from pathlib import Path

from jinja2 import Environment, FileSystemLoader


def highlight_first_occurrence(text: str, word: str) -> str:
    """例文をエスケープし、見出し語の最初の一致をマークする。"""
    esc = html.escape(text)
    w = html.escape(word)
    i = esc.find(w)
    if i < 0:
        return esc
    return (
        esc[:i]
        + '<span class="card-keyword">'
        + w
        + "</span>"
        + esc[i + len(w) :]
    )


def freq_stars(count: int) -> str:
    """出現回数から頻度バッジ用の星（word_book.html と同系のしきい値）。"""
    if count >= 500:
        return "★★★"
    if count >= 150:
        return "★★"
    return "★"


def build_entries(words: list[dict]) -> list[dict]:
    out = []
    for i, w in enumerate(words, start=1):
        row = dict(w)
        row["index"] = i
        row["stars"] = freq_stars(int(w["count"]))
        row["example_html"] = highlight_first_occurrence(w["example"], w["word"])
        out.append(row)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="words.json から単語帳 HTML を生成")
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="生成後にブラウザを開かない",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="出力 HTML（既定: books/word_book_generated.html）",
    )
    args = parser.parse_args()

    base_dir = Path(__file__).resolve().parent
    json_path = base_dir / "words.json"
    out_path = args.output or (base_dir / "word_book_generated.html")

    if not json_path.exists():
        raise SystemExit(f"見つかりません: {json_path}")

    with open(json_path, encoding="utf-8") as f:
        words_data = json.load(f)

    env = Environment(
        loader=FileSystemLoader(str(base_dir)),
        autoescape=True,
    )
    template = env.get_template("word_book.j2")

    entries = build_entries(words_data)
    html_content = template.render(
        title="介護福祉士国家試験 頻出語リスト",
        entries=entries,
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    print(f"出力: {out_path}")
    if not args.no_browser:
        webbrowser.open(out_path.resolve().as_uri())


if __name__ == "__main__":
    main()
