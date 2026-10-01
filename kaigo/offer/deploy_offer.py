#!/usr/bin/env python3
"""kaigo/offer/ を FTP で https://nihongo.site/kaigo/offer/ にアップロードする。

ルート（J用）と /kaigo/words/ には触らない。
"""

import io
import os
from ftplib import FTP_TLS

OFFER_DIR = os.path.dirname(os.path.abspath(__file__))

FTP_HOST = "www1165.conoha.ne.jp"
FTP_USER = "ao@nihongo.site"
FTP_PASS = "highway#61"

REMOTE_BASE_DIR = "/public_html/nihongo.site"
REMOTE_OFFER_DIR = REMOTE_BASE_DIR + "/kaigo/offer"

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


def ensure_remote_dir(ftps, path):
    parts = [p for p in path.strip("/").split("/") if p]
    ftps.cwd("/")
    for part in parts:
        try:
            ftps.cwd(part)
        except Exception:
            ftps.mkd(part)
            ftps.cwd(part)


def upload_offer():
    local_path = os.path.join(OFFER_DIR, "index.html")
    if not os.path.isfile(local_path):
        raise FileNotFoundError("kaigo/offer/index.html がありません")

    ftps = FTP_TLS()
    ftps.connect(FTP_HOST, 21, timeout=20)
    ftps.login(FTP_USER, FTP_PASS)
    ftps.prot_p()
    ftps.set_pasv(True)

    ensure_remote_dir(ftps, REMOTE_OFFER_DIR)

    htaccess_bytes = io.BytesIO(HTACCESS_CONTENT.strip().encode("utf-8"))
    ftps.storbinary("STOR .htaccess", htaccess_bytes)
    print("アップロード完了: .htaccess")

    with open(local_path, "rb") as f:
        ftps.storbinary("STOR index.html", f)
    print("アップロード完了: index.html")

    ftps.quit()
    print("\n公開URL: https://nihongo.site/kaigo/offer/")


if __name__ == "__main__":
    upload_offer()
