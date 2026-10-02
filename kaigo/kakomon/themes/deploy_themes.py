#!/usr/bin/env python3
"""重要テーマ過去問を /kaigo/kakomon/themes/ に公開する。

- 入力: important_theme_extract/ の「.txt」ファイル
- ファイル名（拡張子除く）→ ページ見出し
- 本文の 【回-番号｜…】 → questions.json から問題を抽出
- 表示は kakomon と同じカード形式（style / ルビ / 正誤UI）

使い方:
  python3 kaigo/kakomon/themes/deploy_themes.py           # 生成＋FTP
  python3 kaigo/kakomon/themes/deploy_themes.py --build-only
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import shutil
import sys
import time
from copy import deepcopy
from ftplib import FTP_TLS
from pathlib import Path

SITE_DIR = Path(__file__).resolve().parent
KAKOMON_DIR = SITE_DIR.parent
ROOT = KAKOMON_DIR.parent.parent
THEME_SRC_DIR = ROOT / "important_theme_extract"
QUESTIONS_JSON = KAKOMON_DIR / "questions.json"
DATA_DIR = SITE_DIR / "data"

FTP_HOST = "www1165.conoha.ne.jp"
FTP_USER = "ao@nihongo.site"
FTP_PASS = "highway#61"
REMOTE_BASE_DIR = "/public_html/nihongo.site"
REMOTE_SITE_DIR = f"{REMOTE_BASE_DIR}/kaigo/kakomon/themes"
PUBLIC_URL = "https://nihongo.site/kaigo/kakomon/themes/"

# 初期表示する直近回（見出しの問題数もこの範囲）
RECENT_SESSION_MIN = 34
RECENT_SESSION_MAX = 38
# 図あり問題を questions.json から自動生成するテーマ名
ILLUST_THEME_TITLE = "イラスト問題"
# 全件・ファイル順で出すテーマ（もっと見るなし）
SHOW_ALL_IN_ORDER_TITLES = frozenset({"同じ問題"})

RE_QID = re.compile(r"【\s*(\d+)\s*-\s*(\d+)")

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

DEPLOY_STATIC = ("index.html", "view.html", "app.js", "style.css", "ruby.json", "themes.css")


def make_cache_bust_version() -> str:
    return time.strftime("%Y%m%d%H%M%S")


def prepare_html(content: str, version: str) -> str:
    content = content.replace("__APP_BUILD__", version)
    content = re.sub(
        r'(href="(?:style|themes)\.css)(?:\?v=[^"]*)?"',
        rf'\1?v={version}"',
        content,
    )
    content = re.sub(
        r'(src="app\.js)(?:\?v=[^"]*)?"',
        rf'\1?v={version}"',
        content,
    )
    return content


def make_slug(title: str) -> str:
    """安定した短いスラッグ（日本語ファイル名のFTP事故を避ける）。"""
    digest = hashlib.sha1(title.encode("utf-8")).hexdigest()[:12]
    return digest


def list_theme_source_files() -> list[Path]:
    if not THEME_SRC_DIR.is_dir():
        raise FileNotFoundError(f"テーマ元フォルダがありません: {THEME_SRC_DIR}")
    files = []
    for path in sorted(THEME_SRC_DIR.iterdir(), key=lambda p: p.name):
        if not path.is_file():
            continue
        if path.name.startswith("."):
            continue
        # .txt のみ（見出しは stem）
        if path.suffix.lower() != ".txt":
            continue
        files.append(path)
    return files


def extract_question_ids(text: str) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()
    for m in RE_QID.finditer(text or ""):
        qid = f"{int(m.group(1))}-{int(m.group(2))}"
        if qid in seen:
            continue
        seen.add(qid)
        ids.append(qid)
    return ids


def is_recent_session_question(question: dict) -> bool:
    raw = question.get("round")
    if raw is None or raw == "":
        return False
    try:
        round_n = int(raw)
    except (TypeError, ValueError):
        return False
    return RECENT_SESSION_MIN <= round_n <= RECENT_SESSION_MAX


def count_recent_questions(questions: list[dict]) -> int:
    return sum(1 for q in questions if is_recent_session_question(q))


def question_has_figure(question: dict) -> bool:
    figs = question.get("figures") or []
    if figs:
        return True
    choice_figs = question.get("choiceFigures") or {}
    if not isinstance(choice_figs, dict):
        return False
    return any(choice_figs.values())


def regenerate_illustration_theme_txt(by_id: dict[str, dict]) -> None:
    """questions.json から図あり問題を抽出し、イラスト問題.txt を自動生成する。"""
    items: list[dict] = []
    for q in by_id.values():
        if question_has_figure(q):
            items.append(q)
    items.sort(
        key=lambda q: (
            -int(q.get("round") or 0),
            int(q.get("number") or 0),
        )
    )
    lines: list[str] = []
    for q in items:
        qid = str(q.get("id") or "").strip()
        if not qid:
            qid = f"{int(q.get('round') or 0)}-{int(q.get('number') or 0)}"
        subject = str(q.get("subject") or "").strip()
        lines.append(f"【{qid}｜{subject}】")
    out = THEME_SRC_DIR / f"{ILLUST_THEME_TITLE}.txt"
    out.write_text(("\n".join(lines) + ("\n" if lines else "")), encoding="utf-8")
    print(f"自動生成: {out.name} → {len(lines)} 問")


def rewrite_asset_path(path: str) -> str:
    raw = str(path or "").strip()
    if not raw:
        return raw
    if raw.startswith("figures/"):
        return "../" + raw
    if raw.startswith("/kaigo/kakomon/"):
        return raw
    if raw.startswith("../kakomon/figures/"):
        return "../figures/" + raw[len("../kakomon/figures/") :]
    return raw


def rewrite_question_assets(question: dict) -> dict:
    q = deepcopy(question)
    figs = q.get("figures") or []
    if figs:
        q["figures"] = [rewrite_asset_path(f) for f in figs]
    choice_figs = q.get("choiceFigures") or {}
    if choice_figs:
        rewritten = {}
        for key, src in choice_figs.items():
            rewritten[key] = rewrite_asset_path(src)
        q["choiceFigures"] = rewritten
    return q


def load_questions_by_id() -> dict[str, dict]:
    if not QUESTIONS_JSON.is_file():
        raise FileNotFoundError(
            f"questions.json がありません。先に kakomon をビルドしてください: {QUESTIONS_JSON}"
        )
    payload = json.loads(QUESTIONS_JSON.read_text(encoding="utf-8"))
    by_id: dict[str, dict] = {}
    for item in payload.get("questions") or []:
        qid = str(item.get("id") or "").strip()
        if not qid:
            round_n = item.get("round")
            number_n = item.get("number")
            if round_n is None or number_n is None:
                continue
            qid = f"{int(round_n)}-{int(number_n)}"
        by_id[qid] = item
    return by_id


def sync_shared_assets() -> None:
    shutil.copy2(KAKOMON_DIR / "style.css", SITE_DIR / "style.css")
    ruby_src = KAKOMON_DIR / "ruby.json"
    if ruby_src.is_file():
        shutil.copy2(ruby_src, SITE_DIR / "ruby.json")
    else:
        (SITE_DIR / "ruby.json").write_text("[]\n", encoding="utf-8")


def build_site() -> list[dict]:
    sync_shared_assets()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    for old in DATA_DIR.glob("*.json"):
        old.unlink()

    by_id = load_questions_by_id()
    regenerate_illustration_theme_txt(by_id)
    sources = list_theme_source_files()
    if not sources:
        print(f"警告: .txt のテーマファイルがありません → {THEME_SRC_DIR}")

    themes: list[dict] = []
    for path in sources:
        title = path.stem
        slug = make_slug(title)
        ids = extract_question_ids(path.read_text(encoding="utf-8"))
        questions = []
        missing = []
        for qid in ids:
            src = by_id.get(qid)
            if not src:
                missing.append(qid)
                continue
            questions.append(rewrite_question_assets(src))

        show_all = title in SHOW_ALL_IN_ORDER_TITLES
        if show_all:
            recent_count = len(questions)
            older_count = 0
            display_count = len(questions)
        else:
            recent_count = count_recent_questions(questions)
            older_count = len(questions) - recent_count
            # 見出し用: 直近があればその件数、なければ全件
            display_count = recent_count if recent_count > 0 else len(questions)

        payload = {
            "title": title,
            "slug": slug,
            "count": len(questions),
            "recentCount": recent_count,
            "olderCount": older_count,
            "displayCount": display_count,
            "recentSessionMin": RECENT_SESSION_MIN,
            "recentSessionMax": RECENT_SESSION_MAX,
            # 同じ問題など: もっと見るなし・txt の並びのまま
            "showAllInOrder": show_all,
            "ids": [q.get("id") or f"{q.get('round')}-{q.get('number')}" for q in questions],
            "missing": missing,
            "questions": questions,
        }
        out = DATA_DIR / f"{slug}.json"
        out.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        themes.append(
            {
                "title": title,
                "slug": slug,
                "count": len(questions),
                "recentCount": recent_count,
                "olderCount": older_count,
                "displayCount": display_count,
                "missingCount": len(missing),
                "href": f"view.html?t={slug}",
            }
        )
        if show_all:
            msg = f"テーマ: {title} → 全 {len(questions)} 問（ファイル順・もっと見るなし）"
        else:
            msg = (
                f"テーマ: {title} → 表示 {display_count} 問"
                f"（全 {len(questions)} / 直近 {recent_count} / 以前 {older_count}）"
            )
        if missing:
            msg += f"（欠番 {len(missing)}: {', '.join(missing[:8])}{'…' if len(missing) > 8 else ''}）"
        print(msg)

    index_payload = {
        "title": "介護福祉士国家試験 重要テーマ",
        "count": len(themes),
        "themes": themes,
    }
    (SITE_DIR / "index.json").write_text(
        json.dumps(index_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"一覧: {len(themes)} テーマ → {SITE_DIR / 'index.json'}")
    return themes


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

    for name in DEPLOY_STATIC:
        local_path = SITE_DIR / name
        if not local_path.is_file():
            raise FileNotFoundError(f"不足: {local_path}")
        if name.endswith(".html"):
            content = prepare_html(local_path.read_text(encoding="utf-8"), version)
            ftps.storbinary(f"STOR {name}", io.BytesIO(content.encode("utf-8")))
        else:
            with local_path.open("rb") as f:
                ftps.storbinary(f"STOR {name}", f)
        print(f"アップロード完了: {name}")

    index_json = SITE_DIR / "index.json"
    with index_json.open("rb") as f:
        ftps.storbinary("STOR index.json", f)
    print("アップロード完了: index.json")

    ensure_remote_dir(ftps, f"{REMOTE_SITE_DIR}/data")
    for path in sorted(DATA_DIR.glob("*.json")):
        with path.open("rb") as f:
            ftps.storbinary(f"STOR {path.name}", f)
        print(f"アップロード完了: data/{path.name}")

    ftps.quit()
    print(f"\n公開URL: {PUBLIC_URL}?_cb={version}")


def main() -> int:
    parser = argparse.ArgumentParser(description="重要テーマ過去問を生成・デプロイ")
    parser.add_argument(
        "--build-only",
        action="store_true",
        help="FTPせず JSON と共有アセットだけ生成",
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
