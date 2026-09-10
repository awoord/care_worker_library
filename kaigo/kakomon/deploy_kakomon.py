#!/usr/bin/env python3
"""過去問キーワード検索サイトを生成し、/kaigo/kakomon/ にアップロードする。

- データ: kakomon_v2/kaigo_kakomon_all.txt（BUILD_SESSION_MIN/MAX の範囲を JSON 化）
- 画面上で回の範囲を絞り込めるよう、データは広めに入れる
- 解説の外部リンクは付けない
- ルート・J専用URL・/test/ には触らない

使い方:
  python3 kaigo/kakomon/deploy_kakomon.py           # 生成＋FTP
  python3 kaigo/kakomon/deploy_kakomon.py --build-only
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import time
from ftplib import FTP_TLS
from pathlib import Path

SITE_DIR = Path(__file__).resolve().parent
ROOT = SITE_DIR.parent.parent

# リポジトリルートを path に入れ、keyword_kakomon をパッケージとして import する
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from keyword_kakomon.deploy_by_keyword import parse_choice_line
from keyword_kakomon.extract_by_keyword import (
    KAKOMON_TXT,
    load_questions,
)

# JSON に含める回の範囲（画面の選択 UI はこの中から選ぶ）
BUILD_SESSION_MIN = 29
BUILD_SESSION_MAX = 38
# 画面を開いたときの初期選択（データ範囲内）
DEFAULT_FROM = 38
DEFAULT_TO = 38

FTP_HOST = "www1165.conoha.ne.jp"
FTP_USER = "ao@nihongo.site"
FTP_PASS = "highway#61"
REMOTE_BASE_DIR = "/public_html/nihongo.site"
REMOTE_SITE_DIR = f"{REMOTE_BASE_DIR}/kaigo/kakomon"

DEPLOY_FILES = ("index.html", "style.css", "app.js", "questions.json", "ruby.json")
PUBLIC_URL = "https://nihongo.site/kaigo/kakomon/"

GAS_WORDS_URL = (
    "https://script.google.com/macros/s/"
    "AKfycby1hG96pflujpC2yLpK-RhslOoZXgkr_LGBj-IdEG6hnIrcZjp3HUjN4LIp53WJ0S5ceA/exec"
    "?app=kaigo"
)
MIN_RUBY_WORD_LEN = 2

HTACCESS_CONTENT = """
<IfModule mod_headers.c>
    <FilesMatch "\\.(html|css|js|json)$">
        Header always set Cache-Control "no-store, no-cache, must-revalidate, max-age=0"
        Header always set Pragma "no-cache"
        Header always set Expires "0"
    </FilesMatch>
    Header always unset ETag
</IfModule>
FileETag None
"""


def parse_answer_cell(raw: str) -> list[int] | None:
    """CSV の answer 欄を選択肢番号のリストに。なし・空は None。"""
    text = (raw or "").strip()
    if not text or text in ("なし", "-", "—", "－", "不明", "?"):
        return None
    parts = [
        p.strip()
        for p in re.split(r"[,，、・/\s]+", text)
        if p.strip()
    ]
    if not parts:
        return None
    nums: list[int] = []
    for part in parts:
        if not part.isdigit():
            return None
        n = int(part)
        if n < 1 or n > 9:
            return None
        if n not in nums:
            nums.append(n)
    return nums or None


def load_answers_map() -> tuple[dict[str, list[int]], dict[str, str]]:
    """answers_*.csv から正解マップと注釈マップを返す。

    正解キーは「回-番号」（番号の先頭ゼロなし）。
    answer が「なし」の問は注釈を付ける。
    """
    answers: dict[str, list[int]] = {}
    notes: dict[str, str] = {}
    skipped = 0
    for session in range(BUILD_SESSION_MIN, BUILD_SESSION_MAX + 1):
        path = SITE_DIR / f"answers_{session}.csv"
        if not path.is_file():
            print(f"警告: 解答CSVなし → {path.name}")
            continue
        with path.open(encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                sess_raw = str(row.get("session") or session).strip()
                number_raw = str(row.get("number") or "").strip()
                if not number_raw:
                    continue
                try:
                    sess_i = int(sess_raw)
                    num_i = int(number_raw)
                except ValueError:
                    skipped += 1
                    continue
                qid = f"{sess_i}-{num_i}"
                raw_ans = (row.get("answer") or "").strip()
                if raw_ans == "なし":
                    notes[qid] = "問題不成立のため、正答なし"
                    continue
                parsed = parse_answer_cell(raw_ans)
                if not parsed:
                    skipped += 1
                    continue
                answers[qid] = parsed
    print(
        f"解答: {len(answers)} 問"
        f"（正答なし注釈 {len(notes)}、その他スキップ {skipped}）"
    )
    return answers, notes


def load_explains_map() -> dict[str, dict[str, str]]:
    """explains/explains_*.json から id → {選択肢番号: 文} を読む。"""
    explains_dir = SITE_DIR / "explains"
    merged: dict[str, dict[str, str]] = {}
    if not explains_dir.is_dir():
        return merged
    for path in sorted(explains_dir.glob("explains_*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception as err:
            print(f"警告: 解説JSON読めず → {path.name}: {err}")
            continue
        items = (payload or {}).get("items") or {}
        n = 0
        for qid, item in items.items():
            raw = (item or {}).get("explains") or {}
            cleaned: dict[str, str] = {}
            for key, text in raw.items():
                t = str(text or "").strip()
                if not t:
                    continue
                cleaned[str(key)] = t
            if cleaned:
                merged[str(qid)] = cleaned
                n += 1
        print(f"解説: {path.name} → {n} 問")
    return merged


def question_to_json(
    q,
    answers_map: dict[str, list[int]] | None = None,
    notes_map: dict[str, str] | None = None,
    explains_map: dict[str, dict[str, str]] | None = None,
) -> dict:
    body: list[str] = []
    if q.context:
        body.extend(ln for ln in q.context.split("\n") if ln.strip())
    if q.stem:
        body.extend(ln for ln in q.stem.split("\n") if ln.strip())

    choices = []
    for raw in q.choices:
        parsed = parse_choice_line(raw)
        if parsed:
            choices.append(parsed)
        elif raw.strip():
            choices.append({"n": len(choices) + 1, "text": raw.strip()})

    round_i = int(q.session)
    number_i = int(q.number)
    qid = f"{round_i}-{number_i}"
    item = {
        "id": qid,
        "round": round_i,
        "number": number_i,
        "subject": q.subject,
        "body": body,
        "choices": choices,
    }
    if answers_map:
        ans = answers_map.get(qid)
        if ans:
            item["answers"] = ans
    if notes_map and qid in notes_map:
        item["note"] = notes_map[qid]
    if explains_map and qid in explains_map:
        item["explains"] = explains_map[qid]
    return item


def build_payload(
    questions: list,
    answers_map: dict[str, list[int]] | None = None,
    notes_map: dict[str, str] | None = None,
    explains_map: dict[str, dict[str, str]] | None = None,
) -> dict:
    return {
        "title": "介護福祉士国家試験 過去問検索",
        "sessionMin": BUILD_SESSION_MIN,
        "sessionMax": BUILD_SESSION_MAX,
        "defaultFrom": DEFAULT_FROM,
        "defaultTo": DEFAULT_TO,
        "count": len(questions),
        "questions": [
            question_to_json(q, answers_map, notes_map, explains_map)
            for q in questions
        ],
    }


def make_cache_bust_version() -> str:
    return time.strftime("%Y%m%d%H%M%S")


def prepare_index_html(content: str, version: str) -> str:
    content = content.replace("__APP_BUILD__", version)
    content = re.sub(
        r'(href="style\.css)(?:\?v=[^"]*)?"',
        rf'\1?v={version}"',
        content,
    )
    content = re.sub(
        r'(src="app\.js)(?:\?v=[^"]*)?"',
        rf'\1?v={version}"',
        content,
    )
    return content


def is_kana_only_word(word: str) -> bool:
    """ひらがな・カタカナのみ（長音・中黒含む）なら True。"""
    if not word:
        return False
    return bool(
        re.fullmatch(r"[\u3041-\u3096\u309D-\u309E\u30A1-\u30F6\u30F8-\u30FFァ-ヶー・･]+", word)
    )


def build_ruby_entries(all_words: list) -> list[dict]:
    by_word: dict[str, str] = {}
    for item in all_words:
        if not isinstance(item, dict):
            continue
        word = str(item.get("word") or item.get("w") or "").strip()
        ruby = str(item.get("ruby") or item.get("r") or "").strip()
        if not word or not ruby or len(word) < MIN_RUBY_WORD_LEN:
            continue
        if is_kana_only_word(word):
            continue
        if word not in by_word:
            by_word[word] = ruby
    entries = [{"w": w, "r": by_word[w]} for w in by_word]
    entries.sort(key=lambda x: len(x["w"]), reverse=True)
    return entries


def fetch_ruby_entries_from_gas() -> list[dict]:
    import urllib.request

    req = urllib.request.Request(
        GAS_WORDS_URL,
        headers={"User-Agent": "care-worker-library-deploy/1.0"},
    )
    with urllib.request.urlopen(req, timeout=60) as res:
        raw = res.read()
    payload = json.loads(raw.decode("utf-8"))
    if isinstance(payload, dict) and "allWords" not in payload and "data" in payload:
        payload = payload["data"]
    words = (payload or {}).get("allWords") or []
    return build_ruby_entries(words)


def load_ruby_entries_from_words_file() -> list[dict] | None:
    """編集用 ruby_words.json があれば、マッチ用（長い語優先）に整えて返す。"""
    path = SITE_DIR / "ruby_words.json"
    if not path.is_file():
        return None
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("ruby_words.json は配列である必要があります")
    return build_ruby_entries(raw)


def write_ruby_json() -> Path:
    out = SITE_DIR / "ruby.json"
    try:
        entries = load_ruby_entries_from_words_file()
        source = "ruby_words.json"
        if entries is None:
            entries = fetch_ruby_entries_from_gas()
            source = "GAS単語リスト"
        out.write_text(
            json.dumps(entries, ensure_ascii=False, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        print(f"生成: ルビ {len(entries)} 語 ← {source} → {out}")
    except Exception as err:
        if out.is_file():
            print(f"警告: ルビ取得失敗（既存 ruby.json を使用）: {err}")
        else:
            out.write_text("[]\n", encoding="utf-8")
            print(f"警告: ルビ取得失敗（空の ruby.json）: {err}")
    return out


def build_site() -> Path:
    if not KAKOMON_TXT.is_file():
        raise FileNotFoundError(f"過去問テキストがありません: {KAKOMON_TXT}")
    if BUILD_SESSION_MIN > BUILD_SESSION_MAX:
        raise ValueError("BUILD_SESSION_MIN は BUILD_SESSION_MAX 以下にしてください")

    for name in ("index.html", "style.css", "app.js"):
        if not (SITE_DIR / name).is_file():
            raise FileNotFoundError(f"不足: {SITE_DIR / name}")

    print(
        f"抽出中: 第{BUILD_SESSION_MIN}回〜第{BUILD_SESSION_MAX}回 ← {KAKOMON_TXT.name}"
    )
    questions = load_questions(
        KAKOMON_TXT,
        session_min=BUILD_SESSION_MIN,
        session_max=BUILD_SESSION_MAX,
    )
    answers_map, notes_map = load_answers_map()
    explains_map = load_explains_map()
    payload = build_payload(questions, answers_map, notes_map, explains_map)
    with_answers = sum(1 for q in payload["questions"] if q.get("answers"))
    with_notes = sum(1 for q in payload["questions"] if q.get("note"))
    with_explains = sum(1 for q in payload["questions"] if q.get("explains"))
    out = SITE_DIR / "questions.json"
    out.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        f"生成: {len(questions)} 問"
        f"（正解付き {with_answers}、注釈 {with_notes}、解説 {with_explains}） → {out}"
    )
    write_ruby_json()
    return out


def ensure_remote_dir(ftps: FTP_TLS, path: str) -> None:
    parts = [p for p in path.strip("/").split("/") if p]
    ftps.cwd("/")
    for part in parts:
        try:
            ftps.cwd(part)
        except Exception:
            ftps.mkd(part)
            ftps.cwd(part)


def upload_site() -> None:
    version = make_cache_bust_version()
    ftps = FTP_TLS()
    ftps.connect(FTP_HOST, 21, timeout=30)
    ftps.login(FTP_USER, FTP_PASS)
    ftps.prot_p()
    ftps.set_pasv(True)
    ensure_remote_dir(ftps, REMOTE_SITE_DIR)

    htaccess_bytes = io.BytesIO(HTACCESS_CONTENT.strip().encode("utf-8"))
    ftps.storbinary("STOR .htaccess", htaccess_bytes)
    print("アップロード完了: .htaccess")

    for name in DEPLOY_FILES:
        local_path = SITE_DIR / name
        if not local_path.is_file():
            raise FileNotFoundError(f"不足: {local_path}")
        if name == "index.html":
            content = prepare_index_html(
                local_path.read_text(encoding="utf-8"), version
            )
            ftps.storbinary("STOR index.html", io.BytesIO(content.encode("utf-8")))
        else:
            with local_path.open("rb") as f:
                ftps.storbinary(f"STOR {name}", f)
        print(f"アップロード完了: {name}")

    ftps.quit()
    print(f"\n公開URL: {PUBLIC_URL}?_cb={version}")


def main() -> int:
    parser = argparse.ArgumentParser(description="過去問キーワード検索を生成・デプロイ")
    parser.add_argument(
        "--build-only",
        action="store_true",
        help="FTPせず questions.json だけ生成",
    )
    args = parser.parse_args()
    try:
        build_site()
        if not args.build_only:
            upload_site()
    except Exception as err:
        print(str(err), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
