#!/usr/bin/env python3
"""カイゴジョブ（ウェルミーマガジン）の解答表から CSV を作る。

対象 URL はマガジン記事（公開の解答表）。非公式の解答速報／編集解答あり。
第29〜31回は同シリーズに公開ページが無い。

使い方:
  python3 fetch_kaigojob_answers.py --from 29 --to 38
  python3 fetch_kaigojob_answers.py --session 36

出力:
  ../kaigo/kakomon/answers_{session}.csv
  列: session,number,answer
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

DIR = Path(__file__).resolve().parent
OUT_DIR = DIR.parent / "kaigo" / "kakomon"

USER_AGENT = (
    "Mozilla/5.0 (compatible; care-worker-library/1.0; "
    "+local answer CSV builder)"
)

# 第32〜38回のみ公開確認済み（2026-09）
SESSION_URLS: dict[int, str] = {
    38: "https://www.kaigojob.com/magazine/job-qualification/certified-careworker-exam0001",
    37: "https://www.kaigojob.com/magazine/job-qualification/certified-careworker-exam37",
    36: "https://www.kaigojob.com/magazine/job-qualification/certified-careworker-exam0002",
    35: "https://www.kaigojob.com/magazine/job-qualification/certified-careworker-exam0003",
    34: "https://www.kaigojob.com/magazine/job-qualification/certified-careworker-exam0005",
    33: "https://www.kaigojob.com/magazine/job-qualification/certified-careworker-exam0004",
    32: "https://www.kaigojob.com/magazine/job-qualification/certified-careworker-exam0006",
}

RE_ANSWER_CELL = re.compile(r"^[1-5](?:\s*[,、]\s*[1-5])*$")
RE_Q_LABEL = re.compile(r"^(?:問題|問)\s*(\d+)$")
RE_PAIR_38 = re.compile(
    r"(?:問題|問)\s*(\d+)\s*</t[dh]>\s*<t[dh][^>]*>\s*"
    r"([1-5](?:\s*[,、]\s*[1-5])*)",
    re.I | re.S,
)


def fetch_html(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read()
    for enc in ("utf-8", "cp932", "euc-jp"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def normalize_answer(text: str) -> str:
    t = text.strip().translate(str.maketrans("１２３４５，、", "12345,,"))
    t = re.sub(r"\s+", "", t)
    parts = [p for p in re.split(r"[,、]", t) if p]
    if not parts or any(p not in "12345" for p in parts):
        raise ValueError(f"bad answer: {text!r}")
    # 複数正答は昇順・重複除去
    uniq = sorted(set(parts), key=int)
    return ",".join(uniq)


class TableCollector(HTMLParser):
    """簡易テーブル抽出: 各 table を行×セルの文字列行列にする。"""

    def __init__(self) -> None:
        super().__init__()
        self.tables: list[list[list[str]]] = []
        self._table: list[list[str]] | None = None
        self._row: list[str] | None = None
        self._cell: list[str] | None = None
        self._in_cell = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        t = tag.lower()
        if t == "table":
            self._table = []
        elif t == "tr" and self._table is not None:
            self._row = []
        elif t in ("td", "th") and self._row is not None:
            self._cell = []
            self._in_cell = True

    def handle_endtag(self, tag: str) -> None:
        t = tag.lower()
        if t in ("td", "th") and self._in_cell and self._row is not None:
            text = "".join(self._cell or []).strip()
            text = re.sub(r"\s+", "", text)
            self._row.append(text)
            self._cell = None
            self._in_cell = False
        elif t == "tr" and self._row is not None and self._table is not None:
            if any(self._row):
                self._table.append(self._row)
            self._row = None
        elif t == "table" and self._table is not None:
            if self._table:
                self.tables.append(self._table)
            self._table = None

    def handle_data(self, data: str) -> None:
        if self._in_cell and self._cell is not None:
            self._cell.append(data)


def parse_from_tables(tables: list[list[list[str]]]) -> dict[int, str]:
    answers: dict[int, str] = {}

    def add(num: int, ans: str) -> None:
        answers[num] = normalize_answer(ans)

    for table in tables:
        # 形式A: 問題N | 解答 | 問題N | 解答
        for row in table:
            i = 0
            while i + 1 < len(row):
                m = RE_Q_LABEL.match(row[i])
                if m and RE_ANSWER_CELL.match(row[i + 1] or ""):
                    add(int(m.group(1)), row[i + 1])
                    i += 2
                    continue
                i += 1

        # 形式B: ヘッダ行 問1 問2 ... / 次行 解答
        # 末尾の空セルは列揃え用パディングなので無視する
        # （空セルでラベル収集を破棄すると問47-48 等の端数が落ちる）
        r = 0
        while r < len(table):
            row = table[r]
            labels: list[int] = []
            bad = False
            for cell in row:
                if not cell:
                    break
                m = RE_Q_LABEL.match(cell)
                if m:
                    labels.append(int(m.group(1)))
                else:
                    bad = True
                    break
            if not bad and labels and r + 1 < len(table):
                vals = table[r + 1]
                # セル単位で取り込み。「なし」等で行全体を捨てない
                added = False
                for num, ans in zip(labels, vals):
                    if ans and RE_ANSWER_CELL.match(ans):
                        add(num, ans)
                        added = True
                if added:
                    r += 2
                    continue
            r += 1

    return answers


def parse_pair_fallback(html: str) -> dict[int, str]:
    answers: dict[int, str] = {}
    for m in RE_PAIR_38.finditer(html):
        answers[int(m.group(1))] = normalize_answer(m.group(2))
    return answers


def parse_answers(html: str) -> dict[int, str]:
    collector = TableCollector()
    collector.feed(html)
    answers = parse_from_tables(collector.tables)
    if len(answers) < 100:
        fallback = parse_pair_fallback(html)
        answers.update(fallback)
    return answers


def write_csv(session: int, answers: dict[int, str], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = sorted(answers.items())
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["session", "number", "answer"])
        for number, answer in rows:
            w.writerow([session, number, answer])


def run_session(session: int, delay: float) -> tuple[str, int]:
    url = SESSION_URLS.get(session)
    if not url:
        return "no_url", 0
    html = fetch_html(url)
    answers = parse_answers(html)
    out = OUT_DIR / f"answers_{session}.csv"
    write_csv(session, answers, out)
    if delay > 0:
        time.sleep(delay)
    return "ok", len(answers)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="from_s", type=int, default=29)
    ap.add_argument("--to", dest="to_s", type=int, default=38)
    ap.add_argument("--session", type=int, default=None)
    ap.add_argument("--delay", type=float, default=0.8)
    args = ap.parse_args()

    if args.session is not None:
        sessions = [args.session]
    else:
        sessions = list(range(args.from_s, args.to_s + 1))

    print(f"出力先: {OUT_DIR}")
    failed = 0
    for session in sessions:
        try:
            status, n = run_session(session, args.delay if session != sessions[-1] else 0)
            if status == "no_url":
                print(f"第{session}回: 公開URLなし（スキップ）")
                failed += 1
            elif n == 0:
                print(f"第{session}回: 解析0件 → 失敗")
                failed += 1
            else:
                nums = sorted(
                    int(r["number"])
                    for r in csv.DictReader((OUT_DIR / f"answers_{session}.csv").open(encoding="utf-8"))
                )
                missing = [i for i in range(1, max(nums, default=0) + 1) if i not in set(nums)]
                note = f" missing={missing[:10]}{'...' if len(missing) > 10 else ''}" if missing else ""
                print(f"第{session}回: {n}問 → answers_{session}.csv{note}")
                if n < 120:
                    failed += 1
        except urllib.error.HTTPError as err:
            print(f"第{session}回: HTTP {err.code}")
            failed += 1
        except Exception as err:
            print(f"第{session}回: error {type(err).__name__}: {err}")
            failed += 1

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
