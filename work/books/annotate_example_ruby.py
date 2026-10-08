#!/usr/bin/env python3
"""words.json の各エントリに、見出し・意味・例文のルビ付き HTML を OpenAI API で一括付与する。

word_ruby / meaning_ruby / example_ruby を書き込む。漢字カバレッジと可視テキスト一致を検証し、
失敗時は自動で再プロンプト（最大 --max-retries 回）。

環境変数 OPENAI_API_KEY が必須。モデルは OPENAI_MODEL（既定: gpt-4o-mini）。

使い方:
  python3 books/annotate_example_ruby.py
  python3 books/annotate_example_ruby.py --force
  python3 books/annotate_example_ruby.py --dry-run --limit 1
  python3 books/annotate_example_ruby.py --max-retries 5
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from openai import OpenAI

from ruby_validate import validate_ruby_html


SYSTEM_PROMPT = """あなたは日本語の教科書向けルビ付けの専門家です。
入力 JSON の「word」「meaning」「example」それぞれについて、文脈に沿った正しい読み（ひらがな）を付けた HTML フラグメントを返します。

厳守ルール:
1. 出力は JSON オブジェクト1つだけ。キーは次の3つ必須:
   "word_ruby", "meaning_ruby", "example_ruby"（いずれも文字列）。
2. 各値は、対応する元テキストと「可視テキストが完全一致」するようにすること。
   句読点・括弧・全角半角・空白・数字・英字・カタカナ・引用符も原文と一字一句同じにする。
3. ルビは <ruby>親文字<rt>よみ</rt></ruby>。親文字は漢字のみ（連続漢字をまとめてよい）。
4. 送り仮名・助詞・ひらがな・カタカナ・句読点・括弧内の英字などは <ruby> の外に書く。
   例: 「選択する」→ <ruby>選択<rt>せんたく</rt></ruby>する
5. 元テキストに含まれるすべての漢字は、必ず何らかの <ruby> の親文字として現すこと。漢字をルビなしで残さない。
6. 元テキストに無い漢字を追加しない。説明文・Markdown・コードフェンスを出力しない。
7. HTML タグは <ruby> と <rt> のみ（他タグ禁止）。"""


def build_user_payload(word: str, meaning: str, example: str) -> str:
    return json.dumps(
        {"word": word, "meaning": meaning, "example": example},
        ensure_ascii=False,
    )


def _parse_response(raw: str) -> dict[str, str]:
    data = json.loads(raw)
    out = {}
    for key in ("word_ruby", "meaning_ruby", "example_ruby"):
        if key not in data or not isinstance(data[key], str):
            raise RuntimeError(f"JSON に {key!r} がありません: {raw[:400]}")
        out[key] = data[key].strip()
    return out


def _validate_all(word: str, meaning: str, example: str, parts: dict[str, str]) -> list[str]:
    errs: list[str] = []
    ok, msg = validate_ruby_html(word, parts["word_ruby"], label="word_ruby")
    if not ok:
        errs.append(msg)
    ok, msg = validate_ruby_html(meaning, parts["meaning_ruby"], label="meaning_ruby")
    if not ok:
        errs.append(msg)
    ok, msg = validate_ruby_html(example, parts["example_ruby"], label="example_ruby")
    if not ok:
        errs.append(msg)
    return errs


def annotate_entry(
    client: OpenAI,
    model: str,
    word: str,
    meaning: str,
    example: str,
    *,
    max_retries: int,
) -> dict[str, str]:
    messages: list[dict[str, str]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": build_user_payload(word, meaning, example)},
    ]
    last_fail_reason = ""

    for attempt in range(max_retries):
        completion = client.chat.completions.create(
            model=model,
            messages=messages,
            response_format={"type": "json_object"},
        )
        raw = completion.choices[0].message.content
        if not raw:
            raise RuntimeError("API が空の応答を返しました")
        try:
            parts = _parse_response(raw)
        except Exception as e:
            last_fail_reason = str(e)
            messages.append({"role": "assistant", "content": raw})
            messages.append(
                {
                    "role": "user",
                    "content": "JSON の形式が不正です。3キー word_ruby, meaning_ruby, example_ruby をすべて含めてください。\n"
                    + last_fail_reason,
                }
            )
            continue

        errs = _validate_all(word, meaning, example, parts)
        if not errs:
            return parts
        last_fail_reason = "\n".join(errs)
        messages.append({"role": "assistant", "content": raw})
        messages.append(
            {
                "role": "user",
                "content": "前回の出力は次の検証で失敗しました。ルールを厳守し、JSON のみを再度出力してください。\n\n"
                + last_fail_reason,
            }
        )

    raise RuntimeError(
        f"{max_retries} 回試行しても検証に通りませんでした: {last_fail_reason}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="words.json に word_ruby / meaning_ruby / example_ruby を LLM で付与"
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=None,
        help="入力 JSON（既定: books/words.json）",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="出力 JSON（既定: --input と同じ、上書き）",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="既存の word_ruby 等を上書きする",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="API を呼ぶがファイルは書き込まない",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="先頭 N 件だけ処理（試験用）",
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=3,
        help="検証失敗時の最大再試行回数（既定: 3）",
    )
    args = parser.parse_args()

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("OPENAI_API_KEY が設定されていません。", file=sys.stderr)
        sys.exit(1)

    base_dir = Path(__file__).resolve().parent
    in_path = args.input or (base_dir / "words.json")
    out_path = args.output or in_path

    if not in_path.exists():
        raise SystemExit(f"見つかりません: {in_path}")

    with open(in_path, encoding="utf-8") as f:
        words: list[dict] = json.load(f)

    model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
    client = OpenAI()

    def has_all_ruby(e: dict) -> bool:
        return bool(
            (e.get("word_ruby") or "").strip()
            and (e.get("meaning_ruby") or "").strip()
            and (e.get("example_ruby") or "").strip()
        )

    n = 0
    for i, entry in enumerate(words):
        if args.limit is not None and n >= args.limit:
            break
        if not args.force and has_all_ruby(entry):
            continue
        ex = entry.get("example", "")
        if not ex:
            print(f"[{i + 1}] スキップ（example 空）", flush=True)
            continue
        w = entry.get("word", "")
        m = entry.get("meaning", "")
        print(f"[{i + 1}] {w!r} …", flush=True)
        try:
            parts = annotate_entry(
                client,
                model,
                w,
                m,
                ex,
                max_retries=args.max_retries,
            )
            entry["word_ruby"] = parts["word_ruby"]
            entry["meaning_ruby"] = parts["meaning_ruby"]
            entry["example_ruby"] = parts["example_ruby"]
        except Exception as e:
            print(f"  エラー: {e}", file=sys.stderr)
            sys.exit(1)
        n += 1

    if args.dry_run:
        print("dry-run: ファイルは書き込みません")
        return

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"書き込み: {out_path}")


if __name__ == "__main__":
    main()
