#!/usr/bin/env python3
"""ICF（国際生活機能分類）攻略マップ（項目｜具体例｜過去問）を HTML / JSON 化する。"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_hikaku import (  # noqa: E402
    RE_QID,
    build_questions_json,
    collect_qids,
    extract_comparison_table,
    md_inline_to_html,
    qid_sort_key,
)

STUDY_DIR = ROOT / "work" / "study"
THEMES_DIR = ROOT / "kaigo" / "kakomon" / "themes"
DATA_DIR = THEMES_DIR / "data"
MD_PATH = STUDY_DIR / "ICF_攻略マップ.md"
HTML_NAME = "hikaku-icf.html"
JSON_NAME = "hikaku-icf.json"
TITLE = "ICF（国際生活機能分類）攻略マップ"
JSON_URL = f"data/{JSON_NAME}"


def qids_cell_to_html(text: str) -> str:
    matches = list(RE_QID.finditer(text))
    if not matches:
        return md_inline_to_html(text)
    seen: set[tuple[str, str]] = set()
    ordered: list[re.Match[str]] = []
    for m in sorted(matches, key=qid_sort_key):
        key = (m.group(1), m.group(2))
        if key in seen:
            continue
        seen.add(key)
        ordered.append(m)
    buttons: list[str] = []
    for m in ordered:
        buttons.append(
            f'<button type="button" class="hikaku-qid" '
            f'data-round="{m.group(1)}" data-number="{m.group(2)}">'
            f"【{m.group(1)}-{m.group(2)}】</button>"
        )
    return "".join(buttons)


def fact_cell_to_html(text: str) -> str:
    """1行目は lead、以降の・行は適切マップと同様のブロック行間にする。"""
    html = md_inline_to_html(text)
    parts = [p.strip() for p in re.split(r"<br\s*/?>", html) if p.strip()]
    if not parts:
        return html
    chunks = [f'<span class="icf-lead">{parts[0]}</span>']
    for part in parts[1:]:
        body = re.sub(r"^・\s*", "", part)
        chunks.append(f'<span class="icf-ex">・{body}</span>')
    return "".join(chunks)


def idea_cell_to_html(text: str) -> str:
    """項目名は太字、括弧の区分名は薄い補足にする。"""
    html = md_inline_to_html(text)
    html = re.sub(
        r"(<br\s*/?>)\s*(（[^）]+）)",
        r'\1<span class="icf-group">\2</span>',
        html,
        count=1,
    )
    return html


def table_to_html(rows: list[list[str]]) -> str:
    header, body = rows[0], rows[1:]
    ths = [
        f'<th scope="col" class="hikaku-corner">{md_inline_to_html(header[0])}</th>',
        f'<th scope="col">{md_inline_to_html(header[1])}</th>',
        f'<th scope="col">{md_inline_to_html(header[2])}</th>',
    ]
    trs: list[str] = []
    for row in body:
        while len(row) < 3:
            row.append("")
        idea, fact, qids = row[0], row[1], row[2]
        if not idea.strip() and not fact.strip() and not qids.strip():
            continue
        trs.append(
            "<tr>"
            f'<th scope="row" class="hikaku-sticky-col">{idea_cell_to_html(idea)}</th>'
            f'<td class="icf-fact">{fact_cell_to_html(fact)}</td>'
            f"<td>{qids_cell_to_html(qids)}</td>"
            "</tr>"
        )
    return (
        '<div class="hikaku-table-wrap">'
        '<table class="hikaku-table hikaku-table--icf">'
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
<body class="hikaku-page" data-hikaku-json="{JSON_URL}">
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


def main() -> None:
    import build_hikaku as hikaku_mod

    old_title = hikaku_mod.TITLE
    hikaku_mod.TITLE = TITLE
    try:
        md = MD_PATH.read_text(encoding="utf-8")
        rows = extract_comparison_table(md)
        qids = collect_qids(rows)
        payload = build_questions_json(qids)
        payload["title"] = TITLE
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        json_path = DATA_DIR / JSON_NAME
        json_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        html = build_html(table_to_html(rows))
        out = THEMES_DIR / HTML_NAME
        out.write_text(html, encoding="utf-8")
        miss = payload.get("missing") or []
        print(f"ICF攻略 HTML: {out}（{len(rows) - 1} 行）")
        print(f"ICF攻略 JSON: {json_path}（{len(qids)} 問, 欠落 {len(miss)}）")
        if miss:
            print("  欠落: " + ", ".join(miss))
    finally:
        hikaku_mod.TITLE = old_title


if __name__ == "__main__":
    main()
