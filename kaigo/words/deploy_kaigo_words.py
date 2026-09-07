#!/usr/bin/env python3
"""kaigo/words/ を FTP で https://nihongo.site/kaigo/words/ にアップロードする。

ルート（J用）には一切触らない。
"""

import io
import os
import re
import time
from ftplib import FTP_TLS

WORDS_DIR = os.path.dirname(os.path.abspath(__file__))

FTP_HOST = "www1165.conoha.ne.jp"
FTP_USER = "ao@nihongo.site"
FTP_PASS = "highway#61"

REMOTE_BASE_DIR = "/public_html/nihongo.site"
REMOTE_WORDS_DIR = REMOTE_BASE_DIR + "/kaigo/words"

DEPLOY_FILES = ("index.html", "style.css", "app.js")

HTACCESS_CONTENT = """
<IfModule mod_headers.c>
    <FilesMatch "\\.(html|css|js)$">
        Header always set Cache-Control "no-store, no-cache, must-revalidate, max-age=0"
        Header always set Pragma "no-cache"
        Header always set Expires "0"
    </FilesMatch>
    Header always unset ETag
</IfModule>
FileETag None
"""


def make_cache_bust_version():
    return time.strftime("%Y%m%d%H%M%S")


def prepare_index_html(content, version):
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


def ensure_files():
    missing = []
    for name in DEPLOY_FILES:
        path = os.path.join(WORDS_DIR, name)
        if not os.path.isfile(path):
            missing.append(name)
    if missing:
        raise FileNotFoundError(f"kaigo/words/ に不足: {', '.join(missing)}")


def ensure_remote_dir(ftps, path):
    parts = [p for p in path.strip("/").split("/") if p]
    ftps.cwd("/")
    for part in parts:
        try:
            ftps.cwd(part)
        except Exception:
            ftps.mkd(part)
            ftps.cwd(part)


def upload_kaigo_words():
    ensure_files()
    version = make_cache_bust_version()

    ftps = FTP_TLS()
    ftps.connect(FTP_HOST, 21, timeout=20)
    ftps.login(FTP_USER, FTP_PASS)
    ftps.prot_p()
    ftps.set_pasv(True)

    ensure_remote_dir(ftps, REMOTE_WORDS_DIR)

    htaccess_bytes = io.BytesIO(HTACCESS_CONTENT.strip().encode("utf-8"))
    ftps.storbinary("STOR .htaccess", htaccess_bytes)
    print("アップロード完了: .htaccess")

    for name in DEPLOY_FILES:
        local_path = os.path.join(WORDS_DIR, name)
        if name == "index.html":
            with open(local_path, "r", encoding="utf-8") as f:
                content = prepare_index_html(f.read(), version)
            payload = io.BytesIO(content.encode("utf-8"))
            ftps.storbinary("STOR index.html", payload)
        else:
            with open(local_path, "rb") as f:
                ftps.storbinary(f"STOR {name}", f)
        print(f"アップロード完了: {name}")

    ftps.quit()
    print(f"\n公開URL: https://nihongo.site/kaigo/words/?_cb={version}")
    print("注意: GAS に webapp.js の最新版を反映し、GOOGLE_CLIENT_ID を設定してください。")


if __name__ == "__main__":
    upload_kaigo_words()
