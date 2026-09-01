#!/usr/bin/env python3
"""
dbシート（本番）の全単語を取得し、extracted.csv から除外して上書き保存する。

使い方:
  python3 remove_db_from_extracted.py
"""

from __future__ import annotations

import csv
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

DIR = Path(__file__).resolve().parent
EXTRACTED_CSV = DIR / "extracted.csv"
DB_WORDS_CSV = DIR / "db_words.csv"
GAS_URL = (
    "https://script.google.com/macros/s/"
    "AKfycby1hG96pflujpC2yLpK-RhslOoZXgkr_LGBj-IdEG6hnIrcZjp3HUjN4LIp53WJ0S5ceA/exec"
)


def fetch_db_words() -> list[str]:
    """dbシートの行順（B列）で単語を返す。"""
    url = GAS_URL + "?_t=1"
    req = urllib.request.Request(url, headers={"User-Agent": "care_worker_library/remove_db_from_extracted"})
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as err:
        raise RuntimeError("dbシートの取得に失敗しました: " + str(err)) from err

    if payload.get("error"):
        raise RuntimeError("GAS エラー: " + str(payload["error"]))

    words: list[str] = []
    seen: set[str] = set()
    for item in payload.get("allWords", []):
        # GAS は短縮キー w、旧形式は word
        word = str(item.get("word") or item.get("w") or "").strip()
        if not word or word in seen:
            continue
        words.append(word)
        seen.add(word)

    if not words:
        raise RuntimeError("dbシートから単語を取得できませんでした（0件）")

    return words


def load_extracted_rows(path: Path) -> list[list[str]]:
    if not path.exists():
        raise FileNotFoundError("extracted.csv が見つかりません: " + str(path))

    rows: list[list[str]] = []
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.reader(f):
            if not row:
                continue
            word = row[0].strip()
            if not word:
                continue
            count = row[1].strip() if len(row) > 1 else "0"
            rows.append([word, count])
    return rows


def save_db_words(path: Path, words: list[str]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        for word in words:
            writer.writerow([word])


def save_extracted_rows(path: Path, rows: list[list[str]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerows(rows)


def main() -> int:
    print("dbシートから単語を取得中...")
    db_words = fetch_db_words()
    db_word_set = set(db_words)
    print(f"  db単語数（A）: {len(db_words)} 語")

    extracted_rows = load_extracted_rows(EXTRACTED_CSV)
    before_count = len(extracted_rows)

    kept_rows = [row for row in extracted_rows if row[0] not in db_word_set]
    removed_count = before_count - len(kept_rows)

    save_db_words(DB_WORDS_CSV, db_words)
    save_extracted_rows(EXTRACTED_CSV, kept_rows)

    print(f"  {DB_WORDS_CSV.name} を更新しました（dbシートの行順）")
    print(f"  extracted.csv 更新前: {before_count} 語")
    print(f"  除外（A と一致）    : {removed_count} 語")
    print(f"  extracted.csv 更新後: {len(kept_rows)} 語")
    print("完了しました。")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as err:
        print("エラー:", err, file=sys.stderr)
        raise SystemExit(1)
