import io
import os
import re
import subprocess
import time
from ftplib import FTP_TLS

# 設定情報
FTP_HOST = "www1165.conoha.ne.jp"
FTP_USER = "ao@nihongo.site"
FTP_PASS = "highway#61"

# サーバー側のアップロード先（test のみ。本番ルートにはアップロードしない）
REMOTE_TEST_DIR = "/public_html/nihongo.site/test"

# 監視するファイル（test/ のみ）
WATCH_FILES = (
    "test/index.html",
    "test/style.css",
    "test/app.js",
)

BROWSER_KEYWORD = "nihongo.site/test"

# Brave などの強いキャッシュ対策（Conoha Apache / LiteSpeed 両対応）
HTACCESS_CONTENT = """
<IfModule mod_headers.c>
    Header always set Cache-Control "no-store, no-cache, must-revalidate, max-age=0"
    Header always set Pragma "no-cache"
    Header always set Expires "0"
    Header always unset ETag
</IfModule>
<IfModule mod_expires.c>
    ExpiresActive Off
</IfModule>
FileETag None
"""

last_mtimes = {file: 0 for file in WATCH_FILES}


def make_cache_bust_version():
    return time.strftime("%Y%m%d%H%M%S")


def prepare_index_html_for_upload(local_path, version):
    with open(local_path, "r", encoding="utf-8") as f:
        content = f.read()

    content = content.replace("__APP_BUILD__", version)
    content = re.sub(
        r'(href="style\.css)\?v=[^"]*"',
        rf'\1?v={version}"',
        content,
    )
    content = re.sub(
        r'(src="app\.js)\?v=[^"]*"',
        rf'\1?v={version}"',
        content,
    )
    return content.encode("utf-8")


def reload_browsers_in_background(keyword):
    """Chrome / Brave / Safari の対象タブを再読み込み"""
    browsers = (
        "Google Chrome",
        "Brave Browser",
        "Safari",
    )
    for browser_name in browsers:
        script = f'''
        tell application "{browser_name}"
            if (count of windows) > 0 then
                repeat with w in windows
                    repeat with t in tabs of w
                        if URL of t contains "{keyword}" then
                            tell t to reload
                        end if
                    end repeat
                end repeat
            end if
        end tell
        '''
        try:
            subprocess.run(["osascript", "-e", script], check=False)
        except Exception as e:
            print(f"ブラウザ更新エラー ({browser_name}): {e}")


def upload_batch(changed_files):
    version = make_cache_bust_version()
    upload_order = ("test/style.css", "test/app.js", "test/index.html")

    try:
        ftps = FTP_TLS()
        ftps.connect(FTP_HOST, 21, timeout=10)
        ftps.login(FTP_USER, FTP_PASS)
        ftps.prot_p()
        ftps.set_pasv(True)

        try:
            ftps.cwd(REMOTE_TEST_DIR)
        except Exception:
            parent = os.path.dirname(REMOTE_TEST_DIR)
            ftps.cwd(parent)
            folder_name = os.path.basename(REMOTE_TEST_DIR)
            try:
                ftps.mkd(folder_name)
            except Exception:
                pass
            ftps.cwd(REMOTE_TEST_DIR)

        htaccess_bytes = io.BytesIO(HTACCESS_CONTENT.strip().encode("utf-8"))
        ftps.storbinary("STOR .htaccess", htaccess_bytes)

        uploaded = []
        for local_file in upload_order:
            if not os.path.exists(local_file):
                continue

            filename = os.path.basename(local_file)
            if local_file.endswith("index.html"):
                payload = prepare_index_html_for_upload(local_file, version)
                ftps.storbinary(f"STOR {filename}", io.BytesIO(payload))
            else:
                with open(local_file, "rb") as f:
                    ftps.storbinary(f"STOR {filename}", f)
            uploaded.append(local_file)

        ftps.quit()

        changed_label = ", ".join(changed_files)
        uploaded_label = ", ".join(uploaded)
        print(
            f"[{time.strftime('%H:%M:%S')}] 送信完了 (v={version})"
            f"\n  変更: {changed_label}"
            f"\n  送信: {uploaded_label}"
            f"\n  先: test/ のみ（本番ルートには送信しません）"
        )

        time.sleep(0.5)
        reload_browsers_in_background(BROWSER_KEYWORD)

    except Exception as e:
        print(f"エラー発生: {e}")


print("ファイルの監視を開始しました。（test/ のみ・本番ルートは対象外 / 終了: Ctrl + C）")

for f in WATCH_FILES:
    if os.path.exists(f):
        print(f"〇 監視対象を確認: {f}")
        last_mtimes[f] = os.path.getmtime(f)
    else:
        print(f"× ファイルが見つかりません: {f}")

print("起動時に test/ へ一括送信します...")
if any(os.path.exists(f) for f in WATCH_FILES):
    upload_batch(["起動時一括"])

while True:
    try:
        changed = []
        for target_file in WATCH_FILES:
            if not os.path.exists(target_file):
                continue
            current_mtime = os.path.getmtime(target_file)
            if current_mtime != last_mtimes[target_file]:
                last_mtimes[target_file] = current_mtime
                changed.append(target_file)

        if changed:
            upload_batch(changed)

        time.sleep(1)
    except KeyboardInterrupt:
        print("\n監視を終了しました。")
        break
