#!/usr/bin/env python3
"""重要テーマ・付録過去問を /kaigo/kakomon/themes/ と /appendix/ に公開する。

- 入力: work/theme_extract/（重要テーマ）、work/appendix_extract/（付録）
- ファイル名（拡張子除く）→ ページ見出し
- 本文の 【回-番号｜…】 → questions.json から問題を抽出
- 表示は kakomon と同じカード形式（style / ルビ / 正誤UI）

使い方:
  python3 kaigo/kakomon/themes/deploy_themes.py           # 生成＋FTP
  python3 kaigo/kakomon/themes/deploy_themes.py --build-only
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import shutil
import sys
import time
from copy import deepcopy
from ftplib import FTP_TLS
from pathlib import Path

THEMES_DIR = Path(__file__).resolve().parent
KAKOMON_DIR = THEMES_DIR.parent
APPENDIX_DIR = KAKOMON_DIR / "appendix"
ROOT = KAKOMON_DIR.parent.parent
THEME_SRC_DIR = ROOT / "work" / "theme_extract"
APPENDIX_SRC_DIR = ROOT / "work" / "appendix_extract"
QUESTIONS_JSON = KAKOMON_DIR / "questions.json"

FTP_HOST = "www1165.conoha.ne.jp"
FTP_USER = "ao@nihongo.site"
FTP_PASS = "highway#61"
REMOTE_BASE_DIR = "/public_html/nihongo.site"
REMOTE_THEMES_DIR = f"{REMOTE_BASE_DIR}/kaigo/kakomon/themes"
REMOTE_APPENDIX_DIR = f"{REMOTE_BASE_DIR}/kaigo/kakomon/appendix"
PUBLIC_THEMES_URL = "https://nihongo.site/kaigo/kakomon/themes/"
PUBLIC_APPENDIX_URL = "https://nihongo.site/kaigo/kakomon/appendix/"

# 初期表示する直近回（見出しの問題数もこの範囲）
RECENT_SESSION_MIN = 34
RECENT_SESSION_MAX = 38
# 図あり問題を questions.json から自動生成するテーマ名
ILLUST_THEME_TITLE = "イラスト問題"
# 全件・ファイル順で出すテーマ（もっと見るなし）
SHOW_ALL_IN_ORDER_TITLES = frozenset({"過去問の再利用", "同じ問題"})

# 一覧の親グループ（見出し）→ 子テーマ（.txt の stem）。
# 空ならすべてフラット。括弧短縮ラベルはグループ内の子だけに使う。
# 親グループの並びは build_grouped_index で問数（count）降順に並べ替える。
# 子テーマの並びは各グループ内の定義順（頻出順を推奨）。
THEME_GROUPS: list[tuple[str, list[str]]] = [
    (
        "生活支援技術",
        [
            "生活支援技術（食事）",
            "生活支援技術（移動・体位）",
            "生活支援技術（排泄）",
            "生活支援技術（入浴・清潔・整容）",
            "生活支援技術（障害・認知症への配慮）",
            "生活支援技術（終末期・看取り）",
            "生活支援技術（着脱・衣類）",
            "生活支援技術（基本・自立支援）",
            "生活支援技術（睡眠・休息）",
            "生活支援技術（住環境・福祉用具）",
            "生活支援技術（家事・生活管理）",
        ],
    ),
    (
        "人体のしくみ",
        [
            "人体のしくみ（消化・嚥下・栄養）",
            "人体のしくみ（脳・神経）",
            "人体のしくみ（感覚器）",
            "人体のしくみ（運動器・姿勢）",
            "人体のしくみ（睡眠・体温・リズム）",
            "人体のしくみ（呼吸）",
            "人体のしくみ（老化・恒常性・知能）",
            "人体のしくみ（排泄）",
            "人体のしくみ（皮膚）",
            "人体のしくみ（終末期の身体）",
            "人体のしくみ（循環）",
        ],
    ),
    (
        "介護保険法",
        [
            "介護保険（理念）",
            "介護保険（保険者・被保険者）",
            "介護保険（財源・負担）",
            "介護保険（認定・利用）",
            "介護保険（地域包括）",
            "介護保険（指定・人員）",
            "介護保険（会議・計画）",
            "介護保険（訪問・通所・短期入所サービス）",
            "介護保険（共同生活・施設サービス）",
            "介護保険（福祉用具サービス）",
        ],
    ),
    (
        "医療的ケア",
        [
            "喀痰吸引",
            "経管栄養",
        ],
    ),
    (
        "障害者総合支援法",
        [
            "障害者総合支援法（定義・改正）",
            "障害者総合支援法（機関・体制）",
            "障害者総合支援法（認定・申請）",
            "障害者総合支援法（負担・給付）",
            "障害者総合支援法（相談支援）",
            "障害者総合支援法（訪問・移動サービス）",
            "障害者総合支援法（通所・居住・就労サービス）",
            "障害者総合支援法（補装具サービス）",
        ],
    ),
    (
        "法律",
        [
            # 直近5年（第34〜38回）の多い順。同数は前の並び
            "法律（障害者虐待防止法・高齢者虐待防止法）",
            "法律（社会福祉士及び介護福祉士法）",
            "法律（社会福祉法）",
            "法律（障害者差別解消法）",
            "法律（生活困窮者自立支援法）",
        ],
    ),
    (
        "福祉の関連人物",
        [
            # 直近5年（第34〜38回）の多い順。同数は提案順
            "福祉の関連人物（その他）",
            "福祉の関連人物（福祉思想の人物）",
            "福祉の関連人物（マズロー）",
            "福祉の関連人物（キューブラー・ロス）",
            "福祉の関連人物（ライチャード）",
        ],
    ),
    (
        "利用者本位・自立支援",
        [
            # 先に原則、そのあと場面
            "利用者本位・自立支援（原則）",
            "利用者本位・自立支援（場面）",
        ],
    ),
]

RE_QID = re.compile(r"【\s*(\d+)\s*-\s*(\d+)")
RE_GROUP_CHILD_PAREN = re.compile(
    r"^(?:介護保険|障害者総合支援法|人体のしくみ|生活支援技術|法律|福祉の関連人物|利用者本位・自立支援)（(.+)）$"
)

# 公開しない作業用テーマ（stem に含まれる文字列）
THEME_SRC_SKIP_SUBSTRINGS = ("削除問題", "削除検討", "全ての問題", "すべての問題")


def short_theme_label(title: str) -> str:
    """グループ内の子用の短い表示名（介護保険（理念）→ 理念）。"""
    m = RE_GROUP_CHILD_PAREN.match(title)
    if m:
        return m.group(1)
    return title


def build_grouped_index(themes: list[dict]) -> tuple[list[dict], list[dict]]:
    by_title = {t["title"]: t for t in themes}
    used: set[str] = set()
    groups: list[dict] = []

    for group_title, child_titles in THEME_GROUPS:
        children: list[dict] = []
        for title in child_titles:
            theme = by_title.get(title)
            if not theme:
                continue
            used.add(title)
            entry = dict(theme)
            entry["label"] = short_theme_label(title)
            children.append(entry)
        if not children:
            continue
        groups.append(
            {
                "title": group_title,
                "count": sum(int(c.get("count") or 0) for c in children),
                "displayCount": sum(int(c.get("displayCount") or 0) for c in children),
                "themes": children,
            }
        )

    # 親グループ・未分類とも、画面表示と同じ直近件数（displayCount）の多い順
    def _freq_key(item: dict) -> tuple:
        disp = item.get("displayCount")
        if disp is None:
            disp = item.get("count") or 0
        return (-int(disp), str(item.get("title") or ""))

    groups.sort(key=_freq_key)

    ungrouped: list[dict] = []
    for theme in themes:
        if theme["title"] in used:
            continue
        entry = dict(theme)
        # フラット一覧はファイル名どおり（介護保険（制度のしくみ）など）
        entry["label"] = theme["title"]
        ungrouped.append(entry)
    ungrouped.sort(key=_freq_key)
    return groups, ungrouped

HTACCESS_CONTENT = """
<IfModule mod_headers.c>
    <FilesMatch "\\.(html|css|js|json)$">
        Header always set Cache-Control "no-store, no-cache, must-revalidate, max-age=0"
        Header always set Pragma "no-cache"
        Header always set Expires "0"
    </FilesMatch>
    Header always unset ETag
</IfModule>
FileETag None
"""

DEPLOY_STATIC = ("index.html", "view.html", "app.js", "style.css", "ruby.json", "themes.css")


def make_cache_bust_version() -> str:
    return time.strftime("%Y%m%d%H%M%S")


def prepare_html(content: str, version: str) -> str:
    content = content.replace("__APP_BUILD__", version)
    content = re.sub(
        r'(href="(?:style|themes)\.css)(?:\?v=[^"]*)?"',
        rf'\1?v={version}"',
        content,
    )
    content = re.sub(
        r'(src="app\.js)(?:\?v=[^"]*)?"',
        rf'\1?v={version}"',
        content,
    )
    return content


def make_slug(title: str) -> str:
    """安定した短いスラッグ（日本語ファイル名のFTP事故を避ける）。"""
    digest = hashlib.sha1(title.encode("utf-8")).hexdigest()[:12]
    return digest


def list_theme_source_files(*, appendix: bool) -> list[Path]:
    base = APPENDIX_SRC_DIR if appendix else THEME_SRC_DIR
    if not base.is_dir():
        if appendix:
            return []
        raise FileNotFoundError(f"テーマ元フォルダがありません: {THEME_SRC_DIR}")
    files = []
    for path in sorted(base.iterdir(), key=lambda p: p.name):
        if not path.is_file():
            continue
        if path.name.startswith("."):
            continue
        if path.name.lower() == "readme.md":
            continue
        # .txt のみ（見出しは stem）
        if path.suffix.lower() != ".txt":
            continue
        if any(s in path.stem for s in THEME_SRC_SKIP_SUBSTRINGS):
            continue
        files.append(path)
    return files


def extract_question_ids(text: str) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()
    for m in RE_QID.finditer(text or ""):
        qid = f"{int(m.group(1))}-{int(m.group(2))}"
        if qid in seen:
            continue
        seen.add(qid)
        ids.append(qid)
    return ids


def is_recent_session_question(question: dict) -> bool:
    raw = question.get("round")
    if raw is None or raw == "":
        return False
    try:
        round_n = int(raw)
    except (TypeError, ValueError):
        return False
    return RECENT_SESSION_MIN <= round_n <= RECENT_SESSION_MAX


def count_recent_questions(questions: list[dict]) -> int:
    return sum(1 for q in questions if is_recent_session_question(q))


def question_has_figure(question: dict) -> bool:
    figs = question.get("figures") or []
    if figs:
        return True
    choice_figs = question.get("choiceFigures") or {}
    if not isinstance(choice_figs, dict):
        return False
    return any(choice_figs.values())


def regenerate_illustration_theme_txt(by_id: dict[str, dict]) -> None:
    """questions.json から図あり問題を抽出し、イラスト問題.txt を自動生成する。"""
    items: list[dict] = []
    for q in by_id.values():
        if question_has_figure(q):
            items.append(q)
    items.sort(
        key=lambda q: (
            -int(q.get("round") or 0),
            int(q.get("number") or 0),
        )
    )
    lines: list[str] = []
    for q in items:
        qid = str(q.get("id") or "").strip()
        if not qid:
            qid = f"{int(q.get('round') or 0)}-{int(q.get('number') or 0)}"
        subject = str(q.get("subject") or "").strip()
        lines.append(f"【{qid}｜{subject}】")
    APPENDIX_SRC_DIR.mkdir(parents=True, exist_ok=True)
    out = APPENDIX_SRC_DIR / f"{ILLUST_THEME_TITLE}.txt"
    out.write_text(("\n".join(lines) + ("\n" if lines else "")), encoding="utf-8")
    print(f"自動生成: appendix_extract/{out.name} → {len(lines)} 問")


def rewrite_asset_path(path: str) -> str:
    raw = str(path or "").strip()
    if not raw:
        return raw
    if raw.startswith("figures/"):
        return "../" + raw
    if raw.startswith("/kaigo/kakomon/"):
        return raw
    if raw.startswith("../kakomon/figures/"):
        return "../figures/" + raw[len("../kakomon/figures/") :]
    return raw


def rewrite_question_assets(question: dict) -> dict:
    q = deepcopy(question)
    figs = q.get("figures") or []
    if figs:
        q["figures"] = [rewrite_asset_path(f) for f in figs]
    choice_figs = q.get("choiceFigures") or {}
    if choice_figs:
        rewritten = {}
        for key, src in choice_figs.items():
            rewritten[key] = rewrite_asset_path(src)
        q["choiceFigures"] = rewritten
    return q


def load_questions_by_id() -> dict[str, dict]:
    if not QUESTIONS_JSON.is_file():
        raise FileNotFoundError(
            f"questions.json がありません。先に kakomon をビルドしてください: {QUESTIONS_JSON}"
        )
    payload = json.loads(QUESTIONS_JSON.read_text(encoding="utf-8"))
    by_id: dict[str, dict] = {}
    for item in payload.get("questions") or []:
        qid = str(item.get("id") or "").strip()
        if not qid:
            round_n = item.get("round")
            number_n = item.get("number")
            if round_n is None or number_n is None:
                continue
            qid = f"{int(round_n)}-{int(number_n)}"
        by_id[qid] = item
    return by_id


def sync_shared_assets(site_dir: Path) -> None:
    shutil.copy2(KAKOMON_DIR / "style.css", site_dir / "style.css")
    ruby_src = KAKOMON_DIR / "ruby.json"
    if ruby_src.is_file():
        shutil.copy2(ruby_src, site_dir / "ruby.json")
    else:
        (site_dir / "ruby.json").write_text("[]\n", encoding="utf-8")
    if site_dir.resolve() != THEMES_DIR.resolve():
        shutil.copy2(THEMES_DIR / "themes.css", site_dir / "themes.css")
        shutil.copy2(THEMES_DIR / "app.js", site_dir / "app.js")


def build_site(*, site_dir: Path, index_title: str, appendix: bool) -> list[dict]:
    sync_shared_assets(site_dir)
    data_dir = site_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    for old in data_dir.glob("*.json"):
        old.unlink()

    by_id = load_questions_by_id()
    if not appendix:
        regenerate_illustration_theme_txt(by_id)
    sources = list_theme_source_files(appendix=appendix)
    if not sources:
        label = "付録" if appendix else "重要テーマ"
        print(f"警告: {label}用 .txt がありません → {THEME_SRC_DIR}")

    themes: list[dict] = []
    for path in sources:
        title = path.stem
        slug = make_slug(title)
        ids = extract_question_ids(path.read_text(encoding="utf-8"))
        questions = []
        missing = []
        for qid in ids:
            src = by_id.get(qid)
            if not src:
                missing.append(qid)
                continue
            questions.append(rewrite_question_assets(src))

        show_all = title in SHOW_ALL_IN_ORDER_TITLES
        if show_all:
            recent_count = len(questions)
            older_count = 0
            display_count = len(questions)
        else:
            recent_count = count_recent_questions(questions)
            older_count = len(questions) - recent_count
            # 見出し用: 直近があればその件数、なければ全件
            display_count = recent_count if recent_count > 0 else len(questions)

        payload = {
            "title": title,
            "slug": slug,
            "count": len(questions),
            "recentCount": recent_count,
            "olderCount": older_count,
            "displayCount": display_count,
            "recentSessionMin": RECENT_SESSION_MIN,
            "recentSessionMax": RECENT_SESSION_MAX,
            # 同じ問題など: もっと見るなし・txt の並びのまま
            "showAllInOrder": show_all,
            "ids": [q.get("id") or f"{q.get('round')}-{q.get('number')}" for q in questions],
            "missing": missing,
            "questions": questions,
        }
        out = data_dir / f"{slug}.json"
        out.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        themes.append(
            {
                "title": title,
                "label": title,
                "slug": slug,
                "count": len(questions),
                "recentCount": recent_count,
                "olderCount": older_count,
                "displayCount": display_count,
                "missingCount": len(missing),
                "href": f"view.html?t={slug}",
            }
        )
        if show_all:
            msg = f"テーマ: {title} → 全 {len(questions)} 問（ファイル順・もっと見るなし）"
        else:
            msg = (
                f"テーマ: {title} → 表示 {display_count} 問"
                f"（全 {len(questions)} / 直近 {recent_count} / 以前 {older_count}）"
            )
        if missing:
            msg += f"（欠番 {len(missing)}: {', '.join(missing[:8])}{'…' if len(missing) > 8 else ''}）"
        print(msg)

    groups, ungrouped = build_grouped_index(themes)
    index_payload = {
        "title": index_title,
        "count": len(themes),
        "groups": groups,
        "ungrouped": ungrouped,
        "themes": themes,
    }
    (site_dir / "index.json").write_text(
        json.dumps(index_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    site_label = "付録" if appendix else "重要テーマ"
    print(
        f"[{site_label}] 一覧: {len(themes)} テーマ / グループ {len(groups)} / "
        f"フラット {len(ungrouped)} → {site_dir / 'index.json'}"
    )
    return themes


def ensure_remote_dir(ftps: FTP_TLS, path: str) -> None:
    parts = [p for p in path.strip("/").split("/") if p]
    ftps.cwd("/")
    for part in parts:
        try:
            ftps.cwd(part)
        except Exception:
            ftps.mkd(part)
            ftps.cwd(part)


def upload_one_site(
    ftps: FTP_TLS,
    *,
    site_dir: Path,
    remote_dir: str,
    public_url: str,
    html_dir: Path,
    version: str,
    label: str,
) -> None:
    ensure_remote_dir(ftps, remote_dir)

    htaccess_bytes = io.BytesIO(HTACCESS_CONTENT.strip().encode("utf-8"))
    ftps.storbinary("STOR .htaccess", htaccess_bytes)
    print(f"[{label}] アップロード完了: .htaccess")

    for name in DEPLOY_STATIC:
        if name.endswith(".html"):
            local_path = html_dir / name
        else:
            local_path = site_dir / name
        if not local_path.is_file():
            raise FileNotFoundError(f"不足: {local_path}")
        if name.endswith(".html"):
            content = prepare_html(local_path.read_text(encoding="utf-8"), version)
            ftps.storbinary(f"STOR {name}", io.BytesIO(content.encode("utf-8")))
        else:
            with local_path.open("rb") as f:
                ftps.storbinary(f"STOR {name}", f)
        print(f"[{label}] アップロード完了: {name}")

    index_json = site_dir / "index.json"
    with index_json.open("rb") as f:
        ftps.storbinary("STOR index.json", f)
    print(f"[{label}] アップロード完了: index.json")

    data_dir = site_dir / "data"
    ensure_remote_dir(ftps, f"{remote_dir}/data")
    for path in sorted(data_dir.glob("*.json")):
        with path.open("rb") as f:
            ftps.storbinary(f"STOR {path.name}", f)
        print(f"[{label}] アップロード完了: data/{path.name}")

    print(f"[{label}] 公開URL: {public_url}?_cb={version}")


def upload_sites() -> None:
    version = make_cache_bust_version()
    ftps = FTP_TLS()
    ftps.connect(FTP_HOST, 21, timeout=30)
    ftps.login(FTP_USER, FTP_PASS)
    ftps.prot_p()
    ftps.set_pasv(True)

    upload_one_site(
        ftps,
        site_dir=THEMES_DIR,
        remote_dir=REMOTE_THEMES_DIR,
        public_url=PUBLIC_THEMES_URL,
        html_dir=THEMES_DIR,
        version=version,
        label="重要テーマ",
    )
    upload_one_site(
        ftps,
        site_dir=APPENDIX_DIR,
        remote_dir=REMOTE_APPENDIX_DIR,
        public_url=PUBLIC_APPENDIX_URL,
        html_dir=APPENDIX_DIR,
        version=version,
        label="付録",
    )
    ftps.quit()


def main() -> int:
    parser = argparse.ArgumentParser(description="重要テーマ過去問を生成・デプロイ")
    parser.add_argument(
        "--build-only",
        action="store_true",
        help="FTPせず JSON と共有アセットだけ生成",
    )
    args = parser.parse_args()
    try:
        build_site(
            site_dir=THEMES_DIR,
            index_title="介護福祉士国家試験 重要テーマ",
            appendix=False,
        )
        build_site(
            site_dir=APPENDIX_DIR,
            index_title="介護福祉士国家試験 付録",
            appendix=True,
        )
        if not args.build_only:
            upload_sites()
    except Exception as err:
        print(str(err), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
