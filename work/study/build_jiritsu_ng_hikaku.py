#!/usr/bin/env python3
"""利用者本位・自立支援 不適切マップを HTML / JSON 化する。

2列: カテゴリ｜番号＋文言＋【回-番号】
句点なし。過去問はクリック参照（app.js）。適切マップと同レイアウト。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_hikaku import (  # noqa: E402
    build_questions_json,
    md_inline_to_html,
)
from jiritsu_qb import (  # noqa: E402
    entries_with_qb_more_html,
    load_qb_qids,
)

STUDY_DIR = ROOT / "work" / "study"
THEMES_DIR = ROOT / "kaigo" / "kakomon" / "themes"
DATA_DIR = THEMES_DIR / "data"
MD_PATH = STUDY_DIR / "利用者本位・自立支援_不適切マップ.md"
HTML_NAME = "hikaku-jiritsu-ng.html"
JSON_NAME = "hikaku-jiritsu-ng.json"
TITLE = "国試で✕になる選択肢"
JSON_URL = f"data/{JSON_NAME}"

RE_SUMMARY_ROW = re.compile(
    r"^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(\d+)\s*\|$"
)
RE_SECTION = re.compile(r"^##\s+(\d+)\s*[　\s]+(.+?)\s*$")
RE_ITEM = re.compile(r"^-\s*【\s*(\d+)\s*-\s*(\d+)\s*｜([^】]+)】\s*$")
RE_WRONG = re.compile(r"^\s+誤り：(.+)\s*$")


def strip_period(text: str) -> str:
    t = (text or "").strip()
    while t.endswith("。") or t.endswith("．"):
        t = t[:-1].rstrip()
    return t


def parse_futekisetsu_map(md: str) -> list[dict]:
    summaries: dict[int, dict] = {}
    in_summary = False
    for line in md.splitlines():
        if line.startswith("## カテゴリ要約"):
            in_summary = True
            continue
        if in_summary:
            if line.startswith("## "):
                break
            m = RE_SUMMARY_ROW.match(line.strip())
            if m:
                summaries[int(m.group(1))] = {
                    "title": m.group(2).strip(),
                    "summary": m.group(3).strip(),
                }

    sections: list[dict] = []
    current: dict | None = None
    pending: dict | None = None
    for line in md.splitlines():
        sec = RE_SECTION.match(line)
        if sec:
            num = int(sec.group(1))
            title = sec.group(2).strip()
            meta = summaries.get(num, {})
            current = {
                "num": num,
                "title": meta.get("title") or title,
                "summary": strip_period(meta.get("summary") or ""),
                "entries": [],
            }
            sections.append(current)
            pending = None
            continue
        if current is None:
            continue
        item = RE_ITEM.match(line)
        if item:
            pending = {"qid": f"{int(item.group(1))}-{int(item.group(2))}"}
            continue
        wr = RE_WRONG.match(line)
        if wr and pending:
            current["entries"].append(
                {"qid": pending["qid"], "text": strip_period(wr.group(1))}
            )
            pending = None
    return sections


def entry_line_html(cat_num: int, idx: int, entry: dict) -> str:
    a, b = entry["qid"].split("-")
    label = f"{cat_num}-{idx}"
    qid_btn = (
        f'<button type="button" class="hikaku-qid hikaku-qid--muted" '
        f'data-round="{a}" data-number="{b}">'
        f"【{a}-{b}】</button>"
    )
    return (
        f'<span class="jiritsu-ng">'
        f'<span class="jiritsu-idx">{label}</span> '
        f'<span class="jiritsu-text">{md_inline_to_html(entry["text"])}</span> '
        f"{qid_btn}"
        f"</span>"
    )


def wrongs_cell_to_html(sec: dict, qb_ids: set[str]) -> str:
    lead = ""
    if sec["summary"]:
        lead = (
            f'<span class="jiritsu-ng-lead">{md_inline_to_html(sec["summary"])}</span>'
        )
    return entries_with_qb_more_html(
        sec, qb_ids=qb_ids, entry_line_html=entry_line_html, lead_html=lead
    )


def table_to_html(sections: list[dict], qb_ids: set[str]) -> str:
    ths = [
        '<th scope="col" class="hikaku-corner">カテゴリ</th>',
        '<th scope="col" class="jiritsu-col-ng">✕になる言葉</th>',
    ]
    trs: list[str] = []
    for sec in sections:
        trs.append(
            "<tr>"
            f'<th scope="row" class="hikaku-sticky-col">'
            f"<strong>{md_inline_to_html(sec['title'])}</strong></th>"
            f'<td class="jiritsu-fact jiritsu-col-ng">'
            f"{wrongs_cell_to_html(sec, qb_ids)}</td>"
            "</tr>"
        )
    return (
        '<div class="hikaku-table-wrap">'
        '<table class="hikaku-table hikaku-table--jiritsu hikaku-table--jiritsu-ng">'
        f"<thead><tr>{''.join(ths)}</tr></thead>"
        f"<tbody>{''.join(trs)}</tbody>"
        "</table></div>"
    )


def build_html(table_html: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="#F7F6F3">
  <title>{TITLE}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@400;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="style.css?v=__APP_BUILD__">
  <link rel="stylesheet" href="themes.css?v=__APP_BUILD__">
</head>
<body class="hikaku-page hikaku-page--futekisetsu" data-hikaku-json="{JSON_URL}">
  <header class="page-header">
    <div class="site-bar">
      <button type="button" class="nav-toggle" aria-expanded="false" aria-controls="siteNav" aria-label="メニュー">
        <span class="nav-toggle-icon" aria-hidden="true"><span></span><span></span><span></span></span>
      </button>
      <p class="site-brand" aria-label="介護福祉士国家試験対策">介護福祉士国家試験対策</p>
      <nav id="siteNav" class="site-nav" aria-label="サイト内移動">
        <a class="site-nav-link" href="/kaigo/kakomon/themes/view.html?t=b146eeffd742">テキスト</a>
        <a class="site-nav-link" href="/kaigo/kakomon/bank/">カコモン・バンク</a>
        <a class="site-nav-link is-current" href="/kaigo/kakomon/themes/" aria-current="page">テーマ</a>
        <a class="site-nav-link" href="/kaigo/kakomon/type/">出題タイプ</a>
        <a class="site-nav-link" href="/kaigo/kakomon/challenge/">年度タイプ</a>
        <a class="site-nav-link" href="/kaigo/kakomon/appendix/">付録</a>
      </nav>
    </div>
    <h1>{TITLE}</h1>
</header>

  <main class="hikaku-main">
{table_html}
  </main>

  <div id="hikakuModal" class="hikaku-modal" hidden>
    <div class="hikaku-modal-backdrop" data-hikaku-close></div>
    <div class="hikaku-modal-panel" role="dialog" aria-modal="true" aria-labelledby="hikakuModalTitle">
      <h2 id="hikakuModalTitle" class="hikaku-modal-title">問題</h2>
      <button type="button" class="hikaku-modal-close" data-hikaku-close aria-label="閉じる">×</button>
      <div id="hikakuModalBody" class="hikaku-modal-body"></div>
    </div>
  </div>

  <button type="button" id="backToTop" class="back-to-top hikaku-screen-only" aria-label="一番上に戻る" hidden>
    <span aria-hidden="true">⌃</span>
  </button>
  <script src="app.js?v=__APP_BUILD__"></script>
</body>
</html>
"""


def collect_qids(sections: list[dict]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for sec in sections:
        for e in sec["entries"]:
            qid = e["qid"]
            if qid not in seen:
                seen.add(qid)
                ordered.append(qid)
    return ordered


def main() -> None:
    import build_hikaku as hikaku_mod

    old_title = hikaku_mod.TITLE
    hikaku_mod.TITLE = TITLE
    try:
        md = MD_PATH.read_text(encoding="utf-8")
        sections = parse_futekisetsu_map(md)
        if not sections:
            raise SystemExit(f"カテゴリが読めません: {MD_PATH}")
        qb_ids = load_qb_qids()
        qids = collect_qids(sections)
        payload = build_questions_json(qids)
        payload["title"] = TITLE
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        json_path = DATA_DIR / JSON_NAME
        json_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        html = build_html(table_to_html(sections, qb_ids))
        out = THEMES_DIR / HTML_NAME
        out.write_text(html, encoding="utf-8")
        n_wrong = sum(len(s["entries"]) for s in sections)
        miss = payload.get("missing") or []
        print(
            f"自立支援不適切マップ HTML: {out}"
            f"（{len(sections)} カテゴリ / 不適切 {n_wrong}）"
        )
        print(f"自立支援不適切マップ JSON: {json_path}（{len(qids)} 問, 欠落 {len(miss)}）")
        if miss:
            print("  欠落: " + ", ".join(miss))
    finally:
        hikaku_mod.TITLE = old_title


if __name__ == "__main__":
    main()
