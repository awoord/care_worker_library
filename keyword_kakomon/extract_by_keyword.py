#!/usr/bin/env python3
"""
kaigo_kakomon_all.txt からキーワードを含む問題を抽出する。
対象回はファイル先頭の SESSION_MIN / SESSION_MAX を書き換えて指定する
（必要なら --from/--to / --range で一時上書きも可）。

使い方:
  python3 extract_by_keyword.py レビー小体
  python3 extract_by_keyword.py 介護福祉職 判断   # 空白区切りは AND（全語を含む）
  python3 extract_by_keyword.py ICF --range 30-38  # 一時的に範囲を上書き
  python3 extract_by_keyword.py          # 対話入力（キーワード）

結果は ../keyword_extract/キーワード.txt に保存する。
入力過去問は ../kakomon_v2/kaigo_kakomon_all.txt。
各問題の末尾に過去問ドットコムの解説ページURLを付ける。
総合問題・科目内の共有事例は、同一セットの後続問にも冒頭文を付けて出力する。
"""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path

try:
    from .kakomonn_links import question_url
except ImportError:  # python3 extract_by_keyword.py で直接実行
    from kakomonn_links import question_url

DIR = Path(__file__).resolve().parent
ROOT = DIR.parent
KAKOMON_TXT = ROOT / "kakomon_v2" / "kaigo_kakomon_all.txt"
OUTPUT_DIR = ROOT / "keyword_extract"
# 対象回（ここを書き換えて範囲を変える。例: 30 と 38）
SESSION_MIN = 33
SESSION_MAX = 38

RE_INDEX = re.compile(r"^【(\d+)-(\d+)｜(.+)】\s*$")
RE_CHOICE = re.compile(r"^[1-5](?:[。．.\s]|$)")
# 「1 週間の…選びなさい」など、数字始まりの問題文を選択肢と誤認しない
RE_STEM_MARKER = re.compile(r"選びなさい|選びなさい。|答えなさい|答えなさい。")


def is_choice_line(stripped: str) -> bool:
    """選択肢行か判定する。数字＋区切りで始まるが問題文のものは除外。"""
    if not RE_CHOICE.match(stripped):
        return False
    if RE_STEM_MARKER.search(stripped):
        return False
    return True


# 総合問題の事例ブロック冒頭（共有事例の開始）
RE_CASE_INTRO = re.compile(r"(?:〔\s*事|次の事例を読んで|（総合問題)")
# 「問題31，問題32」「問題114から問題116まで」など
# 「総合問題1」の中の「問題1」は問番号ではないので除外する
RE_CASE_PROBLEM_RANGE = re.compile(
    r"(?<!総合)問題\s*(\d+)\s*から\s*(?<!総合)問題\s*(\d+)"
)
RE_CASE_PROBLEM_NUM = re.compile(r"(?<!総合)問題\s*(\d+)")
# 大見出し（第〇回…／＜領域：…＞）。【】内の科目名は対象外
RE_SESSION_HEADING = re.compile(
    r"^第\d+回[（(].*?[）)].*介護福祉士国家試験"
)
RE_DOMAIN_HEADING = re.compile(r"^＜領域：.+＞\s*$")
# 回の切り替わり付近のナビゲーション行
RE_NAV_HEADING = re.compile(r"ページに戻る\s*$")
# ファイル名に使えない文字（macOS/Windows 共通で危ないもの）
RE_UNSAFE_FILENAME = re.compile(r'[\\/:*?"<>|\0]')
# 「30-38」「30〜38」「第30回から第38回」など
RE_SESSION_RANGE = re.compile(
    r"(?:第\s*)?(\d+)\s*回?\s*(?:[-〜～~]|から|to)\s*(?:第\s*)?(\d+)\s*回?",
    re.IGNORECASE,
)


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


def is_section_heading(line: str, subject: str | None = None) -> bool:
    """第〇回見出し・領域見出し・【】直前の科目名見出しなら True。

    【N-M｜科目名】の科目名そのものは消さない（index 行は別扱い）。
    """
    stripped = line.strip()
    if not stripped:
        return False
    if RE_SESSION_HEADING.match(stripped):
        return True
    if RE_DOMAIN_HEADING.match(stripped):
        return True
    if RE_NAV_HEADING.search(stripped):
        return True
    if subject is not None and stripped == subject.strip():
        return True
    return False


def filter_section_headings(
    lines: list[str], *, subject: str | None = None
) -> list[str]:
    """leading/trailing から大見出し行を除く。"""
    kept = [ln for ln in lines if not is_section_heading(ln, subject)]
    while kept and not kept[0].strip():
        kept.pop(0)
    while kept and not kept[-1].strip():
        kept.pop()
    return kept


def split_blocks(text: str) -> list[tuple[str, list[str], list[str]]]:
    """Return list of (index_line, body_lines, leading_context_lines).

    leading_context は直前の問題の選択肢のあとに続く事例文など。
    次の問題の検索・表示用に付ける（大見出しは除く）。
    """
    blocks: list[tuple[str, list[str], list[str]]] = []
    current_index: str | None = None
    current_body: list[str] = []
    pending_context: list[str] = []

    for line in text.splitlines():
        m = RE_INDEX.match(line)
        if m:
            next_subject = m.group(3)
            if current_index is not None:
                body, trailing = split_body_and_trailing(current_body)
                blocks.append((current_index, body, pending_context))
                pending_context = filter_section_headings(
                    trailing, subject=next_subject
                )
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

        if is_choice_line(stripped):
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

        if is_choice_line(stripped):
            in_choices = True
            choices.append(stripped)
            continue

        if in_choices:
            continue

        stem_parts.append(stripped)

    while stem_parts and stem_parts[-1] == "":
        stem_parts.pop()

    context_lines = filter_section_headings(
        [ln for ln in (leading_context or []) if ln.strip()],
        subject=m.group(3),
    )
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


def load_questions(
    path: Path,
    session_min: int | None = None,
    session_max: int | None = None,
) -> list[Question]:
    min_s = SESSION_MIN if session_min is None else session_min
    max_s = SESSION_MAX if session_max is None else session_max
    text = path.read_text(encoding="utf-8")
    questions: list[Question] = []
    for index_line, body, leading in split_blocks(text):
        q = parse_question(index_line, body, leading)
        session = int(q.session)
        if min_s <= session <= max_s:
            questions.append(q)
    enrich_sogo_case_contexts(questions)
    enrich_named_case_contexts(questions)
    return questions


def is_case_intro(context: str) -> bool:
    """共有事例の冒頭（次の事例を読んで／〔事例〕など）かどうか。"""
    return bool(context and RE_CASE_INTRO.search(context))


def case_problem_numbers(context: str) -> set[int]:
    """事例導入文から対象の問番号集合を取る。"""
    nums: set[int] = set()
    if not context:
        return nums
    for m in RE_CASE_PROBLEM_RANGE.finditer(context):
        a, b = int(m.group(1)), int(m.group(2))
        lo, hi = (a, b) if a <= b else (b, a)
        nums.update(range(lo, hi + 1))
    for m in RE_CASE_PROBLEM_NUM.finditer(context):
        nums.add(int(m.group(1)))
    return nums


def _apply_shared_context(base: str, extra: str) -> str:
    if not extra:
        return base
    if extra == base or extra in base:
        return base
    if base in extra:
        return extra
    return f"{base}\n{extra}"


def enrich_sogo_case_contexts(questions: list[Question]) -> None:
    """総合問題で、同一事例セットの後続問にも冒頭の事例全文を付ける。

    新しい回では事例が問1の前にだけ置かれ、問2・問3には
    「その後…」などの追記だけが付く。抽出時は冒頭事例＋追記を出す。
    （第29〜31回のように各問の本文に事例が重複掲載されている形式はそのまま）
    """
    i = 0
    n = len(questions)
    while i < n:
        q = questions[i]
        if q.subject != "総合問題":
            i += 1
            continue

        j = i + 1
        while (
            j < n
            and questions[j].subject == "総合問題"
            and questions[j].session == q.session
        ):
            j += 1

        # 同一回の総合問題連続区間を、事例冒頭ごとにセット分割
        sets: list[list[int]] = []
        current: list[int] = []
        for k in range(i, j):
            if current and is_case_intro(questions[k].context):
                sets.append(current)
                current = [k]
            else:
                current.append(k)
        if current:
            sets.append(current)

        for group in sets:
            base = questions[group[0]].context
            if not base:
                continue
            for offset, k in enumerate(group):
                if offset == 0:
                    continue
                questions[k].context = _apply_shared_context(
                    base, questions[k].context
                )

        i = j


def enrich_named_case_contexts(questions: list[Question]) -> None:
    """「次の事例を読んで、問題31，問題32…」形式の共有事例を後続問にも付ける。

    コミュニケーション技術などの科目内事例セット向け。
    導入文に書かれた問番号へ、冒頭の事例全文を伝播する。
    """
    by_key = {(q.session, int(q.number)): idx for idx, q in enumerate(questions)}
    for q in questions:
        if not is_case_intro(q.context):
            continue
        nums = case_problem_numbers(q.context)
        if len(nums) < 2:
            continue
        base = q.context
        first = int(q.number)
        for num in sorted(nums):
            if num == first:
                continue
            idx = by_key.get((q.session, num))
            if idx is None:
                continue
            questions[idx].context = _apply_shared_context(
                base, questions[idx].context
            )


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


def parse_session_range_text(text: str) -> tuple[int, int] | None:
    """'30-38' / '30〜38' / '第30回から第38回' / '30 38' を (from, to) に変換。"""
    raw = unicodedata.normalize("NFKC", text).strip()
    if not raw:
        return None
    m = RE_SESSION_RANGE.search(raw)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        return (a, b) if a <= b else (b, a)
    nums = re.findall(r"\d+", raw)
    if len(nums) == 2:
        a, b = int(nums[0]), int(nums[1])
        return (a, b) if a <= b else (b, a)
    if len(nums) == 1:
        n = int(nums[0])
        return n, n
    return None


def resolve_session_range(
    session_from: int | None,
    session_to: int | None,
    range_text: str | None = None,
) -> tuple[int, int]:
    """CLI 指定があればそれを使い、なければ SESSION_MIN〜SESSION_MAX。"""
    if range_text:
        parsed = parse_session_range_text(range_text)
        if parsed is None:
            raise ValueError(f"--range の形式が不正です: {range_text}")
        a, b = parsed
        if session_from is not None or session_to is not None:
            raise ValueError("--range と --from/--to は同時に指定できません")
        return a, b

    a = SESSION_MIN if session_from is None else session_from
    b = SESSION_MAX if session_to is None else session_to
    if a > b:
        raise ValueError("--from は --to 以下にしてください")
    return a, b


def add_session_range_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--from",
        dest="session_from",
        type=int,
        default=None,
        help=f"最古の回（省略時は SESSION_MIN={SESSION_MIN}）",
    )
    parser.add_argument(
        "--to",
        dest="session_to",
        type=int,
        default=None,
        help=f"最新の回（省略時は SESSION_MAX={SESSION_MAX}）",
    )
    parser.add_argument(
        "--range",
        dest="session_range",
        default=None,
        help="対象回をまとめて一時指定（例: 30-38）。省略時は SESSION_MIN〜MAX",
    )


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
    add_session_range_arguments(parser)
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

    try:
        session_from, session_to = resolve_session_range(
            args.session_from,
            args.session_to,
            args.session_range,
        )
    except ValueError as err:
        print(str(err), file=sys.stderr)
        return 1

    if not args.input.is_file():
        print(f"過去問テキストが見つかりません: {args.input}", file=sys.stderr)
        return 1

    questions = load_questions(
        args.input,
        session_min=session_from,
        session_max=session_to,
    )
    hits = search_questions(questions, terms)

    chunks = [q.format() for q in hits]
    body = ("\n\n".join(chunks) + "\n") if chunks else ""
    header = (
        f"# キーワード: {keyword_label}\n"
        f"# 対象回: 第{session_from}回〜第{session_to}回\n"
        f"# ヒット: {len(hits)} 問\n\n"
    )
    text = header + body
    out_dir = args.output_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{safe_filename(keyword_label)}.txt"
    out_path.write_text(text, encoding="utf-8")

    print(
        f"完了: {len(hits)} 問（第{session_from}〜{session_to}回） → {out_path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


