#!/usr/bin/env python3
"""互換ラッパー: 本体は deploy/deploy_prod.py"""
from pathlib import Path
import runpy

runpy.run_path(str(Path(__file__).resolve().parent / "deploy" / "deploy_prod.py"), run_name="__main__")
