#!/usr/bin/env python3
"""利用者本位・自立支援マップを HTML / JSON 化する。

- hikaku-jiritsu.html … ◯の言い回し一覧（✕と同形式）
- hikaku-jiritsu-kata.html … ◯型と✕型の比較表のみ（↔）
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
APPENDIX_DIR = ROOT / "kaigo" / "kakomon" / "appendix"
DATA_DIR = THEMES_DIR / "data"
APPENDIX_DATA_DIR = APPENDIX_DIR / "data"
MD_PATH = STUDY_DIR / "利用者本位・自立支援_適切マップ.md"
NG_MD_PATH = STUDY_DIR / "利用者本位・自立支援_不適切マップ.md"

HTML_NAME = "hikaku-jiritsu.html"
KATA_HTML_NAME = "hikaku-jiritsu-kata.html"
VS_HTML_NAME = "hikaku-jiritsu-vs.html"
CARDS_HTML_NAME = "hikaku-jiritsu-cards.html"
JSON_NAME = "hikaku-jiritsu.json"
KATA_JSON_NAME = "hikaku-jiritsu-kata.json"
VS_JSON_NAME = "hikaku-jiritsu-vs.json"
CARDS_JSON_NAME = "hikaku-jiritsu-cards.json"
TITLE = "国試で◯になる選択肢"
KATA_TITLE = "適切と不適切の型"
VS_TITLE = "国試を解くための比較表"
CARDS_TITLE = "言い回しカード"
JSON_URL = f"data/{JSON_NAME}"
KATA_JSON_URL = f"data/{KATA_JSON_NAME}"
VS_JSON_URL = f"data/{VS_JSON_NAME}"
CARDS_JSON_URL = f"data/{CARDS_JSON_NAME}"

# ↔比較表: ◯番号 → ✕番号（5カテゴリすべて対あり）
KATA_OK_TO_NG = {
    1: 1,  # 利用者中心 ↔ 介護福祉職・他者が中心
    2: 2,  # 自立支援 ↔ 自立を妨げる行為
    3: 3,  # コンプライアンス ↔ 越権行為
    4: 4,  # コミュニケーション ↔ 不適切なコミュニケーション
    5: 5,  # チームアプローチ ↔ 誤ったチームアプローチ
}

# カード用: 対の◯✕を同じカテゴリにまとめ、判定フィルタで出し分ける
CARD_CATEGORY_BY_PAIR = {
    1: "利用者中心",  # ◯利用者中心 + ✕介護福祉職・他者が中心
    2: "自立支援",  # ◯自立支援 + ✕自立を妨げる行為
    3: "コンプライアンス",  # ◯コンプライアンス + ✕越権行為
    4: "コミュニケーション",  # ◯コミュニケーション + ✕不適切なコミュニケーション
    5: "チームアプローチ",  # ◯チームアプローチ + ✕誤ったチームアプローチ
}

RE_SUMMARY_ROW = re.compile(
    r"^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(\d+)\s*\|$"
)
RE_SECTION = re.compile(r"^##\s+(\d+)\s*[　\s]+(.+?)\s*$")
RE_ITEM = re.compile(r"^-\s*(?:😎\s*)?【\s*(\d+)\s*-\s*(\d+)\s*｜([^】]+)】\s*$")
RE_CORRECT = re.compile(r"^\s+正解：(😎\s*)?(.+)\s*$")


def strip_period(text: str) -> str:
    t = (text or "").strip()
    while t.endswith("。") or t.endswith("．"):
        t = t[:-1].rstrip()
    return t


def parse_summary_table(md: str) -> dict[int, dict]:
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
                    "summary": strip_period(m.group(3).strip()),
                }
    return summaries


def parse_seikai_map(md: str) -> list[dict]:
    summaries = parse_summary_table(md)
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
                "summary": meta.get("summary") or "",
                "entries": [],
            }
            sections.append(current)
            pending = None
            continue
        if current is None:
            continue
        item = RE_ITEM.match(line)
        if item:
            meta = item.group(3)
            parts = [p.strip() for p in meta.split("｜")]
            red = any(p == "拡張" for p in parts)
            pending = {
                "qid": f"{int(item.group(1))}-{int(item.group(2))}",
                "red": red,
                "new": line.lstrip().startswith("- 😎")
                or line.lstrip().startswith("-😎"),
            }
            continue
        ans = RE_CORRECT.match(line)
        if ans and pending:
            mark = "😎" if (ans.group(1) or pending.get("new")) else ""
            text = strip_period(ans.group(2))
            if mark and not text.startswith("😎"):
                text = mark + text
            current["entries"].append(
                {"qid": pending["qid"], "text": text, "red": pending["red"]}
            )
            pending = None
    return sections


def page_shell(
    title: str,
    body_class: str,
    json_url: str,
    main_html: str,
    *,
    extra_body_attrs: str = "",
    nav_current: str = "themes",
) -> str:
    extra = f" {extra_body_attrs.strip()}" if extra_body_attrs.strip() else ""

    def nav_link(key: str, href: str, label: str) -> str:
        if key == nav_current:
            return (
                f'<a class="site-nav-link is-current" href="{href}" '
                f'aria-current="page">{label}</a>'
            )
        return f'<a class="site-nav-link" href="{href}">{label}</a>'

    nav_html = "\n        ".join(
        [
            nav_link(
                "text",
                "/kaigo/kakomon/themes/view.html?t=b146eeffd742",
                "テキスト",
            ),
            nav_link("bank", "/kaigo/kakomon/bank/", "カコモン・バンク"),
            nav_link("themes", "/kaigo/kakomon/themes/", "テーマ"),
            nav_link("type", "/kaigo/kakomon/type/", "出題タイプ"),
            nav_link("challenge", "/kaigo/kakomon/challenge/", "年度タイプ"),
            nav_link("appendix", "/kaigo/kakomon/appendix/", "付録"),
        ]
    )
    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="#F7F6F3">
  <title>{title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@400;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="style.css?v=__APP_BUILD__">
  <link rel="stylesheet" href="themes.css?v=__APP_BUILD__">
</head>
<body class="{body_class}" data-hikaku-json="{json_url}"{extra}>
  <header class="page-header">
    <div class="site-bar">
      <button type="button" class="nav-toggle" aria-expanded="false" aria-controls="siteNav" aria-label="メニュー">
        <span class="nav-toggle-icon" aria-hidden="true"><span></span><span></span><span></span></span>
      </button>
      <p class="site-brand" aria-label="介護福祉士国家試験対策">介護福祉士国家試験対策</p>
      <nav id="siteNav" class="site-nav" aria-label="サイト内移動">
        {nav_html}
      </nav>
    </div>
    <h1>{title}</h1>
</header>

  <main class="hikaku-main">
{main_html}
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


def entry_line_html(cat_num: int, idx: int, entry: dict) -> str:
    a, b = entry["qid"].split("-")
    label = f"{cat_num}-{idx}"
    qid_btn = (
        f'<button type="button" class="hikaku-qid hikaku-qid--muted" '
        f'data-round="{a}" data-number="{b}">'
        f"【{a}-{b}】</button>"
    )
    return (
        f'<span class="jiritsu-ok">'
        f'<span class="jiritsu-idx">{label}</span> '
        f'<span class="jiritsu-text">{md_inline_to_html(entry["text"])}</span> '
        f"{qid_btn}"
        f"</span>"
    )


def corrects_cell_to_html(sec: dict, qb_ids: set[str]) -> str:
    lead = ""
    if sec["summary"]:
        lead = f'<span class="jiritsu-lead">{md_inline_to_html(sec["summary"])}</span>'
    return entries_with_qb_more_html(
        sec, qb_ids=qb_ids, entry_line_html=entry_line_html, lead_html=lead
    )


def seikai_table_html(sections: list[dict], qb_ids: set[str]) -> str:
    ths = [
        '<th scope="col" class="hikaku-corner">カテゴリ</th>',
        '<th scope="col" class="jiritsu-col-ok">◯になる言葉</th>',
    ]
    trs: list[str] = []
    for sec in sections:
        trs.append(
            "<tr>"
            f'<th scope="row" class="hikaku-sticky-col">'
            f"<strong>{md_inline_to_html(sec['title'])}</strong></th>"
            f'<td class="jiritsu-fact jiritsu-col-ok">'
            f"{corrects_cell_to_html(sec, qb_ids)}</td>"
            "</tr>"
        )
    return (
        '<div class="hikaku-table-wrap">'
        '<table class="hikaku-table hikaku-table--jiritsu hikaku-table--jiritsu-seikai">'
        f"<thead><tr>{''.join(ths)}</tr></thead>"
        f"<tbody>{''.join(trs)}</tbody>"
        "</table></div>"
    )


def ng_entry_line_html(cat_num: int, idx: int, entry: dict) -> str:
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


def vs_column_html(
    sec: dict | None,
    *,
    qb_ids: set[str],
    kind: str,
) -> str:
    if not sec:
        return (
            f'<p class="jiritsu-vs-empty">この側に対応する言い回しはありません。</p>'
        )
    line_fn = entry_line_html if kind == "ok" else ng_entry_line_html
    return entries_with_qb_more_html(
        sec, qb_ids=qb_ids, entry_line_html=line_fn, lead_html=""
    )


def vs_sections_html(
    ok_secs: list[dict], ng_secs: list[dict], qb_ids: set[str]
) -> str:
    ok_by = {s["num"]: s for s in ok_secs}
    ng_by = {s["num"]: s for s in ng_secs}
    blocks: list[str] = []
    def col_title(kind: str, title: str, note: str = "") -> str:
        mark = "◯" if kind == "ok" else "✕"
        note_html = (
            f'<span class="jiritsu-vs-solo-note">{note}</span>' if note else ""
        )
        return (
            f'<h2 class="jiritsu-vs-col-title jiritsu-vs-col-title--{kind}">'
            f'<span class="jiritsu-kata-mark jiritsu-kata-mark--{kind}" '
            f'aria-hidden="true">{mark}</span>'
            f"{md_inline_to_html(title)}"
            f"{note_html}</h2>"
        )

    used_ng: set[int] = set()
    for ok_num, ng_num in KATA_OK_TO_NG.items():
        ok = ok_by.get(ok_num)
        if ok is None:
            continue
        ng = ng_by.get(ng_num)
        if ng is not None:
            used_ng.add(ng_num)
        ng_title = (ng or {}).get("title") or ""
        cols = (
            f'<div class="jiritsu-vs-cols">'
            f'<div class="jiritsu-vs-col jiritsu-vs-col--ok">'
            f'{col_title("ok", ok["title"])}'
            f'{vs_column_html(ok, qb_ids=qb_ids, kind="ok")}'
            f"</div>"
            f'<div class="jiritsu-vs-col jiritsu-vs-col--ng">'
            f'{col_title("ng", ng_title)}'
            f'{vs_column_html(ng, qb_ids=qb_ids, kind="ng")}'
            f"</div>"
            f"</div>"
        )
        blocks.append(
            f'<section class="jiritsu-vs-section" data-ok="{ok_num}" data-ng="{ng_num}">'
            f"{cols}</section>"
        )

    # 対のない◯カテゴリ（記録・個人情報・権利など）
    paired_ok = set(KATA_OK_TO_NG.keys())
    for ok in ok_secs:
        if ok["num"] in paired_ok:
            continue
        cols = (
            f'<div class="jiritsu-vs-cols jiritsu-vs-cols--solo">'
            f'<div class="jiritsu-vs-col jiritsu-vs-col--ok">'
            f'{col_title("ok", ok["title"], "（対応する✕カテゴリなし）")}'
            f'{vs_column_html(ok, qb_ids=qb_ids, kind="ok")}'
            f"</div></div>"
        )
        blocks.append(
            f'<section class="jiritsu-vs-section jiritsu-vs-section--solo" data-ok="{ok["num"]}">'
            f"{cols}</section>"
        )

    # 対に使われなかった✕（通常は無い想定）
    for ng in ng_secs:
        if ng["num"] in used_ng:
            continue
        cols = (
            f'<div class="jiritsu-vs-cols jiritsu-vs-cols--solo">'
            f'<div class="jiritsu-vs-col jiritsu-vs-col--ng">'
            f'{col_title("ng", ng["title"], "（対応する◯カテゴリなし）")}'
            f'{vs_column_html(ng, qb_ids=qb_ids, kind="ng")}'
            f"</div></div>"
        )
        blocks.append(
            f'<section class="jiritsu-vs-section jiritsu-vs-section--solo" data-ng="{ng["num"]}">'
            f"{cols}</section>"
        )
    return "\n".join(blocks)


def kata_table_html(ok_secs: list[dict], ng_by_num: dict[int, dict]) -> str:
    ths = [
        '<th scope="col" class="jiritsu-col-ok">国試が適切とする型</th>',
        '<th scope="col" class="jiritsu-col-ng">現場でやりがちな不適切</th>',
    ]
    trs: list[str] = []
    ok_by_num = {sec["num"]: sec for sec in ok_secs}
    for ok_num, ng_num in KATA_OK_TO_NG.items():
        sec = ok_by_num.get(ok_num)
        if sec is None:
            continue
        ng = ng_by_num.get(ng_num, {})
        ok_cell = (
            f'<p class="jiritsu-kata-title">'
            f'<span class="jiritsu-kata-mark jiritsu-kata-mark--ok" aria-hidden="true">◯</span>'
            f"<strong>{md_inline_to_html(sec['title'])}</strong></p>"
            f'<p class="jiritsu-kata-summary jiritsu-kata-summary--ok">'
            f"{md_inline_to_html(sec['summary'])}</p>"
        )
        ng_cell = (
            f'<p class="jiritsu-kata-title">'
            f'<span class="jiritsu-kata-mark jiritsu-kata-mark--ng" aria-hidden="true">✕</span>'
            f"<strong>{md_inline_to_html(ng.get('title') or '')}</strong></p>"
            f'<p class="jiritsu-kata-summary jiritsu-kata-summary--ng">'
            f"{md_inline_to_html(ng.get('summary') or '')}</p>"
        )
        trs.append(
            "<tr>"
            f'<td class="jiritsu-kata-ok">{ok_cell}</td>'
            f'<td class="jiritsu-kata-ng">{ng_cell}</td>'
            "</tr>"
        )
    return (
        '<div class="hikaku-table-wrap jiritsu-kata-wrap">'
        '<table class="hikaku-table hikaku-table--jiritsu hikaku-table--jiritsu-kata">'
        f"<thead><tr>{''.join(ths)}</tr></thead>"
        f"<tbody>{''.join(trs)}</tbody>"
        "</table></div>"
    )


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


def card_plain_text(text: str) -> str:
    t = strip_period(text or "")
    if t.startswith("😎"):
        t = t[1:].lstrip()
    return t


def build_cards(
    ok_secs: list[dict], ng_secs: list[dict], qb_ids: set[str]
) -> tuple[list[dict], list[str]]:
    """対比マップと同じ並びで、文言1件＝カード1枚の配列を作る。"""
    cards: list[dict] = []
    categories: list[str] = []
    seen_cat: set[str] = set()

    def push_cat(title: str) -> None:
        if title and title not in seen_cat:
            seen_cat.add(title)
            categories.append(title)

    def push_section(sec: dict, kind: str, category: str) -> None:
        push_cat(category)
        for entry in sec["entries"]:
            cards.append(
                {
                    "text": card_plain_text(entry["text"]),
                    "kind": kind,
                    "category": category,
                    "qid": entry["qid"],
                    "inQb": entry["qid"] in qb_ids,
                }
            )

    ok_by = {s["num"]: s for s in ok_secs}
    ng_by = {s["num"]: s for s in ng_secs}
    used_ng: set[int] = set()
    for ok_num, ng_num in KATA_OK_TO_NG.items():
        pair_cat = CARD_CATEGORY_BY_PAIR.get(ok_num) or ""
        ok = ok_by.get(ok_num)
        if ok is not None:
            push_section(ok, "ok", pair_cat or ok["title"])
        ng = ng_by.get(ng_num)
        if ng is not None:
            used_ng.add(ng_num)
            push_section(ng, "ng", pair_cat or ng["title"])

    paired_ok = set(KATA_OK_TO_NG.keys())
    for ok in ok_secs:
        if ok["num"] in paired_ok:
            continue
        push_section(ok, "ok", ok["title"])

    for ng in ng_secs:
        if ng["num"] in used_ng:
            continue
        push_section(ng, "ng", ng["title"])

    return cards, categories


def cards_main_html() -> str:
    return """
<div class="jiritsu-cards-toolbar" role="group" aria-label="絞り込み">
  <label class="jiritsu-cards-field">
    <span class="jiritsu-cards-field-label">範囲</span>
    <select id="jiritsuCardsQb">
      <option value="qb" selected>QBのみ</option>
      <option value="all">すべて</option>
    </select>
  </label>
  <label class="jiritsu-cards-field">
    <span class="jiritsu-cards-field-label">カテゴリ</span>
    <select id="jiritsuCardsCategory">
      <option value="">すべて</option>
    </select>
  </label>
  <label class="jiritsu-cards-field">
    <span class="jiritsu-cards-field-label">判定</span>
    <select id="jiritsuCardsKind">
      <option value="all" selected>すべて</option>
      <option value="ng">✕のみ</option>
      <option value="ok">◯のみ</option>
    </select>
  </label>
  <label class="jiritsu-cards-shuffle">
    <input type="checkbox" id="jiritsuCardsShuffle">
    <span>シャッフル</span>
  </label>
</div>

<article class="jiritsu-card" id="jiritsuCard" hidden>
  <div class="jiritsu-card-face" id="jiritsuCardReveal" role="button" tabindex="0">
    <p class="jiritsu-card-text" id="jiritsuCardText">
      <span class="jiritsu-card-mark" id="jiritsuCardMark" hidden></span><span class="jiritsu-card-body" id="jiritsuCardBody"></span><button type="button" class="hikaku-qid jiritsu-card-qid" id="jiritsuCardQid" hidden></button>
    </p>
  </div>
</article>

<p class="jiritsu-cards-progress" id="jiritsuCardsProgress" aria-live="polite"></p>

<p class="jiritsu-cards-empty" id="jiritsuCardsEmpty" hidden>該当する文言がありません。</p>

<div class="jiritsu-cards-nav">
  <button type="button" class="jiritsu-cards-nav-btn" id="jiritsuCardsPrev">戻る</button>
  <button type="button" class="jiritsu-cards-nav-btn jiritsu-cards-nav-btn--next" id="jiritsuCardsNext">次へ</button>
</div>
""".strip()


def write_json(path: Path, payload: dict) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    import build_hikaku as hikaku_mod

    old_title = hikaku_mod.TITLE
    try:
        md = MD_PATH.read_text(encoding="utf-8")
        sections = parse_seikai_map(md)
        if not sections:
            raise SystemExit(f"カテゴリが読めません: {MD_PATH}")
        ng_by_num = parse_summary_table(NG_MD_PATH.read_text(encoding="utf-8"))
        if not ng_by_num:
            raise SystemExit(f"不適切マップの要約が読めません: {NG_MD_PATH}")

        DATA_DIR.mkdir(parents=True, exist_ok=True)
        qb_ids = load_qb_qids()

        from build_jiritsu_ng_hikaku import parse_futekisetsu_map

        ng_sections = parse_futekisetsu_map(NG_MD_PATH.read_text(encoding="utf-8"))
        if not ng_sections:
            raise SystemExit(f"不適切マップの本文が読めません: {NG_MD_PATH}")

        # ◯一覧（✕と同形式）
        hikaku_mod.TITLE = TITLE
        qids = collect_qids(sections)
        payload = build_questions_json(qids)
        payload["title"] = TITLE
        write_json(DATA_DIR / JSON_NAME, payload)
        seikai_main = f"{seikai_table_html(sections, qb_ids)}"
        (THEMES_DIR / HTML_NAME).write_text(
            page_shell(
                TITLE,
                "hikaku-page hikaku-page--seikai",
                JSON_URL,
                seikai_main,
            ),
            encoding="utf-8",
        )

        # ↔ 型だけの比較表
        kata_payload = {
            "title": KATA_TITLE,
            "count": 0,
            "items": {},
            "missing": [],
        }
        write_json(DATA_DIR / KATA_JSON_NAME, kata_payload)
        kata_main = (
            '<p class="jiritsu-page-lead">'
            "左が国試の「適切」、右が現場でやりがちな「不適切」。"
            "言い回しの一覧は比較ページを開く。"
            "</p>\n"
            f"{kata_table_html(sections, ng_by_num)}"
        )
        (THEMES_DIR / KATA_HTML_NAME).write_text(
            page_shell(
                KATA_TITLE,
                "hikaku-page hikaku-page--jiritsu-kata",
                KATA_JSON_URL,
                kata_main,
            ),
            encoding="utf-8",
        )

        # ◯✕言い回し対比（授業・端末向け）
        vs_qids = collect_qids(sections) + [
            qid
            for qid in collect_qids(ng_sections)
            if qid not in set(collect_qids(sections))
        ]
        hikaku_mod.TITLE = VS_TITLE
        vs_payload = build_questions_json(vs_qids)
        vs_payload["title"] = VS_TITLE
        write_json(DATA_DIR / VS_JSON_NAME, vs_payload)
        vs_main = vs_sections_html(sections, ng_sections, qb_ids)
        (THEMES_DIR / VS_HTML_NAME).write_text(
            page_shell(
                VS_TITLE,
                "hikaku-page hikaku-page--jiritsu-vs",
                VS_JSON_URL,
                vs_main,
            ),
            encoding="utf-8",
        )

        # 言い回しカードは授業で使わないため生成しない（残骸があれば削除）
        for stale in (
            APPENDIX_DIR / CARDS_HTML_NAME,
            APPENDIX_DATA_DIR / CARDS_JSON_NAME,
            THEMES_DIR / CARDS_HTML_NAME,
            DATA_DIR / CARDS_JSON_NAME,
        ):
            if stale.is_file():
                stale.unlink()

        n_correct = sum(len(s["entries"]) for s in sections)
        n_red = sum(1 for s in sections for e in s["entries"] if e["red"])
        miss = payload.get("missing") or []
        vs_miss = vs_payload.get("missing") or []
        print(
            f"自立支援適切マップ HTML: {THEMES_DIR / HTML_NAME}"
            f"（{len(sections)} カテゴリ / 適切 {n_correct} / 赤 {n_red}）"
        )
        print(
            f"自立支援比較表 HTML: {THEMES_DIR / KATA_HTML_NAME}"
            f"（型 {len(KATA_OK_TO_NG)}）"
        )
        print(
            f"自立支援言い回し対比 HTML: {THEMES_DIR / VS_HTML_NAME}"
            f"（対 {len(KATA_OK_TO_NG)} + 単独）"
        )
        print(
            f"自立支援適切マップ JSON: {DATA_DIR / JSON_NAME}"
            f"（{len(qids)} 問, 欠落 {len(miss)}）"
        )
        print(
            f"自立支援言い回し対比 JSON: {DATA_DIR / VS_JSON_NAME}"
            f"（{len(vs_qids)} 問, 欠落 {len(vs_miss)}）"
        )
        if miss:
            print("  欠落: " + ", ".join(miss))
        if vs_miss:
            print("  対比欠落: " + ", ".join(vs_miss))
    finally:
        hikaku_mod.TITLE = old_title


if __name__ == "__main__":
    main()
