import io
import os
import subprocess
import time
from ftplib import FTP_TLS

# 設定情報
FTP_HOST = "www1165.conoha.ne.jp"
FTP_USER = "ao@nihongo.site"
FTP_PASS = "highway#61"
REMOTE_BASE_DIR = "/public_html/nihongo.site"

# 監視するファイルとURLの設定
WATCH_FILES = {
    "index.html": {
        "remote_dir": REMOTE_BASE_DIR,
        "url": "https://nihongo.site/",
        "keyword": "nihongo.site",
    },
    "test/index.html": {
        "remote_dir": REMOTE_BASE_DIR + "/test",
        "url": "https://nihongo.site/test/",
        "keyword": "nihongo.site/test",
    },
}

# サーバー側でキャッシュを無効化する設定
HTACCESS_CONTENT = """
<IfModule mod_headers.c>
    Header set Cache-Control "no-store, no-cache, must-revalidate, max-age=0"
    Header set Pragma "no-cache"
    Header set Expires "0"
</IfModule>
"""

last_mtimes = {file: 0 for file in WATCH_FILES}


def reload_browser_in_background(target_url, keyword):
    """作業中の画面やタブを切り替えずに、裏側で対象タブのみを再読み込みする"""
    cache_busting_url = (
        f"{target_url}?v={int(time.time())}"
        if "?" not in target_url
        else f"{target_url}&v={int(time.time())}"
    )

    chrome_script = f"""
    tell application "Google Chrome"
        set targetUrl to "{cache_busting_url}"
        if (count of windows) > 0 then
            repeat with w in windows
                repeat with t in tabs of w
                    if URL of t contains "{keyword}" then
                        set URL of t to targetUrl
                        return
                    end if
                end repeat
            end repeat
        end if
    end tell
    """
    try:
        subprocess.run(["osascript", "-e", chrome_script], check=False)
    except Exception as e:
        print(f"ブラウザ更新エラー: {e}")


def upload(local_file, config):
    remote_dir = config["remote_dir"]
    target_url = config["url"]
    keyword = config["keyword"]

    try:
        ftps = FTP_TLS()
        ftps.connect(FTP_HOST, 21, timeout=10)
        ftps.login(FTP_USER, FTP_PASS)
        ftps.prot_p()
        ftps.set_pasv(True)

        # 送信先フォルダへ移動（なければ作成）
        try:
            ftps.cwd(remote_dir)
        except Exception:
            ftps.cwd(REMOTE_BASE_DIR)
            folder_name = remote_dir.split("/")[-1]
            try:
                ftps.mkd(folder_name)
            except Exception:
                pass
            ftps.cwd(remote_dir)

        # 1. サーバーキャッシュ無効化ファイル（.htaccess）を送信
        htaccess_bytes = io.BytesIO(HTACCESS_CONTENT.strip().encode("utf-8"))
        ftps.storbinary("STOR .htaccess", htaccess_bytes)

        # 2. HTMLファイルを送信
        filename = os.path.basename(local_file)
        with open(local_file, "rb") as f:
            ftps.storbinary(f"STOR {filename}", f)

        ftps.quit()

        print(
            f"[{time.strftime('%H:%M:%S')}] 送信完了: {local_file} ➞ バックグラウンドで更新しました"
        )

        time.sleep(0.5)
        reload_browser_in_background(target_url, keyword)

    except Exception as e:
        print(f"エラー発生 ({local_file}): {e}")


print("ファイルの監視を開始しました。（終了: Ctrl + C）")

while True:
    try:
        for target_file, config in WATCH_FILES.items():
            if os.path.exists(target_file):
                current_mtime = os.path.getmtime(target_file)
                if current_mtime != last_mtimes[target_file]:
                    last_mtimes[target_file] = current_mtime
                    upload(target_file, config)
        time.sleep(1)
    except KeyboardInterrupt:
        print("\n監視を終了しました。")
        break
