#!/usr/bin/env python3
"""互換ラッパー: 本体は deploy/auto_upload.py"""
from pathlib import Path
import runpy

runpy.run_path(str(Path(__file__).resolve().parent / "deploy" / "auto_upload.py"), run_name="__main__")
