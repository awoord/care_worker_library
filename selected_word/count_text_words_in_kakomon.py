#!/usr/bin/env python3
"""
text_woreds.csv の単語が kaigo_kakomon_all.txt に何回出現するかを数え、
出現回数が多い順で text_woreds.csv を上書きする。

使い方:
  python3 count_text_words_in_kakomon.py
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

DIR = Path(__file__).resolve().parent
ROOT = DIR.parent
WORDS_CSV = DIR / "text_woreds.csv"
KAKOMON_TXT = ROOT / "kakomon" / "kaigo_kakomon_all.txt"


def load_words(path: Path) -> list[str]:
    words: list[str] = []
    seen: set[str] = set()
    with path.open(encoding="utf-8", newline="") as f:
        for row in csv.reader(f):
            if not row:
                continue
            word = str(row[0]).strip()
            if not word or word in seen:
                continue
            words.append(word)
            seen.add(word)
    return words


def count_occurrences(text: str, words: list[str]) -> list[tuple[str, int]]:
    counted = [(word, text.count(word)) for word in words]
    counted.sort(key=lambda item: (-item[1], item[0]))
    return counted


def write_csv(path: Path, rows: list[tuple[str, int]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, lineterminator="\n")
        for word, count in rows:
            writer.writerow([word, count])


def main() -> int:
    if not WORDS_CSV.is_file():
        print(f"単語CSVが見つかりません: {WORDS_CSV}", file=sys.stderr)
        return 1
    if not KAKOMON_TXT.is_file():
        print(f"過去問テキストが見つかりません: {KAKOMON_TXT}", file=sys.stderr)
        return 1

    words = load_words(WORDS_CSV)
    if not words:
        print("単語が1件もありません。", file=sys.stderr)
        return 1

    text = KAKOMON_TXT.read_text(encoding="utf-8")
    rows = count_occurrences(text, words)
    write_csv(WORDS_CSV, rows)

    nonzero = sum(1 for _, count in rows if count > 0)
    print(f"完了: {len(rows)} 語（出現あり {nonzero} / 出現0 {len(rows) - nonzero}）")
    print(f"出力: {WORDS_CSV}")
    for word, count in rows[:5]:
        print(f"  {word},{count}")
    if len(rows) > 5:
        print("  ...")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
