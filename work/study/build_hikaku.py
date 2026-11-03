#!/usr/bin/env python3
"""介護保険法と障害者総合支援法の対応比較表（比較表セクションのみ）を HTML 化する。"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
STUDY_DIR = ROOT / "work" / "study"
THEMES_DIR = ROOT / "kaigo" / "kakomon" / "themes"
DATA_DIR = THEMES_DIR / "data"
MD_PATH = STUDY_DIR / "介護保険法と障害者総合支援法_対応比較表.md"
HTML_NAME = "hikaku-kaigo-shogai.html"
JSON_NAME = "hikaku-kaigo-shogai.json"
TITLE = "介護保険法・障害者総合支援法攻略マップ"

RE_QID = re.compile(r"【\s*(\d+)\s*-\s*(\d+)\s*】")
KORYAKU_KAIGO = DATA_DIR / "koryaku-kaigo-hoken.json"
KORYAKU_SHOGAI = DATA_DIR / "koryaku-shogai-sogo.json"
KORYAKU_JSONS = (KORYAKU_KAIGO, KORYAKU_SHOGAI)
MAP_KAIGO = STUDY_DIR / "介護保険_正解マップ.md"
MAP_SHOGAI = STUDY_DIR / "障害者総合支援法_正解マップ.md"


def qid_sort_key(m: re.Match[str]) -> tuple[int, int]:
    """新しい回・新しい番号が先（降順）。"""
    return (-int(m.group(1)), -int(m.group(2)))


def _qids_from_map(path: Path) -> set[str]:
    if not path.is_file():
        return set()
    return set(re.findall(r"【(\d+-\d+)｜", path.read_text(encoding="utf-8")))


def _qids_from_koryaku(path: Path) -> set[str]:
    if not path.is_file():
        return set()
    data = json.loads(path.read_text(encoding="utf-8"))
    out: set[str] = set()
    for sec in data.get("sections") or []:
        for item in sec.get("items") or []:
            qid = str(item.get("id") or "").strip()
            if qid:
                out.add(qid)
    return out


def build_qid_side_map() -> dict[str, str]:
    """qid → 'kaigo' | 'shogai' | 'both'（両制度は色分けしない）。"""
    kaigo = _qids_from_map(MAP_KAIGO) | _qids_from_koryaku(KORYAKU_KAIGO)
    shogai = _qids_from_map(MAP_SHOGAI) | _qids_from_koryaku(KORYAKU_SHOGAI)
    # マップ外だが比較表にある問の寄せ先
    shogai |= {"31-123", "35-58", "38-109"}
    kaigo |= {"32-23"}
    sides: dict[str, str] = {}
    for qid in kaigo | shogai:
        in_k = qid in kaigo
        in_s = qid in shogai
        if in_k and in_s:
            sides[qid] = "both"
        elif in_k:
            sides[qid] = "kaigo"
        else:
            sides[qid] = "shogai"
    return sides


def qids_cell_to_html(text: str, side_map: dict[str, str] | None = None) -> str:
    """過去問番号セルを、新しい順のボタン列にする。"""
    matches = list(RE_QID.finditer(text))
    if not matches:
        return md_inline_to_html(text)
    side_map = side_map or {}
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
        qid = f"{m.group(1)}-{m.group(2)}"
        side = side_map.get(qid, "both")
        extra = ""
        if side == "kaigo":
            extra = " hikaku-qid--kaigo"
        elif side == "shogai":
            extra = " hikaku-qid--shogai"
        buttons.append(
            f'<button type="button" class="hikaku-qid{extra}" '
            f'data-round="{m.group(1)}" data-number="{m.group(2)}">'
            f"【{m.group(1)}-{m.group(2)}】</button>"
        )
    return "".join(buttons)


def md_inline_to_html(text: str) -> str:
    parts = re.split(r"(<br\s*/?>)", text, flags=re.I)
    out: list[str] = []
    for part in parts:
        if re.fullmatch(r"<br\s*/?>", part or "", flags=re.I):
            out.append("<br>")
            continue
        s = part
        s = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
        out.append(s)
    return "".join(out)


def extract_comparison_table(md: str) -> list[list[str]]:
    """## 比較表 から次の ## までの Markdown 表を行列で返す。"""
    m = re.search(r"^##\s*比較表\s*$", md, re.M)
    if not m:
        raise ValueError("## 比較表 が見つかりません")
    rest = md[m.end() :]
    next_h = re.search(r"^##\s+", rest, re.M)
    section = rest[: next_h.start()] if next_h else rest
    rows: list[list[str]] = []
    for line in section.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if cells and all(re.fullmatch(r":?-{3,}:?", c) for c in cells):
            continue
        rows.append(cells)
    if len(rows) < 2:
        raise ValueError("比較表の行が足りません")
    return rows


def collect_qids(rows: list[list[str]]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for row in rows:
        for cell in row:
            for m in RE_QID.finditer(cell):
                qid = f"{m.group(1)}-{m.group(2)}"
                if qid not in seen:
                    seen.add(qid)
                    ordered.append(qid)
    return ordered


def load_koryaku_items() -> dict[str, dict]:
    by_id: dict[str, dict] = {}
    for path in KORYAKU_JSONS:
        if not path.is_file():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        for sec in data.get("sections") or []:
            for item in sec.get("items") or []:
                qid = str(item.get("id") or "").strip()
                if qid and qid not in by_id:
                    by_id[qid] = item
    return by_id


def load_questions_by_id() -> dict[str, dict]:
    path = ROOT / "kaigo" / "kakomon" / "questions.json"
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    out: dict[str, dict] = {}
    for q in data.get("questions") or []:
        qid = f"{q.get('round')}-{q.get('number')}"
        out[qid] = q
    return out


def answer_text_for(qid: str, q: dict) -> tuple[str, str]:
    """正答文と解説を answers + explains から取る。"""
    import csv

    m = re.match(r"^(\d+)-(\d+)$", qid)
    if not m:
        return "", ""
    round_n, num = int(m.group(1)), int(m.group(2))
    ans_path = ROOT / "kaigo" / "kakomon" / f"answers_{round_n}.csv"
    ans_n = ""
    if ans_path.is_file():
        for row in csv.DictReader(ans_path.open(encoding="utf-8")):
            if int(row["number"]) == num:
                ans_n = str(row.get("answer") or "").strip()
                break
    answer = ""
    explain = ""
    choices = {str(c.get("n")): c.get("text") or "" for c in (q.get("choices") or [])}
    if ans_n:
        # 複数正答はカンマ区切りの場合あり
        parts = [p.strip() for p in ans_n.replace("，", ",").split(",") if p.strip()]
        answer = "／".join(choices.get(p, f"選択肢{p}") for p in parts)
    ex_path = ROOT / "kaigo" / "kakomon" / "explains" / f"explains_{round_n}.json"
    if ex_path.is_file() and ans_n:
        ex_data = json.loads(ex_path.read_text(encoding="utf-8"))
        ex_item = (ex_data.get("items") or {}).get(qid) or {}
        explains = ex_item.get("explains") or {}
        first = ans_n.replace("，", ",").split(",")[0].strip()
        explain = str(explains.get(first) or explains.get(str(first)) or "")
    # questions.json 側に explains がある場合も
    if not explain and isinstance(q.get("explains"), dict) and ans_n:
        first = ans_n.replace("，", ",").split(",")[0].strip()
        explain = str(q["explains"].get(first) or "")
    return answer, explain


def fallback_item_from_questions(qid: str, qmap: dict[str, dict]) -> dict | None:
    q = qmap.get(qid)
    if not q:
        return None
    answer, explain = answer_text_for(qid, q)
    body = q.get("body") or []
    if isinstance(body, str):
        body = [body]
    return {
        "id": qid,
        "subject": q.get("subject") or "",
        "body": body,
        "answer": answer,
        "explain": explain,
        "note": q.get("note") or "",
        "missing": False,
    }


def full_question_item(qid: str, q: dict) -> dict:
    """モーダルで通常の問題表示（全選択肢・＋・正解表示）ができる形。"""
    body = q.get("body") or []
    if isinstance(body, str):
        body = [body]
    return {
        "id": qid,
        "round": q.get("round"),
        "number": q.get("number"),
        "subject": q.get("subject") or "",
        "body": body,
        "choices": q.get("choices") or [],
        "answers": q.get("answers") or [],
        "explains": q.get("explains") or {},
        "note": q.get("note") or "",
        "figures": q.get("figures") or [],
        "choiceFigures": q.get("choiceFigures") or {},
        "missing": False,
    }


def build_questions_json(qids: list[str]) -> dict:
    qmap = load_questions_by_id()
    items: dict[str, dict] = {}
    missing: list[str] = []
    for qid in qids:
        q = qmap.get(qid)
        if q:
            items[qid] = full_question_item(qid, q)
            continue
        missing.append(qid)
        items[qid] = {"id": qid, "missing": True}
    return {"title": TITLE, "count": len(qids), "items": items, "missing": missing}


def table_to_html(rows: list[list[str]], side_map: dict[str, str] | None = None) -> str:
    header, body = rows[0], rows[1:]
    side_map = side_map or {}
    ths: list[str] = []
    for i, c in enumerate(header):
        if i == 0:
            cls = ' class="hikaku-corner"'
        elif i == 1:
            cls = ' class="hikaku-col-kaigo"'
        elif i == 2:
            cls = ' class="hikaku-col-shogai"'
        else:
            cls = ""
        ths.append(f"<th scope=\"col\"{cls}>{md_inline_to_html(c)}</th>")
    thead = "".join(ths)
    trs: list[str] = []
    for row in body:
        while len(row) < len(header):
            row.append("")
        cells: list[str] = []
        for i, c in enumerate(row[: len(header)]):
            is_qid_col = i == len(header) - 1
            html = (
                qids_cell_to_html(c, side_map)
                if is_qid_col
                else md_inline_to_html(c)
            )
            if i == 0:
                cells.append(f'<th scope="row" class="hikaku-sticky-col">{html}</th>')
            elif i == 1:
                cells.append(f'<td class="hikaku-col-kaigo">{html}</td>')
            elif i == 2:
                cells.append(f'<td class="hikaku-col-shogai">{html}</td>')
            else:
                cells.append(f"<td>{html}</td>")
        trs.append("<tr>" + "".join(cells) + "</tr>")
    return (
        '<div class="hikaku-table-wrap">'
        '<table class="hikaku-table">'
        f"<thead><tr>{thead}</tr></thead>"
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
<body class="hikaku-page">
  <header class="page-header">
    <div class="site-bar">
      <button type="button" class="nav-toggle" aria-expanded="false" aria-controls="siteNav" aria-label="メニュー">
        <span class="nav-toggle-icon" aria-hidden="true"><span></span><span></span><span></span></span>
      </button>
      <p class="site-brand" aria-label="介護福祉士国家試験対策">介護福祉士国家試験対策</p>
      <nav id="siteNav" class="site-nav" aria-label="サイト内移動">
        <a class="site-nav-link" href="/kaigo/kakomon/">過去問検索</a>
        <a class="site-nav-link is-current" href="/kaigo/kakomon/themes/" aria-current="page">重要テーマ</a>
        <a class="site-nav-link" href="/kaigo/kakomon/reference/">参考テーマ</a>
        <a class="site-nav-link" href="/kaigo/kakomon/appendix/">付録</a>
        <a class="site-nav-link" href="/kaigo/kakomon/part-a/">Aパート</a>
        <a class="site-nav-link" href="/kaigo/kakomon/part-b/">Bパート</a>
        <a class="site-nav-link" href="/kaigo/kakomon/part-c/">Cパート</a>
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
    md = MD_PATH.read_text(encoding="utf-8")
    rows = extract_comparison_table(md)
    qids = collect_qids(rows)
    side_map = build_qid_side_map()
    payload = build_questions_json(qids)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    json_path = DATA_DIR / JSON_NAME
    json_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    html = build_html(table_to_html(rows, side_map))
    out = THEMES_DIR / HTML_NAME
    out.write_text(html, encoding="utf-8")
    miss = payload.get("missing") or []
    print(f"比較表 HTML: {out}（{len(rows) - 1} 行）")
    print(f"比較表 JSON: {json_path}（{len(qids)} 問, 欠落 {len(miss)}）")
    if miss:
        print("  欠落: " + ", ".join(miss))


if __name__ == "__main__":
    main()
