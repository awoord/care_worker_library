#!/usr/bin/env python3
"""
extracted.csv から noise.csv に載っている単語を除外する。

使い方:
  python3 remove_noise_from_extracted.py
  python3 remove_noise_from_extracted.py --dry-run
  python3 remove_noise_from_extracted.py -o extracted_no_noise.csv
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

DIR = Path(__file__).resolve().parent
EXTRACTED_CSV = DIR / "extracted.csv"
NOISE_CSV = DIR / "noise.csv"


def load_word_rows(path: Path) -> list[list[str]]:
    if not path.exists():
        raise FileNotFoundError(f"ファイルが見つかりません: {path}")

    rows: list[list[str]] = []
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.reader(f):
            if not row:
                continue
            word = row[0].strip()
            if not word or word in ("単語",):
                continue
            count = row[1].strip() if len(row) > 1 else "0"
            rows.append([word, count])
    return rows


def load_word_set(path: Path) -> set[str]:
    return {row[0] for row in load_word_rows(path)}


def save_word_rows(path: Path, rows: list[list[str]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="extracted.csv から noise.csv の語を除外")
    parser.add_argument(
        "--input",
        type=Path,
        default=EXTRACTED_CSV,
        help="入力 CSV（既定: extracted.csv）",
    )
    parser.add_argument(
        "--noise",
        type=Path,
        default=NOISE_CSV,
        help="除外リスト CSV（既定: noise.csv）",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="出力 CSV（未指定時は --input を上書き）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="件数だけ表示し、ファイルは書き換えない",
    )
    args = parser.parse_args()

    extracted_rows = load_word_rows(args.input)
    noise_words = load_word_set(args.noise)

    kept_rows = [row for row in extracted_rows if row[0] not in noise_words]
    removed_count = len(extracted_rows) - len(kept_rows)
    missing_in_extracted = sorted(noise_words - {row[0] for row in extracted_rows})

    print(f"入力       : {args.input.name} ({len(extracted_rows)} 語)")
    print(f"除外リスト : {args.noise.name} ({len(noise_words)} 語)")
    print(f"除外       : {removed_count} 語")
    print(f"残り       : {len(kept_rows)} 語")
    if missing_in_extracted:
        print(f"注意       : noise にあって extracted に無い語 {len(missing_in_extracted)} 件")

    if args.dry_run:
        print("dry-run のためファイルは変更していません。")
        return 0

    output_path = args.output or args.input
    save_word_rows(output_path, kept_rows)
    print(f"保存       : {output_path.name}")
    print("完了しました。")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as err:
        print("エラー:", err, file=sys.stderr)
        raise SystemExit(1)
