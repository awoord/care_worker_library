#!/usr/bin/env python3
"""重要テーマ・参考テーマ・付録過去問を公開する。

- 入力: work/theme_extract/（重要テーマ）、work/part_extract/{A,B,C}/（各パート）、work/reference_extract/（参考テーマ）、work/appendix_extract/（付録）
- ファイル名（拡張子除く）→ ページ見出し
- 本文の 【回-番号｜…】 → questions.json から問題を抽出
- 表示は kakomon と同じカード形式（style / ルビ / 正誤UI）

使い方:
  python3 work/deploy_themes.py           # 生成＋FTP
  python3 work/deploy_themes.py --build-only
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

ROOT = Path(__file__).resolve().parent.parent
KAKOMON_DIR = ROOT / "kaigo" / "kakomon"
THEMES_DIR = KAKOMON_DIR / "themes"
APPENDIX_DIR = KAKOMON_DIR / "appendix"
REFERENCE_DIR = KAKOMON_DIR / "reference"
THEME_SRC_DIR = ROOT / "work" / "theme_extract"
PART_SRC_DIR = ROOT / "work" / "part_extract"
REFERENCE_SRC_DIR = ROOT / "work" / "reference_extract"
APPENDIX_SRC_DIR = ROOT / "work" / "appendix_extract"
QUESTIONS_JSON = KAKOMON_DIR / "questions.json"

FTP_HOST = "www1165.conoha.ne.jp"
FTP_USER = "ao@nihongo.site"
FTP_PASS = "highway#61"
REMOTE_BASE_DIR = "/public_html/nihongo.site"
REMOTE_THEMES_DIR = f"{REMOTE_BASE_DIR}/kaigo/kakomon/themes"
REMOTE_APPENDIX_DIR = f"{REMOTE_BASE_DIR}/kaigo/kakomon/appendix"
REMOTE_REFERENCE_DIR = f"{REMOTE_BASE_DIR}/kaigo/kakomon/reference"
PUBLIC_THEMES_URL = "https://nihongo.site/kaigo/kakomon/themes/"
PUBLIC_APPENDIX_URL = "https://nihongo.site/kaigo/kakomon/appendix/"
PUBLIC_REFERENCE_URL = "https://nihongo.site/kaigo/kakomon/reference/"
# 国家試験のパート（出題順）。元ファイルは work/part_extract/{A,B,C}/。
PART_SITES = [
    {
        "key": "a",
        "folder": "A",
        "label": "Aパート",
        "groups": [
            "人間の尊厳と自立",
            "介護の基本",
            "社会の理解",
            "人間関係とコミュニケーション",
            "コミュニケーション技術",
            "生活支援技術",
        ],
        "ungrouped": [],
    },
    {
        "key": "b",
        "folder": "B",
        "label": "Bパート",
        "groups": [
            "こころとからだのしくみ",
            "発達と老化の理解",
            "認知症の理解",
            "障害の理解",
            "医療的ケア",
        ],
        "ungrouped": [],
    },
    {
        "key": "c",
        "folder": "C",
        "label": "Cパート",
        "groups": ["介護過程"],
        "ungrouped": ["総合問題"],
    },
]

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
# 子テーマの並びは各グループ内の定義順。
# 介護保険法・障害者総合支援法以外は、直近5年（第34〜38回）の多い順。
# 同数は全問数の多い順。それも同じなら前の並び。
THEME_GROUPS: list[tuple[str, list[str]]] = [
    (
        "生活支援技術",
        [
            "生活支援技術（1　生活支援の理解）",
            "生活支援技術（2　自立に向けた居住環境の整備）",
            "生活支援技術（3　自立に向けた移動の介護）",
            "生活支援技術（4　自立に向けた身じたくの介護）",
            "生活支援技術（5　自立に向けた食事の介護）",
            "生活支援技術（6　自立に向けた入浴・清潔保持の介護）",
            "生活支援技術（7　自立に向けた排泄の介護）",
            "生活支援技術（8　自立に向けた家事の介護）",
            "生活支援技術（9　休息・睡眠の介護）",
            "生活支援技術（10　人生の最終段階における介護）",
            "生活支援技術（11　福祉用具の意義と活用）",
        ],
    ),
    (
        "人体のしくみ",
        [
            "人体のしくみ（消化・嚥下・栄養）",
            "人体のしくみ（脳・神経）",
            "人体のしくみ（感覚器）",
            "人体のしくみ（呼吸）",
            "人体のしくみ（運動器・姿勢）",
            "人体のしくみ（老化・恒常性・知能）",
            "人体のしくみ（睡眠・体温・リズム）",
            "人体のしくみ（皮膚）",
            "人体のしくみ（排泄）",
            "人体のしくみ（終末期の身体）",
            "人体のしくみ（循環）",
        ],
    ),
    (
        "介護保険法",
        [
            "介護保険（1　理念）",
            "介護保険（2　保険者・被保険者）",
            "介護保険（3　財源・負担）",
            "介護保険（4　認定・利用）",
            "介護保険（5　地域包括）",
            "介護保険（6　指定・人員）",
            "介護保険（7　会議・計画）",
            "介護保険（8　訪問・通所・短期入所サービス）",
            "介護保険（9　共同生活・施設サービス）",
            "介護保険（10　福祉用具サービス）",
        ],
    ),
    (
        "医療的ケア",
        [
            "医療的ケア（1　医療的ケア実施の基礎）",
            "医療的ケア（2　喀痰吸引（基礎的知識・実施手順））",
            "医療的ケア（3　経管栄養（基礎的知識・実施手順））",
        ],
    ),
    (
        "障害者総合支援法",
        [
            "障害者総合支援法（1　定義・改正）",
            "障害者総合支援法（2　機関・体制）",
            "障害者総合支援法（3　認定・申請）",
            "障害者総合支援法（4　負担・給付）",
            "障害者総合支援法（5　相談支援）",
            "障害者総合支援法（6　訪問・移動サービス）",
            "障害者総合支援法（7　通所・居住・就労サービス）",
            "障害者総合支援法（8　補装具サービス）",
        ],
    ),
    (
        "法律",
        [
            "法律（障害者虐待防止法・高齢者虐待防止法）",
            "法律（成年後見制度）",
            "法律（社会福祉士及び介護福祉士法）",
            "法律（社会福祉法）",
            "法律（障害者差別解消法）",
            "法律（生活保護法）",
            "法律（生活困窮者自立支援法）",
        ],
    ),
    (
        "コミュニケーション",
        [
            "コミュニケーション（技術）",
            "コミュニケーション（人間関係）",
        ],
    ),
    (
        "介護過程",
        [
            "介護過程（1　介護過程の意義と基礎的理解）",
            "介護過程（2　介護過程とチームアプローチ）",
            "介護過程（3　介護過程の展開の理解）",
        ],
    ),
    (
        "福祉の関連人物",
        [
            "福祉の関連人物（福祉思想の人物）",
            "福祉の関連人物（マズロー）",
            "福祉の関連人物（キューブラー・ロス）",
            "福祉の関連人物（ライチャード）",
        ],
    ),
    (
        "利用者本位・自立支援",
        [
            "利用者本位・自立支援（場面）",
            "利用者本位・自立支援（原則）",
        ],
    ),
    (
        "認知症",
        [
            "中核症状・行動心理症状",
            "アルツハイマー型認知症",
            "レビー小体型認知症",
            "若年性認知症",
            "慢性硬膜下血腫・正常圧水頭症",
            "認知症のリスク",
        ],
    ),
    (
        "疾患・障害",
        [
            "パーキンソン病",
            "筋萎縮性側索硬化症（ALS）",
            "脳性麻痺",
            "自閉症スペクトラム障害",
            "脊髄損傷（頸髄損傷・腰髄損傷）",
            "糖尿病・糖尿病性合併症",
            "統合失調症",
            "うつ病・抑うつ状態",
            "学習障害・注意欠如多動症",
            "強度行動障害",
        ],
    ),
    (
        "人間の尊厳と自立",
        [
            "人間の尊厳と自立（1　人間の尊厳と人権・福祉理念）",
            "人間の尊厳と自立（2　自立の概念）",
        ],
    ),
    (
        "介護の基本",
        [
            "介護の基本（1　介護福祉の基本となる理念）",
            "介護の基本（2　介護福祉士の役割と機能）",
            "介護の基本（3　介護福祉士の倫理）",
            "介護の基本（4　自立に向けた介護）",
            "介護の基本（5　介護を必要とする人の理解）",
            "介護の基本（6　介護を必要とする人の生活を支えるしくみ）",
            "介護の基本（7　協働する多職種の役割と機能）",
            "介護の基本（8　介護における安全の確保とリスクマネジメント）",
            "介護の基本（9　介護従事者の安全）",
        ],
    ),
    (
        "社会の理解",
        [
            "社会の理解（1　社会と生活のしくみ）",
            "社会の理解（2　地域共生社会の実現に向けた制度や施策）",
            "社会の理解（3　社会保障制度）",
            "社会の理解（4　高齢者福祉と介護保険制度）",
            "社会の理解（5　障害者福祉と障害者保健福祉制度）",
            "社会の理解（6　介護実践に関連する諸制度）",
        ],
    ),
    (
        "人間関係とコミュニケーション",
        [
            "人間関係とコミュニケーション（1　人間関係の形成とコミュニケーションの基礎）",
            "人間関係とコミュニケーション（2　チームマネジメント）",
        ],
    ),
    (
        "コミュニケーション技術",
        [
            "コミュニケーション技術（1　介護を必要とする人とのコミュニケーション）",
            "コミュニケーション技術（2　介護場面における家族とのコミュニケーション）",
            "コミュニケーション技術（3　障害の特性に応じたコミュニケーション）",
            "コミュニケーション技術（4　介護におけるチームのコミュニケーション）",
        ],
    ),
    (
        "発達と老化の理解",
        [
            "発達と老化の理解（1　人間の成長と発達の基礎的理解）",
            "発達と老化の理解（2　老化に伴うこころとからだの変化と生活）",
        ],
    ),
    (
        "認知症の理解",
        [
            "認知症の理解（1　認知症を取り巻く状況）",
            "認知症の理解（2　認知症の医学的・心理的側面の基礎的理解）",
            "認知症の理解（3　認知症に伴う生活への影響と認知症ケア）",
            "認知症の理解（4　連携と協働）",
            "認知症の理解（5　家族への支援）",
        ],
    ),
    (
        "障害の理解",
        [
            "障害の理解（1　障害の基礎的理解）",
            "障害の理解（2　障害の医学的・心理的側面の基礎的理解）",
            "障害の理解（3　障害のある人の生活と障害の特性に応じた支援）",
            "障害の理解（4　連携と協働）",
            "障害の理解（5　家族への支援）",
        ],
    ),
    (
        "こころとからだのしくみ",
        [
            "こころとからだのしくみ（1　こころのしくみの理解）",
            "こころとからだのしくみ（2　からだのしくみの理解）",
            "こころとからだのしくみ（3　移動に関連したこころとからだのしくみ）",
            "こころとからだのしくみ（4　身じたくに関連したこころとからだのしくみ）",
            "こころとからだのしくみ（5　食事に関連したこころとからだのしくみ）",
            "こころとからだのしくみ（6　入浴・清潔保持に関連したこころとからだのしくみ）",
            "こころとからだのしくみ（7　排泄に関連したこころとからだのしくみ）",
            "こころとからだのしくみ（8　休息・睡眠に関連したこころとからだのしくみ）",
            "こころとからだのしくみ（9　人生の最終段階のケアに関連したこころとからだのしくみ）",
        ],
    ),
]

RE_QID = re.compile(r"【\s*(\d+)\s*-\s*(\d+)")
RE_GROUP_CHILD_PAREN = re.compile(
    r"^(?:介護保険|障害者総合支援法|人体のしくみ|生活支援技術|医療的ケア|人間の尊厳と自立|介護の基本|社会の理解|人間関係とコミュニケーション|コミュニケーション技術|発達と老化の理解|認知症の理解|障害の理解|こころとからだのしくみ|法律|福祉の関連人物|利用者本位・自立支援|コミュニケーション|介護過程)（(.+)）$"
)

# 公開しない作業用テーマ（stem に含まれる文字列）
THEME_SRC_SKIP_SUBSTRINGS = ("削除問題", "削除検討", "全ての問題", "すべての問題", "除外", "確認")


def short_theme_label(title: str) -> str:
    """グループ内の子用の短い表示名（介護保険（理念）→ 理念）。"""
    m = RE_GROUP_CHILD_PAREN.match(title)
    text = m.group(1) if m else title
    # 番号と見出しのあいだの全角スペースを半角に（1　理念 → 1 理念）
    return re.sub(r"(\d)\u3000", r"\1 ", text)


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

KORYAKU_HTML_FILES = (
    "koryaku-kaigo-hoken.html",
    "koryaku-shogai-sogo.html",
    "hikaku-kaigo-shogai.html",
)
DEPLOY_STATIC = (
    "index.html",
    "view.html",
    "app.js",
    "style.css",
    "ruby.json",
    "themes.css",
    *KORYAKU_HTML_FILES,
)


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


def list_theme_source_files(base: Path, *, required: bool) -> list[Path]:
    if not base.is_dir():
        if required:
            raise FileNotFoundError(f"テーマ元フォルダがありません: {base}")
        return []
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


def part_titles(part: dict) -> set[str]:
    wanted_groups = set(part["groups"])
    titles = set(part["ungrouped"])
    for group_title, child_titles in THEME_GROUPS:
        if group_title in wanted_groups:
            titles.update(child_titles)
    return titles


def all_part_titles() -> set[str]:
    """A・B・Cパートに出す科目。重要テーマの一覧からは除く。"""
    titles: set[str] = set()
    for part in PART_SITES:
        titles.update(part_titles(part))
    return titles


def build_site(
    *,
    site_dir: Path,
    index_title: str,
    src_dir: Path,
    site_label: str,
    flat: bool = False,
    card_low: bool = False,
    only_titles: set[str] | None = None,
    exclude_titles: set[str] | None = None,
    group_order: list[str] | None = None,
    ungrouped_order: list[str] | None = None,
) -> list[dict]:
    sync_shared_assets(site_dir)
    data_dir = site_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    for old in data_dir.glob("*.json"):
        old.unlink()

    by_id = load_questions_by_id()
    if src_dir == THEME_SRC_DIR and only_titles is None:
        regenerate_illustration_theme_txt(by_id)
    sources = list_theme_source_files(src_dir, required=src_dir == THEME_SRC_DIR)
    if only_titles is not None:
        sources = [path for path in sources if path.stem in only_titles]
    if exclude_titles:
        sources = [path for path in sources if path.stem not in exclude_titles]
    if not sources:
        print(f"警告: {site_label}用 .txt がありません → {src_dir}")

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
                **({"cardLow": True} if card_low else {}),
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

    if group_order is not None:
        groups, ungrouped = build_grouped_index(themes)
        by_group = {group["title"]: group for group in groups}
        missing_groups = [name for name in group_order if name not in by_group]
        if missing_groups:
            raise RuntimeError(f"{site_label} に無いグループ: {', '.join(missing_groups)}")
        groups = [by_group[name] for name in group_order]
        by_flat = {theme["title"]: theme for theme in ungrouped}
        wanted_flat = ungrouped_order or []
        missing_flat = [name for name in wanted_flat if name not in by_flat]
        if missing_flat:
            raise RuntimeError(f"{site_label} に無い項目: {', '.join(missing_flat)}")
        ungrouped = [by_flat[name] for name in wanted_flat]
    elif flat:
        themes.sort(
            key=lambda t: (
                -int(t.get("displayCount") or 0),
                -int(t.get("count") or 0),
                str(t.get("title") or ""),
            )
        )
        groups, ungrouped = [], themes
    else:
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
        # 攻略ページは重要テーマのみ
        if name in KORYAKU_HTML_FILES and label != "重要テーマ":
            continue
        if not local_path.is_file():
            if name in KORYAKU_HTML_FILES:
                continue
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
        site_dir=REFERENCE_DIR,
        remote_dir=REMOTE_REFERENCE_DIR,
        public_url=PUBLIC_REFERENCE_URL,
        html_dir=REFERENCE_DIR,
        version=version,
        label="参考テーマ",
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
    for part in PART_SITES:
        key = part["key"]
        upload_one_site(
            ftps,
            site_dir=KAKOMON_DIR / f"part-{key}",
            remote_dir=f"{REMOTE_BASE_DIR}/kaigo/kakomon/part-{key}",
            public_url=f"https://nihongo.site/kaigo/kakomon/part-{key}/",
            html_dir=KAKOMON_DIR / f"part-{key}",
            version=version,
            label=part["label"],
        )
    ftps.quit()


def build_kaigo_koryaku() -> None:
    """攻略（正解マップ）HTML/MD/JSON を生成（介護保険・障害者総合支援法）。"""
    script = ROOT / "work" / "study" / "build_kaigo_koryaku.py"
    if not script.is_file():
        print("警告: 攻略の生成スクリプトがありません")
        return
    import subprocess

    subprocess.run([sys.executable, str(script)], check=True)


def build_hikaku() -> None:
    """介護保険×障害総合の対応比較表 HTML（比較表セクションのみ）。"""
    script = ROOT / "work" / "study" / "build_hikaku.py"
    if not script.is_file():
        print("警告: 比較表の生成スクリプトがありません")
        return
    import subprocess

    subprocess.run([sys.executable, str(script)], check=True)


def upload_hikaku_only() -> None:
    """比較表ページと、一覧導線に必要な themes 静的ファイルだけ FTP。"""
    version = make_cache_bust_version()
    ftps = FTP_TLS()
    ftps.connect(FTP_HOST, 21, timeout=30)
    ftps.login(FTP_USER, FTP_PASS)
    ftps.prot_p()
    ftps.set_pasv(True)
    ensure_remote_dir(ftps, REMOTE_THEMES_DIR)
    names = (
        "hikaku-kaigo-shogai.html",
        "app.js",
        "themes.css",
        "style.css",
        "ruby.json",
    )
    for name in names:
        local_path = THEMES_DIR / name
        if not local_path.is_file():
            raise FileNotFoundError(f"不足: {local_path}")
        if name.endswith(".html"):
            content = prepare_html(local_path.read_text(encoding="utf-8"), version)
            ftps.storbinary(f"STOR {name}", io.BytesIO(content.encode("utf-8")))
        else:
            with local_path.open("rb") as f:
                ftps.storbinary(f"STOR {name}", f)
        print(f"[比較表] アップロード完了: {name}")
    ensure_remote_dir(ftps, f"{REMOTE_THEMES_DIR}/data")
    hikaku_json = THEMES_DIR / "data" / "hikaku-kaigo-shogai.json"
    if not hikaku_json.is_file():
        raise FileNotFoundError(f"不足: {hikaku_json}")
    with hikaku_json.open("rb") as f:
        ftps.storbinary("STOR hikaku-kaigo-shogai.json", f)
    print("[比較表] アップロード完了: data/hikaku-kaigo-shogai.json")
    ftps.quit()
    print(f"[比較表] 公開URL: {PUBLIC_THEMES_URL}hikaku-kaigo-shogai.html?_cb={version}")


def main() -> int:
    parser = argparse.ArgumentParser(description="重要テーマ過去問を生成・デプロイ")
    parser.add_argument(
        "--build-only",
        action="store_true",
        help="FTPせず JSON と共有アセットだけ生成",
    )
    parser.add_argument(
        "--hikaku-only",
        action="store_true",
        help="対応比較表だけ生成して FTP（他サイトは触らない）",
    )
    args = parser.parse_args()
    try:
        if args.hikaku_only:
            # 問題カード用に攻略 JSON が必要（なければ生成）
            need_koryaku = not (THEMES_DIR / "data" / "koryaku-kaigo-hoken.json").is_file() or not (
                THEMES_DIR / "data" / "koryaku-shogai-sogo.json"
            ).is_file()
            if need_koryaku:
                build_kaigo_koryaku()
            build_hikaku()
            if not args.build_only:
                upload_hikaku_only()
            return 0

        build_site(
            site_dir=THEMES_DIR,
            index_title="重要テーマ",
            src_dir=THEME_SRC_DIR,
            site_label="重要テーマ",
            exclude_titles=all_part_titles(),
        )
        # data/ 再生成の後に置く（build_site が data/*.json を消すため）
        build_kaigo_koryaku()
        build_hikaku()
        build_site(
            site_dir=REFERENCE_DIR,
            index_title="参考テーマ",
            src_dir=REFERENCE_SRC_DIR,
            site_label="参考テーマ",
            flat=True,
            card_low=True,
        )
        build_site(
            site_dir=APPENDIX_DIR,
            index_title="付録",
            src_dir=APPENDIX_SRC_DIR,
            site_label="付録",
        )
        for part in PART_SITES:
            key = part["key"]
            build_site(
                site_dir=KAKOMON_DIR / f"part-{key}",
                index_title=f"{part['label']}",
                src_dir=PART_SRC_DIR / part["folder"],
                site_label=part["label"],
                only_titles=part_titles(part),
                group_order=part["groups"],
                ungrouped_order=part["ungrouped"],
            )
        if not args.build_only:
            upload_sites()
    except Exception as err:
        print(str(err), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
