#!/usr/bin/env python3
"""秘密URL（ログインなし・db の生徒別進捗列）を /kaigo/p/<TOKEN>/ にアップロードする。

- ルート https://nihongo.site/ には一切触らない
- 毎回 test/ の index.html / style.css / app.js をコピーしてからアップロード
- 公開URLに /test は付かないため、GAS は本番（env=test なし）→ シート「db」
- 生徒コードを app.js に注入し、GAS 側で進捗列を切り替える
  - J  → I/J 列
  - JF → K/L 列

使い方:
  python3 kaigo/p/deploy_private.py           # 全生徒
  python3 kaigo/p/deploy_private.py J         # J のみ
  python3 kaigo/p/deploy_private.py JF        # JF のみ
"""

from __future__ import annotations

import argparse
import io
import json
import re
import shutil
import time
from ftplib import FTP_TLS
from pathlib import Path

P_DIR = Path(__file__).resolve().parent
ROOT_DIR = P_DIR.parent.parent
TEST_DIR = ROOT_DIR / "test"

FTP_HOST = "www1165.conoha.ne.jp"
FTP_USER = "ao@nihongo.site"
FTP_PASS = "highway#61"
REMOTE_BASE_DIR = "/public_html/nihongo.site"

DEPLOY_FILES = ("index.html", "style.css", "app.js")

# 生徒定義（トークンは推測されにくいパス用。変更時はフォルダ名も合わせる）
STUDENTS: dict[str, dict] = {
    "J": {
        "token": "NrtaCnSFK08mJF-SnlCWBmmr",
        "seed_dates": ["2026-09-15"],
        "db_cols": "I/J（覚えた / 学習日）",
    },
    "JF": {
        "token": "AHB6rudP29TOi4p6AWDyROZQ",
        "seed_dates": [],
        "db_cols": "K/L（覚えた（JF） / 学習日（JF））",
    },
}

HTACCESS_CONTENT = """
<IfModule mod_headers.c>
    <FilesMatch "\\.(html|css|js)$">
        Header always set Cache-Control "no-store, no-cache, must-revalidate, max-age=0"
        Header always set Pragma "no-cache"
        Header always set Expires "0"
    </FilesMatch>
    Header always unset ETag
    Header always set X-Robots-Tag "noindex, nofollow"
</IfModule>
FileETag None
"""


def make_cache_bust_version() -> str:
    return time.strftime("%Y%m%d%H%M%S")


def prepare_index_html(content: str, version: str) -> str:
    content = content.replace("__APP_BUILD__", version)
    if 'name="robots"' not in content:
        content = content.replace(
            '<meta name="viewport"',
            '<meta name="robots" content="noindex, nofollow">\n  <meta name="viewport"',
            1,
        )
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


def prepare_app_js(content: str, student_code: str, seed_dates: list[str]) -> str:
    """生徒コードとシード日付を注入する。"""
    content, n1 = re.subn(
        r'var PRIVATE_STUDENT_CODE = "[^"]*";',
        f'var PRIVATE_STUDENT_CODE = "{student_code}";',
        content,
        count=1,
    )
    if n1 != 1:
        raise RuntimeError("PRIVATE_STUDENT_CODE の差し替えに失敗しました")

    seed_json = json.dumps(seed_dates, ensure_ascii=False)
    content, n2 = re.subn(
        r"var PRIVATE_SEEDED_ACHIEVED_DATES = \[[^\]]*\];",
        f"var PRIVATE_SEEDED_ACHIEVED_DATES = {seed_json};",
        content,
        count=1,
    )
    if n2 != 1:
        raise RuntimeError("PRIVATE_SEEDED_ACHIEVED_DATES の差し替えに失敗しました")
    return content


def sync_from_test(student_code: str, token: str, seed_dates: list[str]) -> Path:
    """test/ の3ファイルを秘密フォルダへコピーし、生徒設定を注入。"""
    site_dir = P_DIR / token
    site_dir.mkdir(parents=True, exist_ok=True)
    missing = []
    for name in DEPLOY_FILES:
        src = TEST_DIR / name
        if not src.is_file():
            missing.append(str(src))
            continue
        shutil.copy2(src, site_dir / name)
    if missing:
        raise FileNotFoundError("test/ に不足: " + ", ".join(missing))

    app_path = site_dir / "app.js"
    app_path.write_text(
        prepare_app_js(app_path.read_text(encoding="utf-8"), student_code, seed_dates),
        encoding="utf-8",
    )
    return site_dir


def ensure_remote_dir(ftps: FTP_TLS, path: str) -> None:
    parts = [p for p in path.strip("/").split("/") if p]
    ftps.cwd("/")
    for part in parts:
        try:
            ftps.cwd(part)
        except Exception:
            ftps.mkd(part)
            ftps.cwd(part)


def write_url_txt() -> None:
    lines = [
        "# 秘密URL（ログインなし）一覧",
        "# このファイルとトークンは生徒以外に公開しないこと。",
        "# ルート https://nihongo.site/ とは別。リダイレクトはしない。",
        "",
        "# デプロイ:",
        "#   python3 kaigo/p/deploy_private.py        # 全生徒",
        "#   python3 kaigo/p/deploy_private.py J",
        "#   python3 kaigo/p/deploy_private.py JF",
        "",
        "# GAS 再デプロイ（進捗列・生徒切替の変更後は必須）:",
        "#   1. Apps Script エディタで gas/webapp.js を反映",
        "#   2. デプロイ → デプロイを管理 → 編集 → 新バージョン → デプロイ",
        "#   3. db シートに K=覚えた（JF） / L=学習日（JF） があること（I/J は J 用のまま）",
        "",
    ]
    for code, conf in STUDENTS.items():
        token = conf["token"]
        url = f"https://nihongo.site/kaigo/p/{token}/"
        lines.append(f"# --- {code} ---")
        lines.append(f"# db列: {conf['db_cols']}")
        lines.append(f"TOKEN_{code}={token}")
        lines.append(f"URL_{code}={url}")
        lines.append("")
    (P_DIR / "URL.txt").write_text("\n".join(lines), encoding="utf-8")


def upload_student(ftps: FTP_TLS, student_code: str, version: str) -> str:
    conf = STUDENTS[student_code]
    token = conf["token"]
    site_dir = sync_from_test(student_code, token, list(conf["seed_dates"]))
    remote_dir = f"{REMOTE_BASE_DIR}/kaigo/p/{token}"
    public_url = f"https://nihongo.site/kaigo/p/{token}/"

    ensure_remote_dir(ftps, remote_dir)

    htaccess_bytes = io.BytesIO(HTACCESS_CONTENT.strip().encode("utf-8"))
    ftps.storbinary("STOR .htaccess", htaccess_bytes)
    print(f"[{student_code}] アップロード完了: .htaccess")

    for name in DEPLOY_FILES:
        local_path = site_dir / name
        if name == "index.html":
            content = prepare_index_html(
                local_path.read_text(encoding="utf-8"), version
            )
            ftps.storbinary("STOR index.html", io.BytesIO(content.encode("utf-8")))
        else:
            with local_path.open("rb") as f:
                ftps.storbinary(f"STOR {name}", f)
        print(f"[{student_code}] アップロード完了: {name}")

    return f"{public_url}?_cb={version}"


def upload_private(student_codes: list[str] | None = None) -> None:
    targets = student_codes or list(STUDENTS.keys())
    for code in targets:
        if code not in STUDENTS:
            raise SystemExit(
                f"未知の生徒コード: {code}（候補: {', '.join(STUDENTS)}）"
            )

    write_url_txt()
    version = make_cache_bust_version()

    ftps = FTP_TLS()
    ftps.connect(FTP_HOST, 21, timeout=20)
    ftps.login(FTP_USER, FTP_PASS)
    ftps.prot_p()
    ftps.set_pasv(True)

    urls: list[str] = []
    for code in targets:
        urls.append(upload_student(ftps, code, version))

    ftps.quit()

    print("\n秘密URL（口頭でのみ共有）:")
    for code, url in zip(targets, urls):
        print(f"  [{code}] {url}")
        print(f"       db列: {STUDENTS[code]['db_cols']}")
    print("コピー元: test/ → 公開パスに /test なし → シートは本番 db")
    print("ルート https://nihongo.site/ は変更していません。")
    print(
        "\n※ GAS（webapp.js）を更新した場合は Apps Script で新バージョンをデプロイしてください。"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="秘密URLを生徒別にデプロイ")
    parser.add_argument(
        "students",
        nargs="*",
        help="生徒コード（省略時は全員）。例: J JF",
    )
    args = parser.parse_args()
    upload_private(args.students or None)


if __name__ == "__main__":
    main()
