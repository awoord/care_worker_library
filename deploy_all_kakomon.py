#!/usr/bin/env python3
"""介護福祉士過去問まわりを一括デプロイする。

対象:
  1. kaigo/kakomon/（番号検索・年度タイプ・用語）
  2. themes / reference / appendix / bank

使い方:
  python3 deploy_all_kakomon.py
  python3 deploy_all_kakomon.py --build-only
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
KAKOMON_DEPLOY = ROOT / "kaigo" / "kakomon" / "deploy_kakomon.py"
THEMES_DEPLOY = ROOT / "work" / "deploy_themes.py"


def run_step(label: str, script: Path, extra_args: list[str]) -> int:
    if not script.is_file():
        print(f"見つかりません: {script}", file=sys.stderr)
        return 1
    cmd = [sys.executable, str(script), *extra_args]
    print(f"\n===== {label} =====")
    print(" ".join(cmd))
    completed = subprocess.run(cmd, cwd=str(ROOT))
    if completed.returncode != 0:
        print(f"失敗: {label}（exit {completed.returncode}）", file=sys.stderr)
    return completed.returncode


def main() -> int:
    parser = argparse.ArgumentParser(
        description="過去問（kakomon + テーマ系）を一括デプロイ"
    )
    parser.add_argument(
        "--build-only",
        action="store_true",
        help="FTPせず生成だけ（両スクリプトへ渡す）",
    )
    args = parser.parse_args()
    extra = ["--build-only"] if args.build_only else []

    # questions.json を先に更新してからテーマ系が参照する
    code = run_step("kakomon", KAKOMON_DEPLOY, extra)
    if code != 0:
        return code
    code = run_step("themes / reference / appendix / parts", THEMES_DEPLOY, extra)
    if code != 0:
        return code

    print("\n一括デプロイ完了")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
