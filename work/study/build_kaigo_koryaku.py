#!/usr/bin/env python3
"""攻略（正解マップ）の MD / HTML / JSON を生成する。

介護保険法攻略・障害者総合支援法攻略を同じ仕組みで出す。
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
QUESTIONS_JSON = ROOT / "kaigo" / "kakomon" / "questions.json"
THEME_SRC = ROOT / "work" / "theme_extract"
STUDY_DIR = ROOT / "work" / "study"
THEMES_DIR = ROOT / "kaigo" / "kakomon" / "themes"
DATA_DIR = THEMES_DIR / "data"

RE_QID = re.compile(r"【\s*(\d+)\s*-\s*(\d+)")

# prefix: theme_extract のファイル名先頭（括弧の直前まで）
KORYAKU_SPECS = [
    {
        "key": "kaigo-hoken",
        "title": "介護保険法攻略",
        "md_title": "介護保険法 正解マップ（学習用）",
        "prefix": "介護保険",
        "html": "koryaku-kaigo-hoken.html",
        "json": "koryaku-kaigo-hoken.json",
        "md": "介護保険_正解マップ.md",
    },
    {
        "key": "shogai-sogo",
        "title": "障害者総合支援法攻略",
        "md_title": "障害者総合支援法 正解マップ（学習用）",
        "prefix": "障害者総合支援法",
        "html": "koryaku-shogai-sogo.html",
        "json": "koryaku-shogai-sogo.json",
        "md": "障害者総合支援法_正解マップ.md",
    },
]


def theme_sort_key(prefix: str, path: Path) -> int:
    m = re.match(re.escape(prefix) + r"（(\d+)", path.stem)
    return int(m.group(1)) if m else 999


def list_theme_files(prefix: str) -> list[Path]:
    head = f"{prefix}（"
    return sorted(
        [
            p
            for p in THEME_SRC.iterdir()
            if p.is_file() and p.name.startswith(head) and p.suffix == ".txt"
        ],
        key=lambda p: theme_sort_key(prefix, p),
    )


def extract_ids(path: Path) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        m = RE_QID.search(line)
        if not m:
            continue
        qid = f"{int(m.group(1))}-{int(m.group(2))}"
        if qid in seen:
            continue
        seen.add(qid)
        ids.append(qid)
    return sorted(ids, key=lambda q: (-int(q.split("-")[0]), int(q.split("-")[1])))


def body_parts(body) -> list[str]:
    if isinstance(body, list):
        return [str(p).strip() for p in body if p and str(p).strip()]
    text = str(body or "").strip()
    return [text] if text else []


def is_jirei(parts: list[str]) -> bool:
    joined = "\n".join(parts)
    return "事例" in joined or "〔事" in joined or len(parts) >= 2


def explain_for_answers(explains, answers: list) -> str:
    if not explains:
        return ""
    if isinstance(explains, dict):
        bits = []
        for n in answers:
            text = explains.get(n)
            if text is None:
                text = explains.get(str(n))
            if text:
                bits.append(str(text).strip())
        return "\n".join(bits)
    return ""


def load_sections(qmap: dict, prefix: str) -> tuple[list[dict], int]:
    sections: list[dict] = []
    total = 0
    theme_re = re.compile(re.escape(prefix) + r"（(.+)）$")
    for path in list_theme_files(prefix):
        m = theme_re.match(path.stem)
        theme = m.group(1) if m else path.stem
        items = []
        for qid in extract_ids(path):
            q = qmap.get(qid)
            if not q:
                items.append({"id": qid, "missing": True})
                continue
            a, b = map(int, qid.split("-"))
            display_id = f"{a}-{b}"
            answers = q.get("answers") or []
            choices = {c["n"]: c["text"] for c in (q.get("choices") or [])}
            ans_texts = [choices.get(n, f"選択肢{n}") for n in answers]
            parts = body_parts(q.get("body") or [])
            items.append(
                {
                    "id": display_id,
                    "subject": q.get("subject") or "",
                    "body": parts,
                    "jirei": is_jirei(parts),
                    "answer": "／".join(ans_texts) if ans_texts else "（不明）",
                    "answerNs": [int(n) for n in answers],
                    "explain": explain_for_answers(q.get("explains"), answers),
                    "note": (q.get("note") or "").strip(),
                    "href": f"/kaigo/kakomon/?round={a}&num={b}",
                }
            )
            total += 1
        sections.append({"theme": theme, "items": items})
    return sections, total


def write_md(spec: dict, sections: list[dict], total: int) -> None:
    html_name = spec["html"]
    title = spec["title"]
    prefix = spec["prefix"]
    lines = [
        f"# {spec['md_title']}",
        "",
        "過去問で問われた内容を、カテゴリー別に「正解」中心で眺めるための一覧です。",
        "誤選択肢の分析は後回しにして、まず正解の事実を押さえてください。",
        "",
        f"- 公開ページ: `/kaigo/kakomon/themes/{html_name}`（{title}）",
        f"- 出典: `work/theme_extract/{prefix}（…）.txt`",
        f"- 全 {total} 問",
        "",
        "使い方の目安:",
        "1. 上からカテゴリー順に、正解の文だけ読んで「何が正しいか」を掴む",
        "2. 同じ趣旨の正解が繰り返されているところを優先して覚える",
        "3. カードをタップすると解説を表示",
        "",
    ]
    for sec in sections:
        lines.append(f"## {sec['theme']}")
        lines.append(f"（{len(sec['items'])}問）")
        lines.append("")
        for it in sec["items"]:
            if it.get("missing"):
                lines.append(f"- 【{it['id']}】 ※問題データなし")
                lines.append("")
                continue
            qid = it["id"]
            subj = it["subject"]
            lines.append(f"- 【{qid}｜{subj}】")
            if len(it["body"]) == 1:
                lines.append(f"  問題：{it['body'][0]}")
            else:
                lines.append("  問題：")
                for para in it["body"]:
                    lines.append(f"  {para}")
            lines.append(f"  正解：{it['answer']}")
            if it.get("explain"):
                lines.append(f"  解説：{it['explain']}")
            lines.append("")
    STUDY_DIR.mkdir(parents=True, exist_ok=True)
    (STUDY_DIR / spec["md"]).write_text("\n".join(lines), encoding="utf-8")


def write_json(spec: dict, sections: list[dict], total: int) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "title": spec["title"],
        "key": spec["key"],
        "count": total,
        "sections": sections,
    }
    (DATA_DIR / spec["json"]).write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def write_html(spec: dict, total: int) -> None:
    title = spec["title"]
    key = spec["key"]
    json_name = spec["json"]
    doc = f"""<!DOCTYPE html>
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
<body class="koryaku-page" data-koryaku-key="{key}" data-koryaku-title="{title}" data-koryaku-json="data/{json_name}">
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
    <h1>{title}</h1>
</header>

  <main class="koryaku-main">
    <div id="koryakuNow" class="koryaku-now" hidden aria-live="polite">
      <span class="koryaku-now-label">いま学習中</span>
      <span class="koryaku-now-name" id="koryakuNowName"></span>
    </div>
    <div id="koryakuBody" class="koryaku-body" aria-live="polite">
      <p class="hint">読み込み中…</p>
    </div>
  </main>

  <button type="button" id="backToTop" class="back-to-top" aria-label="一番上に戻る" hidden>
    <span aria-hidden="true">⌃</span>
  </button>
  <script src="app.js?v=__APP_BUILD__"></script>
</body>
</html>
"""
    (THEMES_DIR / spec["html"]).write_text(doc, encoding="utf-8")


def build_one(qmap: dict, spec: dict) -> None:
    sections, total = load_sections(qmap, spec["prefix"])
    write_md(spec, sections, total)
    write_json(spec, sections, total)
    write_html(spec, total)
    print(
        f"{spec['title']}: {total} 問 → {spec['md']} / {spec['html']} / {spec['json']}"
    )


def main() -> int:
    raw = json.loads(QUESTIONS_JSON.read_text(encoding="utf-8"))["questions"]
    norm = {}
    for q in raw:
        a, b = q["id"].split("-")
        norm[f"{int(a)}-{int(b)}"] = q
    for spec in KORYAKU_SPECS:
        build_one(norm, spec)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
