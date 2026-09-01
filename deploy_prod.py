#!/usr/bin/env python3
"""
ルートの index.html, style.css, app.js をそのまま FTP で本番にアップロードし、
本番タブを1回だけ再読み込みする。

test/ からのコピーは行わない。ルートのファイルを直接デプロイする場合に使う。
"""

import io
import os
import subprocess
import sys
import time
from ftplib import FTP_TLS

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

FTP_HOST = "www1165.conoha.ne.jp"
FTP_USER = "ao@nihongo.site"
FTP_PASS = "ighway#61"

REMOTE_BASE_DIR = "/public_html/nihongo.site"

DEPLOY_FILES = ("index.html", "style.css", "app.js")

HTACCESS_CONTENT = """
<IfModule mod_headers.c>
    Header set Cache-Control "no-store, no-cache, must-revalidate, max-age=0"
    Header set Pragma "no-cache"
    Header set Expires "0"
</IfModule>
"""


def ensure_prod_files_exist():
    """本番用3ファイルの存在を確認"""
    missing = []
    for name in DEPLOY_FILES:
        path = os.path.join(ROOT_DIR, name)
        if not os.path.isfile(path):
            missing.append(name)
    if missing:
        raise FileNotFoundError(f"アップロード対象が見つかりません: {', '.join(missing)}")


def upload_prod_files():
    """本番3ファイルをFTPでアップロード"""
    try:
        ftps = FTP_TLS()
        ftps.connect(FTP_HOST, 21, timeout=10)
        ftps.login(FTP_USER, FTP_PASS)
        ftps.prot_p()
        ftps.set_pasv(True)
        ftps.cwd(REMOTE_BASE_DIR)

        htaccess_bytes = io.BytesIO(HTACCESS_CONTENT.strip().encode("utf-8"))
        ftps.storbinary("STOR .htaccess", htaccess_bytes)

        for name in DEPLOY_FILES:
            local_path = os.path.join(ROOT_DIR, name)
            with open(local_path, "rb") as f:
                ftps.storbinary(f"STOR {name}", f)
            print(f"アップロード完了: {name}")

        ftps.quit()
    except Exception as e:
        raise RuntimeError(f"FTPアップロードに失敗しました: {e}") from e


def reload_prod_browser_once():
    """本番タブ（/test 以外）を1回だけ再読み込み"""
    chrome_script = """
    tell application "Google Chrome"
        if (count of windows) > 0 then
            repeat with w in windows
                repeat with t in tabs of w
                    set tabUrl to URL of t
                    if tabUrl contains "nihongo.site" and tabUrl does not contain "nihongo.site/test" then
                        tell t to reload
                        return
                    end if
                end repeat
            end repeat
        end if
    end tell
    """
    try:
        subprocess.run(["osascript", "-e", chrome_script], check=False)
        print("本番タブを再読み込みしました。")
    except Exception as e:
        print(f"ブラウザ更新エラー: {e}")


def main():
    os.chdir(ROOT_DIR)

    print("=== 本番デプロイ（ルート3ファイルをそのまま送信） ===")
    ensure_prod_files_exist()
    upload_prod_files()
    time.sleep(0.5)
    reload_prod_browser_once()
    print("=== 完了 ===")


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        print(f"エラー: {err}", file=sys.stderr)
        sys.exit(1)
