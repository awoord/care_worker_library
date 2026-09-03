import io
import os
import re
import subprocess
import sys
import time
from ftplib import FTP_TLS
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

# 設定情報
FTP_HOST = "www1165.conoha.ne.jp"
FTP_USER = "ao@nihongo.site"
FTP_PASS = "highway#61"

# サーバー側のアップロード先（test のみ。本番ルートにはアップロードしない）
REMOTE_TEST_DIR = "/public_html/nihongo.site/test"

# 監視するファイル（index.html は送信時に自動生成。ローカルは __APP_BUILD__ テンプレートのまま）
WATCH_FILES = (
    "test/style.css",
    "test/app.js",
)

LOCAL_INDEX = "test/index.html"
BROWSER_KEYWORD = "nihongo.site/test"

# Brave などの強いキャッシュ対策（Conoha Apache / LiteSpeed 両対応）
HTACCESS_CONTENT = """
<IfModule mod_headers.c>
    <FilesMatch "\\.(html|css|js)$">
        Header always set Cache-Control "no-store, no-cache, must-revalidate, max-age=0"
        Header always set Pragma "no-cache"
        Header always set Expires "0"
    </FilesMatch>
    <Files "index.html">
        Header always set Clear-Site-Data "\\"cache\\""
    </Files>
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


def prepare_index_html_content(content, version):
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


def read_index_html(local_path):
    with open(local_path, "r", encoding="utf-8") as f:
        return f.read()


def make_cache_bust_url(url, bust):
    parsed = urlparse(url)
    query = parse_qs(parsed.query, keep_blank_values=True)
    query["_cb"] = [bust]
    flat_query = []
    for key, values in query.items():
        for value in values:
            flat_query.append((key, value))
    return urlunparse(parsed._replace(query=urlencode(flat_query)))


def reload_browsers_in_background(keyword, bust):
    """対象タブを _cb 付き URL に差し替えて再読み込み"""
    for browser_name in ("Google Chrome", "Brave Browser", "Safari"):
        list_script = f"""
        tell application "System Events"
            if not (exists process "{browser_name}") then
                return ""
            end if
        end tell
        tell application "{browser_name}"
            set out to ""
            if (count of windows) > 0 then
                repeat with w in windows
                    repeat with t in tabs of w
                        set tabUrl to URL of t
                        if tabUrl contains "{keyword}" then
                            set out to out & tabUrl & linefeed
                        end if
                    end repeat
                end repeat
            end if
            return out
        end tell
        """
        try:
            listed = subprocess.run(
                ["osascript", "-e", list_script],
                check=False,
                capture_output=True,
                text=True,
            )
            if listed.returncode != 0:
                continue
            for tab_url in listed.stdout.splitlines():
                tab_url = tab_url.strip()
                if not tab_url or keyword not in tab_url:
                    continue
                reload_url = make_cache_bust_url(tab_url, bust)
                escaped_tab_url = tab_url.replace('"', '\\"')
                escaped_reload_url = reload_url.replace('"', '\\"')
                tab_script = f"""
                tell application "{browser_name}"
                    repeat with w in windows
                        repeat with t in tabs of w
                            if URL of t is equal to "{escaped_tab_url}" then
                                set URL of t to "{escaped_reload_url}"
                            end if
                        end repeat
                    end repeat
                end tell
                """
                subprocess.run(
                    ["osascript", "-e", tab_script],
                    check=False,
                    capture_output=True,
                    text=True,
                )
        except Exception as e:
            print(f"ブラウザ更新エラー ({browser_name}): {e}")


def upload_batch(changed_files):
    version = make_cache_bust_version()
    bust = str(int(time.time() * 1000))
    upload_order = ("test/style.css", "test/app.js", LOCAL_INDEX)

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
                index_payload = prepare_index_html_content(
                    read_index_html(local_file),
                    version,
                ).encode("utf-8")
                ftps.storbinary(f"STOR {filename}", io.BytesIO(index_payload))
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

        time.sleep(1.0)
        reload_browsers_in_background(BROWSER_KEYWORD, bust)

    except Exception as e:
        print(f"エラー発生: {e}")


def run_watch_loop():
    print(
        "ファイルの監視を開始しました。（test/ のみ・本番ルートは対象外 / 終了: Ctrl + C）"
    )

    for f in WATCH_FILES:
        if os.path.exists(f):
            print(f"〇 監視対象を確認: {f}")
            last_mtimes[f] = os.path.getmtime(f)
        else:
            print(f"× ファイルが見つかりません: {f}")

    if os.path.exists(LOCAL_INDEX):
        print(f"〇 送信テンプレート: {LOCAL_INDEX}（監視対象外）")
    else:
        print(f"× 送信テンプレートが見つかりません: {LOCAL_INDEX}")

    print("起動時に test/ へ一括送信します...")
    if any(os.path.exists(f) for f in WATCH_FILES) or os.path.exists(LOCAL_INDEX):
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


if __name__ == "__main__":
    run_watch_loop()
