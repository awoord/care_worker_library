#!/usr/bin/env python3
"""J専用（ログインなし・dbのI/J保存）を /kaigo/p/<TOKEN>/ にアップロードする。

- ルート https://nihongo.site/ には一切触らない
- 毎回 test/ の index.html / style.css / app.js をコピーしてからアップロード
- 公開URLに /test は付かないため、GAS は本番（env=test なし）→ シート「db」の I/J
  （test/ 由来でも「db のコピー」にはならない）

使い方:
  python3 kaigo/p/deploy_private.py
"""

from __future__ import annotations

import io
import re
import shutil
import time
from ftplib import FTP_TLS
from pathlib import Path

P_DIR = Path(__file__).resolve().parent
ROOT_DIR = P_DIR.parent.parent
TEST_DIR = ROOT_DIR / "test"

# 推測されにくいパス用トークン（変更する場合はフォルダ名も合わせる）
TOKEN = "NrtaCnSFK08mJF-SnlCWBmmr"
SITE_DIR = P_DIR / TOKEN

FTP_HOST = "www1165.conoha.ne.jp"
FTP_USER = "ao@nihongo.site"
FTP_PASS = "highway#61"

REMOTE_BASE_DIR = "/public_html/nihongo.site"
REMOTE_SITE_DIR = f"{REMOTE_BASE_DIR}/kaigo/p/{TOKEN}"

DEPLOY_FILES = ("index.html", "style.css", "app.js")
PUBLIC_URL = f"https://nihongo.site/kaigo/p/{TOKEN}/"

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


def sync_from_test() -> None:
    """test/ の3ファイルを秘密フォルダへコピー（test/・ルートは変更しない）。"""
    SITE_DIR.mkdir(parents=True, exist_ok=True)
    missing = []
    for name in DEPLOY_FILES:
        src = TEST_DIR / name
        if not src.is_file():
            missing.append(str(src))
            continue
        shutil.copy2(src, SITE_DIR / name)
    if missing:
        raise FileNotFoundError("test/ に不足: " + ", ".join(missing))


def ensure_remote_dir(ftps: FTP_TLS, path: str) -> None:
    parts = [p for p in path.strip("/").split("/") if p]
    ftps.cwd("/")
    for part in parts:
        try:
            ftps.cwd(part)
        except Exception:
            ftps.mkd(part)
            ftps.cwd(part)


def upload_private() -> None:
    sync_from_test()
    version = make_cache_bust_version()

    ftps = FTP_TLS()
    ftps.connect(FTP_HOST, 21, timeout=20)
    ftps.login(FTP_USER, FTP_PASS)
    ftps.prot_p()
    ftps.set_pasv(True)

    # ルート直下・/test/ はアップロードしない。kaigo/p/<TOKEN>/ のみ。
    ensure_remote_dir(ftps, REMOTE_SITE_DIR)

    htaccess_bytes = io.BytesIO(HTACCESS_CONTENT.strip().encode("utf-8"))
    ftps.storbinary("STOR .htaccess", htaccess_bytes)
    print("アップロード完了: .htaccess")

    for name in DEPLOY_FILES:
        local_path = SITE_DIR / name
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
    print(f"\nJ専用URL（口頭でのみ共有）:\n  {PUBLIC_URL}?_cb={version}")
    print("コピー元: test/ → 公開パスに /test なし → シートは本番 db（I/J）")
    print("ルート https://nihongo.site/ は変更していません。")


if __name__ == "__main__":
    upload_private()
