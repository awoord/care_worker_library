#!/usr/bin/env python3
"""books/extracted_words.json（既定）を Jinja2 で HTML にレンダリングする。

--input で books/words.json など別 JSON も指定可能。
例文・見出し・意味のルビは各エントリの example_ruby / word_ruby / meaning_ruby
（annotate_example_ruby.py で LLM 一括付与＋検証）を優先する。
未設定のフィールドは pykakasi でルビ付けする（試験問題の「漢字｛よみ｝」は確定読みとして先に展開）。
"""

from __future__ import annotations

import argparse
import html
import json

import re
import webbrowser
from pathlib import Path

from jinja2 import Environment, FileSystemLoader


def _is_kanji(ch: str) -> bool:
    """漢字（CJK 統合漢字・々）。"""
    return "\u4e00" <= ch <= "\u9fff" or ch == "\u3005"


# 試験問題の「親｛読み｝」（全角ブレース）。親は漢字と送りの「っ」のみ（長文全体を1つの親にしない）。
_BRACE_READING_RE = re.compile(r"([\u3005\u4e00-\u9fff\u3063]+)｛([^｝]+)｝")

_kks_singleton: object | None = None


def _kks():
    global _kks_singleton
    if _kks_singleton is None:
        try:
            from pykakasi import kakasi as _Kakasi
        except ImportError as exc:
            raise SystemExit(
                "ルビ生成に pykakasi が必要です。次を実行してください: pip install pykakasi"
            ) from exc
        _kks_singleton = _Kakasi()
    return _kks_singleton


def _emit_pykakasi_piece(orig: str, hira: str) -> str:
    """pykakasi.convert の1要素を HTML フラグメントにする（送り仮名は <ruby> の外）。"""
    if orig == hira:
        return html.escape(orig)
    if not any(_is_kanji(c) for c in orig):
        return html.escape(orig)
    o, h = orig, hira
    while o and h and not _is_kanji(o[-1]) and o[-1] == h[-1]:
        o, h = o[:-1], h[:-1]
    if not o:
        return html.escape(orig)
    okuri = orig[len(o) :]
    if all(_is_kanji(c) for c in o):
        return f"<ruby>{html.escape(o)}<rt>{html.escape(h)}</rt></ruby>" + html.escape(
            okuri
        )
    # 「繰り返し」「取り入れ」のように親にひらがなが混ざる語は、1 ブロックでルビ付け（漢字は漏れない）
    return f"<ruby>{html.escape(orig)}<rt>{html.escape(hira)}</rt></ruby>"


def _ruby_pykakasi_segment(plain: str) -> str:
    """｛｝読み注記を除いた断片に pykakasi でルビ付与。"""
    if not plain:
        return ""
    return "".join(
        _emit_pykakasi_piece(part["orig"], part["hira"]) for part in _kks().convert(plain)
    )


def wrap_keyword_ruby(html: str, word: str) -> str:
    """見出し語に対応する <ruby>…</ruby> だけを card-keyword で包む。

    優先順位: 親文字 == 見出し語 → 親が見出し語の一部（例: 選ぶ×親「選」）。
    親に見出し語が「含まれるだけ」の場合（例: 障害×「知的障害」）は赤くしない。
    """
    if not word:
        return html
    exact: list[tuple[int, int, int]] = []
    prefix: list[tuple[int, int, int]] = []
    for m in re.finditer(r"<ruby>([^<]+)<rt>", html):
        base = m.group(1)
        start = m.start()
        end = html.find("</ruby>", start) + len("</ruby>")
        if end <= start:
            continue
        if base == word:
            exact.append((len(base), start, end))
        elif base in word:
            prefix.append((len(base), start, end))
    if exact:
        _, start, end = max(exact, key=lambda x: x[0])
    elif prefix:
        _, start, end = max(prefix, key=lambda x: x[0])
    else:
        return html
    block = html[start:end]
    return html[:start] + '<span class="card-keyword">' + block + "</span>" + html[end:]


def example_html_with_keyword(example: str, word: str) -> str:
    """例文にルビを付与し、見出し語に対応する <ruby> ブロックを強調する。"""
    frag = _coalesce_ruby_okurigana_for_word(add_ruby(example), word)
    return wrap_keyword_ruby(frag, word)


def example_html_from_pre_rubied(example_ruby: str, word: str) -> str:
    """OpenAI 済みの example_ruby をそのまま使い、見出し語の <ruby> のみ強調する。"""
    frag = _coalesce_ruby_okurigana_for_word(
        _apply_post_ruby_corrections(example_ruby), word
    )
    return wrap_keyword_ruby(frag, word)


# pykakasi が「要介護」を「要介（ようすけ）」＋「護（ご）」と誤分割するための補正。
_RUBY_WRONG_YOUKAIKO = "<ruby>要介<rt>ようすけ</rt></ruby><ruby>護<rt>ご</rt></ruby>"
_RUBY_RIGHT_YOUKAIKO = "<ruby>要介護<rt>ようかいご</rt></ruby>"
# pykakasi が「一人暮らし」を「一人暮（ひとりぐ）」＋送り「らし」と誤分割する。
_RUBY_WRONG_HITORIGURASHI = "<ruby>一人暮<rt>ひとりぐ</rt></ruby>らし"
_RUBY_RIGHT_HITORIGURASHI = "<ruby>一人暮らし<rt>ひとりぐらし</rt></ruby>"
# 「要支援者」を 要・支援・者（もの）と誤る。
_RUBY_WRONG_YOUSEIENSHA = (
    "<ruby>要<rt>よう</rt></ruby><ruby>支援<rt>しえん</rt></ruby><ruby>者<rt>もの</rt></ruby>"
)
_RUBY_RIGHT_YOUSEIENSHA = "<ruby>要支援者<rt>ようしえんしゃ</rt></ruby>"
# 「最も」を「最」＋「もっと」＋「も」と誤る。
_RUBY_WRONG_MOTTOMO = "<ruby>最<rt>もっと</rt></ruby>も"
_RUBY_RIGHT_MOTTOMO = "<ruby>最も<rt>もっとも</rt></ruby>"
# 単独の「人」は文脈では「ひと」が多いが、pykakasi は「にん」になりがち。「人として」だけ「にん」に戻す。
_RUBY_JIN_HITO_TOSHITE = "<ruby>人<rt>ひと</rt></ruby>として"
_RUBY_JIN_NIN_TOSHITE = "<ruby>人<rt>にん</rt></ruby>として"

# 見出し語（末尾がひらがなの複合動詞など）の <ruby>親<rt>…</rt></ruby>送り を1ブロックにまとめる。
_OKURIGANA_HEADWORD_TAIL = re.compile(
    r"^([\u3005\u4e00-\u9fff]+)([\u3041-\u3096\u30a1-\u30f6ーっ]+)$"
)


def _coalesce_ruby_okurigana_for_word(fragment: str, word: str) -> str:
    """pykakasi が「伴」「う」のように分けたとき、見出し語全体を1つの <ruby> にまとめる。"""
    if not fragment or not word:
        return fragment
    m = _OKURIGANA_HEADWORD_TAIL.match(word)
    if not m:
        return fragment
    kanji_prefix, kana_suffix = m.group(1), m.group(2)
    if not kana_suffix:
        return fragment
    pat = re.compile(
        "<ruby>"
        + re.escape(kanji_prefix)
        + r"<rt>[^<]*</rt></ruby>"
        + re.escape(kana_suffix)
    )
    merged = "".join(p["hira"] for p in _kks().convert(word))
    right = f"<ruby>{html.escape(word)}<rt>{html.escape(merged)}</rt></ruby>"
    return pat.sub(right, fragment)


def _fix_jin_standalone_ruby(fragment: str) -> str:
    """単独の「人」のルビを文脈に合わせる（「ひと」が主、「人として」は「にん」）。"""
    s = fragment.replace("<ruby>人<rt>にん</rt></ruby>", "<ruby>人<rt>ひと</rt></ruby>")
    return s.replace(_RUBY_JIN_HITO_TOSHITE, _RUBY_JIN_NIN_TOSHITE)


def _apply_post_ruby_corrections(fragment: str) -> str:
    """既知の pykakasi 誤ルビを置換する（LLM 済み HTML に誤りが混じった場合も同様）。"""
    return _fix_jin_standalone_ruby(
        fragment.replace(_RUBY_WRONG_YOUKAIKO, _RUBY_RIGHT_YOUKAIKO)
        .replace(_RUBY_WRONG_HITORIGURASHI, _RUBY_RIGHT_HITORIGURASHI)
        .replace(_RUBY_WRONG_YOUSEIENSHA, _RUBY_RIGHT_YOUSEIENSHA)
        .replace(_RUBY_WRONG_MOTTOMO, _RUBY_RIGHT_MOTTOMO)
    )


def add_ruby(text: str) -> str:
    """漢字を文脈に沿う読みで <ruby> 化する。試験中の「親｛よみ｝」はその読みを採用する。

    語の切れ目・読みは pykakasi に従い、最期 / 最も のような紛れは辞書の単漢字置換で壊さない。
    """
    if not text:
        return ""
    out: list[str] = []
    pos = 0
    for m in _BRACE_READING_RE.finditer(text):
        if m.start() > pos:
            out.append(_ruby_pykakasi_segment(text[pos : m.start()]))
        kanji_side, reading = m.group(1), m.group(2)
        # 試験注記「引っ掻｛か｝」は 掻 だけに「か」が付く表記。全体を ひっ + か に分ける。
        if kanji_side == "引っ掻" and reading == "か":
            out.append(
                "<ruby>引<rt>ひ</rt></ruby>っ<ruby>掻<rt>か</rt></ruby>"
            )
        else:
            out.append(
                f"<ruby>{html.escape(kanji_side)}<rt>{html.escape(reading)}</rt></ruby>"
            )
        pos = m.end()
    if pos < len(text):
        out.append(_ruby_pykakasi_segment(text[pos:]))
    return _apply_post_ruby_corrections("".join(out))


ALLOWED_POS: frozenset[str] = frozenset({"名", "動", "形", "副"})


def build_entries(words: list[dict]) -> list[dict]:
    out = []
    for i, w in enumerate(words, start=1):
        row = dict(w)
        pos = str(w.get("pos", "")).strip()
        if pos not in ALLOWED_POS:
            raise ValueError(
                f'「{w.get("word", "?")}」の pos は '
                f'名・動・形・副のいずれかにしてください（現在: {pos!r}）'
            )
        row["pos"] = pos
        row["index"] = i
        word_ruby_llm = (w.get("word_ruby") or "").strip()
        if word_ruby_llm:
            row["word_ruby"] = _coalesce_ruby_okurigana_for_word(
                _apply_post_ruby_corrections(word_ruby_llm), w["word"]
            )
        else:
            row["word_ruby"] = _coalesce_ruby_okurigana_for_word(
                add_ruby(w["word"]), w["word"]
            )
        meaning_ruby_llm = (w.get("meaning_ruby") or "").strip()
        row["meaning_html"] = _apply_post_ruby_corrections(
            meaning_ruby_llm if meaning_ruby_llm else add_ruby(w["meaning"])
        )
        ex_ruby = (w.get("example_ruby") or "").strip()
        if ex_ruby:
            row["example_html"] = example_html_from_pre_rubied(ex_ruby, w["word"])
        else:
            row["example_html"] = example_html_with_keyword(w["example"], w["word"])
        out.append(row)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(
        description="単語 JSON（既定: books/extracted_words.json）から単語帳 HTML を生成"
    )
    parser.add_argument(
        "--input",
        "-i",
        type=Path,
        default=None,
        help="入力 JSON（既定: books/extracted_words.json）",
    )
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
    json_path = args.input or (base_dir / "extracted_words.json")
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

