#!/usr/bin/env python3
"""
kaigo_kakomon_all.txt からキーワードを含む問題を抽出する。

使い方:
  python3 extract_by_keyword.py レビー小体
  python3 extract_by_keyword.py 介護福祉職 判断   # 空白区切りは AND（全語を含む）
  python3 extract_by_keyword.py          # 対話入力

結果は ../kewword_extract/キーワード.txt に保存する。
各問題の末尾に過去問ドットコムの解説ページURLを付ける。
"""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from kakomonn_links import question_url

DIR = Path(__file__).resolve().parent
KAKOMON_TXT = DIR / "kaigo_kakomon_all.txt"
OUTPUT_DIR = DIR.parent / "kewword_extract"

RE_INDEX = re.compile(r"^【(\d+)-(\d+)｜(.+)】\s*$")
RE_CHOICE = re.compile(r"^[1-5](?:[。．.\s]|$)")
# ファイル名に使えない文字（macOS/Windows 共通で危ないもの）
RE_UNSAFE_FILENAME = re.compile(r'[\\/:*?"<>|\0]')


@dataclass
class Question:
    index: str  # 【33-82｜認知症の理解】
    session: str
    number: str
    subject: str
    stem: str
    choices: list[str]
    context: str
    raw: str

    def format(self, include_context: bool = True) -> str:
        lines = [self.index]
        if include_context and self.context:
            lines.append(self.context)
        if self.stem:
            lines.append(self.stem)
        lines.extend(self.choices)
        url = question_url(self.session, self.number)
        if url:
            lines.append(f"解説: {url}")
        return "\n".join(lines)


def safe_filename(keyword: str) -> str:
    """キーワードをファイル名向けに整える。拡張子は付けない。"""
    name = keyword.strip()
    name = RE_UNSAFE_FILENAME.sub("_", name)
    name = name.strip(" .")
    if not name:
        name = "keyword"
    if len(name) > 80:
        name = name[:80].rstrip(" .")
    return name


def split_blocks(text: str) -> list[tuple[str, list[str], list[str]]]:
    """Return list of (index_line, body_lines, leading_context_lines).

    leading_context は直前の問題の選択肢のあとに続く事例文など。
    次の問題の検索・表示用に付ける。
    """
    blocks: list[tuple[str, list[str], list[str]]] = []
    current_index: str | None = None
    current_body: list[str] = []
    pending_context: list[str] = []

    for line in text.splitlines():
        m = RE_INDEX.match(line)
        if m:
            if current_index is not None:
                body, trailing = split_body_and_trailing(current_body)
                blocks.append((current_index, body, pending_context))
                pending_context = trailing
            else:
                pending_context = []
            current_index = line.strip()
            current_body = []
            continue
        if current_index is not None:
            current_body.append(line)

    if current_index is not None:
        body, trailing = split_body_and_trailing(current_body)
        blocks.append((current_index, body, pending_context))

    return blocks


def split_body_and_trailing(body_lines: list[str]) -> tuple[list[str], list[str]]:
    """選択肢のあとに続く事例文などを trailing に分離する。"""
    stem_and_choices: list[str] = []
    trailing: list[str] = []
    in_choices = False
    choice_done = False

    for line in body_lines:
        stripped = line.strip()
        if choice_done:
            trailing.append(line)
            continue

        if RE_CHOICE.match(stripped):
            in_choices = True
            stem_and_choices.append(line)
            continue

        if in_choices and stripped:
            choice_done = True
            trailing.append(line)
            continue

        stem_and_choices.append(line)

    while trailing and not trailing[0].strip():
        trailing.pop(0)
    while trailing and not trailing[-1].strip():
        trailing.pop()
    return stem_and_choices, trailing


def parse_question(
    index_line: str, body_lines: list[str], leading_context: list[str] | None = None
) -> Question:
    m = RE_INDEX.match(index_line)
    if not m:
        raise ValueError(f"不正なインデックス行: {index_line}")

    stem_parts: list[str] = []
    choices: list[str] = []
    in_choices = False

    for line in body_lines:
        stripped = line.strip()
        if not stripped:
            if in_choices:
                continue
            if stem_parts:
                stem_parts.append("")
            continue

        if RE_CHOICE.match(stripped):
            in_choices = True
            choices.append(stripped)
            continue

        if in_choices:
            continue

        stem_parts.append(stripped)

    while stem_parts and stem_parts[-1] == "":
        stem_parts.pop()

    context_lines = [ln.strip() for ln in (leading_context or []) if ln.strip()]
    raw_parts = [index_line]
    raw_parts.extend(context_lines)
    raw_parts.extend(stem_parts)
    raw_parts.extend(choices)

    return Question(
        index=index_line,
        session=m.group(1),
        number=m.group(2),
        subject=m.group(3),
        stem="\n".join(stem_parts),
        choices=choices,
        context="\n".join(context_lines),
        raw="\n".join(raw_parts),
    )


def load_questions(path: Path) -> list[Question]:
    text = path.read_text(encoding="utf-8")
    questions: list[Question] = []
    for index_line, body, leading in split_blocks(text):
        questions.append(parse_question(index_line, body, leading))
    return questions


def searchable_text(q: Question) -> str:
    """インデックス・（共有事例）・問題文・選択肢。"""
    parts = [q.index]
    if q.context:
        parts.append(q.context)
    if q.stem:
        parts.append(q.stem)
    parts.extend(q.choices)
    return "\n".join(parts)


def normalize_for_search(text: str) -> str:
    """全角英数→半角、大文字小文字を揃えて検索用にする。"""
    return unicodedata.normalize("NFKC", text).casefold()


def parse_terms(*parts: str) -> list[str]:
    """空白区切りの語を AND 条件用のリストにする。"""
    terms: list[str] = []
    for part in parts:
        terms.extend(part.split())
    return terms


def search_questions(questions: list[Question], terms: list[str]) -> list[Question]:
    """terms の語をすべて含む問題を返す（AND 検索）。

    出題回の降順、同じ回内は問題番号の昇順で並べる。
    英数字は全角・半角・大文字小文字を同一視する。
    """
    if not terms:
        return []
    norm_terms = [normalize_for_search(t) for t in terms]
    hits: list[Question] = []
    for q in questions:
        text = normalize_for_search(searchable_text(q))
        if all(term in text for term in norm_terms):
            hits.append(q)
    hits.sort(key=lambda q: (-int(q.session), int(q.number)))
    return hits


def main() -> int:
    parser = argparse.ArgumentParser(
        description="過去問テキストからキーワードを含む問題を抽出する（空白区切りは AND）"
    )
    parser.add_argument(
        "keywords",
        nargs="*",
        help="検索キーワード（複数指定時はすべて含む問題のみ。省略時は対話入力）",
    )
    parser.add_argument(
        "-i",
        "--input",
        type=Path,
        default=KAKOMON_TXT,
        help=f"入力ファイル（既定: {KAKOMON_TXT.name}）",
    )
    parser.add_argument(
        "-d",
        "--output-dir",
        type=Path,
        default=OUTPUT_DIR,
        help=f"出力フォルダ（既定: {OUTPUT_DIR.name}/）",
    )
    args = parser.parse_args()

    raw_parts = list(args.keywords)
    if not raw_parts:
        try:
            raw_parts = [input("キーワード: ").strip()]
        except EOFError:
            raw_parts = []

    terms = parse_terms(*raw_parts)
    if not terms:
        print("キーワードが空です。", file=sys.stderr)
        return 1

    keyword_label = " ".join(terms)

    if not args.input.is_file():
        print(f"過去問テキストが見つかりません: {args.input}", file=sys.stderr)
        return 1

    questions = load_questions(args.input)
    hits = search_questions(questions, terms)

    chunks = [q.format() for q in hits]
    body = ("\n\n".join(chunks) + "\n") if chunks else ""
    header = f"# キーワード: {keyword_label}\n# ヒット: {len(hits)} 問\n\n"
    text = header + body
    out_dir = args.output_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{safe_filename(keyword_label)}.txt"
    out_path.write_text(text, encoding="utf-8")

    print(f"完了: {len(hits)} 問 → {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


