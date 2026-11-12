#!/usr/bin/env python3
"""テーマ＋付録を並列デプロイする。

- 生成は直列（イラスト問題.txt など共通書き込みの競合を避ける）
- FTP アップロードだけ並列

使い方:
  python3 work/deploy_themes_appendix.py
  python3 work/deploy_themes_appendix.py --build-only
"""

from __future__ import annotations

import argparse
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from deploy_themes import (  # noqa: E402
    build_appendix_site,
    build_themes_site,
    upload_appendix_site,
    upload_themes_site,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="テーマ＋付録を並列デプロイ")
    parser.add_argument(
        "--build-only",
        action="store_true",
        help="FTPせずローカル生成のみ",
    )
    args = parser.parse_args()
    try:
        print("=== テーマ生成 ===")
        build_themes_site()
        print("=== 付録生成 ===")
        build_appendix_site()
        if args.build_only:
            return 0

        print("=== FTP 並列アップロード ===")
        errors: list[str] = []
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = {
                pool.submit(upload_themes_site): "テーマ",
                pool.submit(upload_appendix_site): "付録",
            }
            for fut in as_completed(futures):
                label = futures[fut]
                try:
                    version = fut.result()
                    print(f"[{label}] アップロード完了 (_cb={version})")
                except Exception as err:
                    errors.append(f"{label}: {err}")
                    print(f"[{label}] 失敗: {err}", file=sys.stderr)
        if errors:
            return 1
    except Exception as err:
        print(str(err), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
