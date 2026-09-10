#!/usr/bin/env python3
"""キーワードで過去問を抽出し、ローカルでブラウザ表示する。

使い方:
  python3 deploy_by_keyword.py ICF
  python3 deploy_by_keyword.py 病態
  python3 deploy_by_keyword.py 利用者本位 自立支援   # AND 検索

処理:
  1. キーワード抽出（対象回は本ファイルの SESSION_MIN / SESSION_MAX）
  2. keyword_extract/ に txt 保存
  3. viewer/ テンプレで preview/<slug>/ に HTML を生成
  4. ローカル HTTP サーバで開き、通常ブラウザで表示

オプション:
  --no-open   ブラウザを開かない（生成のみ）
  --port N    待ち受けポート（既定: 空きポート自動）
"""

from __future__ import annotations

import argparse
import hashlib
import http.server
import json
import re
import shutil
import socket
import socketserver
import subprocess
import sys
import threading
import time
import unicodedata
from pathlib import Path

try:
    from .extract_by_keyword import (
        KAKOMON_TXT,
        OUTPUT_DIR,
        load_questions,
        parse_terms,
        safe_filename,
        search_questions,
    )
    from .kakomonn_links import question_url
except ImportError:  # python3 deploy_by_keyword.py で直接実行
    from extract_by_keyword import (
        KAKOMON_TXT,
        OUTPUT_DIR,
        load_questions,
        parse_terms,
        safe_filename,
        search_questions,
    )
    from kakomonn_links import question_url

DIR = Path(__file__).resolve().parent
VIEWER_DIR = DIR / "viewer"
PREVIEW_ROOT = DIR / "preview"

# 対象回（ここを書き換えて範囲を変える。例: 30 と 38）
SESSION_MIN = 33
SESSION_MAX = 38

RE_CHOICE_LINE = re.compile(r"^([1-5])[。．.\s]*(.*)$")

# よく使うキーワードの読みやすいパス名
KNOWN_SLUGS = {
    "icf": "icf",
    "病態": "byotai",
    "利用者本位 自立支援": "riyosha-jiritsu",
    "利用者本位・自立支援": "riyosha-jiritsu",
    "養護老人ホーム": "yogo-rojin",
}

# Cursor ではなく通常ブラウザで開く候補（macOS）
BROWSER_APP_CANDIDATES = (
    "Google Chrome",
    "Safari",
    "Firefox",
    "Microsoft Edge",
    "Brave Browser",
)


def make_cache_bust_version() -> str:
    return time.strftime("%Y%m%d%H%M%S")


def url_slug(keyword_label: str) -> str:
    """ローカルパス用の ASCII slug を作る。"""
    label = " ".join(keyword_label.split())
    if label in KNOWN_SLUGS:
        return KNOWN_SLUGS[label]
    lower = label.casefold()
    if lower in KNOWN_SLUGS:
        return KNOWN_SLUGS[lower]

    nfkc = unicodedata.normalize("NFKC", label)
    ascii_slug = re.sub(r"[^A-Za-z0-9]+", "-", nfkc).strip("-").lower()
    if ascii_slug and re.search(r"[a-z0-9]", ascii_slug):
        return ascii_slug[:60]

    digest = hashlib.sha1(label.encode("utf-8")).hexdigest()[:8]
    return f"kw-{digest}"


def parse_choice_line(line: str) -> dict | None:
    m = RE_CHOICE_LINE.match(line.strip())
    if not m:
        return None
    return {"n": int(m.group(1)), "text": m.group(2).strip()}


def question_to_json(q) -> dict:
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

    expl_url = question_url(q.session, q.number) or ""
    return {
        "id": f"{q.session}-{q.number}",
        "round": int(q.session),
        "number": int(q.number),
        "subject": q.subject,
        "body": body,
        "choices": choices,
        "explanation": expl_url,
    }


def build_questions_payload(keyword_label: str, hits: list) -> dict:
    return {
        "keyword": keyword_label,
        "title": keyword_label,
        "count": len(hits),
        "questions": [question_to_json(q) for q in hits],
    }


def build_index_html(keyword_label: str, count: int, version: str) -> str:
    template_path = VIEWER_DIR / "index.html"
    html = template_path.read_text(encoding="utf-8")
    title = f"{keyword_label}｜過去問"
    h1 = keyword_label
    lede = (
        f"キーワード「{keyword_label}」に関連する過去問です"
        f"（{count}問）。単語リストにあることばにはルビがつきます。"
    )
    html = re.sub(
        r"<title>.*?</title>",
        f"<title>{title}</title>",
        html,
        count=1,
        flags=re.DOTALL,
    )
    html = re.sub(
        r"<h1>.*?</h1>",
        f"<h1>{h1}</h1>",
        html,
        count=1,
        flags=re.DOTALL,
    )
    html = re.sub(
        r'<p class="lede">.*?</p>',
        f'<p class="lede">{lede}</p>',
        html,
        count=1,
        flags=re.DOTALL,
    )
    if 'name="robots"' not in html:
        html = html.replace(
            '<meta name="viewport"',
            '<meta name="robots" content="noindex, nofollow">\n  <meta name="viewport"',
            1,
        )
    html = html.replace("__APP_BUILD__", version)
    html = re.sub(
        r'(href="style\.css)(?:\?v=[^"]*)?"',
        rf'\1?v={version}"',
        html,
    )
    html = re.sub(
        r'(src="app\.js)(?:\?v=[^"]*)?"',
        rf'\1?v={version}"',
        html,
    )
    return html


def write_local_site(slug: str, keyword_label: str, payload: dict, version: str) -> Path:
    style_src = VIEWER_DIR / "style.css"
    app_src = VIEWER_DIR / "app.js"
    if not style_src.is_file() or not app_src.is_file():
        raise FileNotFoundError(f"viewer/ に style.css または app.js がありません: {VIEWER_DIR}")

    out_dir = PREVIEW_ROOT / slug
    out_dir.mkdir(parents=True, exist_ok=True)

    # 相対パスの CSS/JS を同じフォルダに置き、レイアウトが崩れないようにする
    shutil.copy2(style_src, out_dir / "style.css")
    shutil.copy2(app_src, out_dir / "app.js")

    (out_dir / "questions.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (out_dir / "index.html").write_text(
        build_index_html(keyword_label, payload["count"], version),
        encoding="utf-8",
    )
    return out_dir


def find_free_port(preferred: int = 0) -> int:
    if preferred > 0:
        return preferred
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def open_browser(url: str) -> None:
    """Cursor ではなく通常のブラウザアプリで開く。"""
    for app_name in BROWSER_APP_CANDIDATES:
        result = subprocess.run(
            ["open", "-a", app_name, url],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            print(f"ブラウザで開きました: {app_name}")
            return
    print(
        "ブラウザを自動起動できませんでした。次の URL を手動で開いてください:",
        file=sys.stderr,
    )
    print(url, file=sys.stderr)


def serve_local(local_dir: Path, port: int, open_page: bool) -> None:
    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(local_dir), **kwargs)

        def log_message(self, format: str, *args) -> None:
            return

    httpd = socketserver.TCPServer(("127.0.0.1", port), QuietHandler)
    url = f"http://127.0.0.1:{port}/"
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()

    print(f"ローカルURL: {url}")
    if open_page:
        open_browser(url)
    print("終了するには Ctrl+C")

    try:
        while True:
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\n停止します…")
    finally:
        httpd.shutdown()
        httpd.server_close()


def save_extract_txt(
    keyword_label: str,
    hits: list,
    session_from: int,
    session_to: int,
) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    chunks = [q.format() for q in hits]
    body = ("\n\n".join(chunks) + "\n") if chunks else ""
    header = (
        f"# キーワード: {keyword_label}\n"
        f"# 対象回: 第{session_from}回〜第{session_to}回\n"
        f"# ヒット: {len(hits)} 問\n\n"
    )
    out_path = OUTPUT_DIR / f"{safe_filename(keyword_label)}.txt"
    out_path.write_text(header + body, encoding="utf-8")
    return out_path


def main() -> int:
    parser = argparse.ArgumentParser(
        description="キーワード過去問を抽出してローカルでブラウザ表示する"
    )
    parser.add_argument(
        "keywords",
        nargs="*",
        help="検索キーワード（複数は AND。省略時は対話入力）",
    )
    parser.add_argument(
        "-i",
        "--input",
        type=Path,
        default=KAKOMON_TXT,
        help=f"入力ファイル（既定: {KAKOMON_TXT.name}）",
    )
    parser.add_argument(
        "--slug",
        default="",
        help="出力フォルダ名（省略時は自動）",
    )
    parser.add_argument(
        "--no-open",
        action="store_true",
        help="ブラウザを開かない（生成＋サーバのみ）",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=0,
        help="ローカルサーバのポート（0 で自動）",
    )
    args = parser.parse_args()

    if SESSION_MIN > SESSION_MAX:
        print("SESSION_MIN は SESSION_MAX 以下にしてください。", file=sys.stderr)
        return 1

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

    for name in ("style.css", "app.js", "index.html"):
        path = VIEWER_DIR / name
        if not path.is_file():
            print(f"テンプレ不足: {path}", file=sys.stderr)
            return 1

    print(f"抽出中: {keyword_label}（第{SESSION_MIN}回〜第{SESSION_MAX}回）")
    questions = load_questions(
        args.input,
        session_min=SESSION_MIN,
        session_max=SESSION_MAX,
    )
    hits = search_questions(questions, terms)
    txt_path = save_extract_txt(
        keyword_label,
        hits,
        SESSION_MIN,
        SESSION_MAX,
    )
    print(f"抽出完了: {len(hits)} 問 → {txt_path}")

    if not hits:
        print("ヒットが 0 問のため中止します。", file=sys.stderr)
        return 1

    slug = (args.slug or url_slug(keyword_label)).strip("/")
    if not slug or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", slug):
        print(f"不正な slug です: {slug}", file=sys.stderr)
        return 1

    version = make_cache_bust_version()
    payload = build_questions_payload(keyword_label, hits)
    try:
        local_dir = write_local_site(slug, keyword_label, payload, version)
    except (RuntimeError, FileNotFoundError) as err:
        print(str(err), file=sys.stderr)
        return 1

    print(f"ローカル生成: {local_dir}")
    port = find_free_port(args.port)
    serve_local(local_dir, port, open_page=not args.no_open)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
