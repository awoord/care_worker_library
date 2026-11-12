#!/usr/bin/env python3
"""付録（https://nihongo.site/kaigo/kakomon/appendix/）だけ生成・FTP。

使い方:
  python3 work/deploy_appendix_site.py
  python3 work/deploy_appendix_site.py --build-only
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from deploy_themes import deploy_appendix_site  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="付録サイトだけデプロイ")
    parser.add_argument(
        "--build-only",
        action="store_true",
        help="FTPせずローカル生成のみ",
    )
    args = parser.parse_args()
    try:
        deploy_appendix_site(build_only=args.build_only)
    except Exception as err:
        print(str(err), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
