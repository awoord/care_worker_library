#!/usr/bin/env python3
"""
text_woreds.csv をワンクリック更新する。

1. text_woreds.csv を読む（手入力の語）
2. GAS から最新 db を取得し db_words.csv を更新
3. db と重複する語を除外
4. 残りを過去問全文で出現回数カウントし、多い順で上書き

使い方:
  python3 work/selected_word/refresh_text_words.py
"""

from __future__ import annotations

import sys
from pathlib import Path

DIR = Path(__file__).resolve().parent
if str(DIR) not in sys.path:
    sys.path.insert(0, str(DIR))

from count_text_words_in_kakomon import (  # noqa: E402
    DB_WORDS_CSV,
    KAKOMON_TXT,
    WORDS_CSV,
    count_occurrences,
    exclude_db_words,
    load_words,
    write_csv,
)
from remove_db_from_extracted import fetch_db_words, save_db_words  # noqa: E402


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
    print(f"入力: {len(words)} 語 ← {WORDS_CSV.name}")

    print("dbシートから単語を取得中...")
    try:
        db_words = fetch_db_words()
    except Exception as err:
        print(f"エラー: {err}", file=sys.stderr)
        return 1
    save_db_words(DB_WORDS_CSV, db_words)
    print(f"  {DB_WORDS_CSV.name} を更新しました（{len(db_words)} 語）")

    words, removed = exclude_db_words(words, set(db_words))
    print(f"db除外: {removed} 語 → 残り {len(words)} 語")

    if not words:
        write_csv(WORDS_CSV, [])
        print("db除外後に単語が残りませんでした。空のCSVを書きました。")
        print(f"出力: {WORDS_CSV}")
        return 0

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
