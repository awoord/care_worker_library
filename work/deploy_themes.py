#!/usr/bin/env python3
"""テーマ・参考テーマ・付録・カコモン・バンクを公開する。

- 入力: work/theme_extract/（重要テーマ）、work/part_extract/{A,B,C}/（各パート／バンク）、work/reference_extract/（参考テーマ）、work/appendix_extract/（付録）
- ファイル名（拡張子除く）→ ページ見出し
- 本文の 【回-番号｜…】 → questions.json から問題を抽出
- 表示は kakomon と同じカード形式（style / ルビ / 正誤UI）
- カコモン・バンク: 全科目を指導順で1ページにまとめる（/kaigo/kakomon/bank/）

使い方:
  python3 work/deploy_themes.py           # 全サイト生成＋FTP
  python3 work/deploy_themes.py --build-only
  python3 work/deploy_themes_site.py      # テーマだけ
  python3 work/deploy_appendix_site.py    # 付録だけ
  python3 work/deploy_themes_appendix.py  # テーマ＋付録を並列デプロイ
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
QUESTION_BANK_TXT = ROOT / "work" / "question_bank" / "question_bank_2027.txt"
BANK_DIR = KAKOMON_DIR / "bank"
RE_QB_PAGE = re.compile(r"【\s*(\d+)\s*-\s*(\d+)(?:｜[^】]*)?】\s*(\d+)\s*$")

FTP_HOST = "www1165.conoha.ne.jp"
FTP_USER = "ao@nihongo.site"
FTP_PASS = "highway#61"
REMOTE_BASE_DIR = "/public_html/nihongo.site"
REMOTE_THEMES_DIR = f"{REMOTE_BASE_DIR}/kaigo/kakomon/themes"
REMOTE_APPENDIX_DIR = f"{REMOTE_BASE_DIR}/kaigo/kakomon/appendix"
REMOTE_REFERENCE_DIR = f"{REMOTE_BASE_DIR}/kaigo/kakomon/reference"
REMOTE_BANK_DIR = f"{REMOTE_BASE_DIR}/kaigo/kakomon/bank"
PUBLIC_THEMES_URL = "https://nihongo.site/kaigo/kakomon/themes/"
PUBLIC_APPENDIX_URL = "https://nihongo.site/kaigo/kakomon/appendix/"
PUBLIC_REFERENCE_URL = "https://nihongo.site/kaigo/kakomon/reference/"
PUBLIC_BANK_URL = "https://nihongo.site/kaigo/kakomon/bank/"
# 国家試験のパート（出題順）。元ファイルは work/part_extract/{A,B,C}/。
PART_SITES = [
    {
        "key": "a",
        "folder": "A",
        "label": "Aパート（5年分）",
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
        "label": "Bパート（5年分）",
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
        "label": "Cパート（5年分）",
        "groups": ["介護過程"],
        "ungrouped": ["総合問題"],
    },
]

# カコモン・バンク（全科目1ページ）。指導用の科目順。
BANK_LABEL = "カコモン・バンク"
BANK_GROUP_ORDER = [
    # 介護
    "生活支援技術",
    "人間の尊厳と自立",
    "介護の基本",
    "介護過程",
    "人間関係とコミュニケーション",
    "コミュニケーション技術",
    # 医療
    "こころとからだのしくみ",
    "発達と老化の理解",
    "認知症の理解",
    "障害の理解",
    "医療的ケア",
    # 社会
    "社会の理解",
]
BANK_UNGROUPED_ORDER = ["総合問題"]
# 科目名先頭のパート記号（A/B/C）
SUBJECT_PART_LETTER: dict[str, str] = {
    "生活支援技術": "A",
    "人間の尊厳と自立": "A",
    "介護の基本": "A",
    "人間関係とコミュニケーション": "A",
    "コミュニケーション技術": "A",
    "社会の理解": "A",
    "こころとからだのしくみ": "B",
    "発達と老化の理解": "B",
    "認知症の理解": "B",
    "障害の理解": "B",
    "医療的ケア": "B",
    "介護過程": "C",
    "総合問題": "C",
}

# 国試1回あたりの科目配点（問題数）。カテゴリー名の末尾表示用。
SUBJECT_POINTS: dict[str, int] = {
    "人間の尊厳と自立": 2,
    "人間関係とコミュニケーション": 4,
    "社会の理解": 12,
    "介護の基本": 10,
    "コミュニケーション技術": 6,
    "生活支援技術": 26,
    "介護過程": 8,
    "発達と老化の理解": 8,
    "認知症の理解": 10,
    "障害の理解": 10,
    "こころとからだのしくみ": 12,
    "医療的ケア": 5,
    "総合問題": 12,
}

# 初期表示する直近回（見出しの問題数もこの範囲）
RECENT_SESSION_MIN = 34
RECENT_SESSION_MAX = 38
# 図あり問題を questions.json から自動生成するテーマ名
ILLUST_THEME_TITLE = "イラスト問題"
# 正答なし・複数正答の不適切問題を questions.json から自動生成するテーマ名
INAPPROPRIATE_THEME_TITLE = "不適切問題"
# カコモン・バンクでも全件・ファイル順で出す例外テーマ（通常のバンクは直近5年＋もっと見る）
SHOW_ALL_IN_ORDER_TITLES = frozenset(
    {
        "過去問の再利用",
        "同じ問題",
        "不適切問題",
        "テキスト",
        "優先して理解する問題",
        "利用者主体・自立支援（原則）",
        # 原則カテゴリー: 直近5年以外も全部表示（もっと見るなし）
        "利用者主体・自立支援の原則",
        "家族対応の原則",
        "職業倫理の前提",
        "チームアプローチの原則",
        "人の見方の原則",
        "コンプライアンスの原則",
        "コミュニケーションの原則",
        # 付録: 選択肢の分類（3問ずつ・全部表示）
        "選択肢の分類（語列挙）",
        "選択肢の分類（定義説明）",
        "選択肢の分類（全部適切に見える）",
        "選択肢の分類（1適切・他不適切）",
    }
)
# 旧「テキスト問題」「テキストピックアップ」と同じ公開URLを維持する
THEME_SLUG_OVERRIDES = {
    "テキスト": "b146eeffd742",
    "優先して理解する問題": "6086c77f15e0",
    # 旧「利用者本位・自立支援」／「（原則）」からの改名でも URL を維持
    "利用者主体・自立支援の原則": "510101d9c4a3",
    "利用者主体・自立支援（場面）": "6a8611151bc5",
}
TEXT_LEAD_THEME_TITLE = "優先して理解する問題"
TEXT_THEME_TITLE = "テキスト"

# 一覧の親グループ（見出し）→ 子テーマ（.txt の stem）。
# 空ならすべてフラット。括弧短縮ラベルはグループ内の子だけに使う。
# 親グループの並びは build_grouped_index で問数（count）降順に並べ替える。
# 子テーマの並びは各グループ内の定義順。
# 介護保険法・障害者総合支援法以外は、直近5年（第34〜38回）の多い順。
# 同数は全問数の多い順。それも同じなら前の並び。
THEME_GROUPS: list[tuple[str, list[str]]] = [
    (
        "選択肢の分類",
        [
            "選択肢の分類（語列挙）",
            "選択肢の分類（定義説明）",
            "選択肢の分類（全部適切に見える）",
            "選択肢の分類（1適切・他不適切）",
        ],
    ),
    (
        "NGワード",
        [
            "NGワード（説得）",
            "NGワード（画一的）",
            "NGワード（一律）",
            "NGワード（介護福祉職の判断で）",
            "NGワード（励ます）",
            "NGワード（限定）",
            "NGワード（控える（※例外あり））",
            "NGワード（避ける（※例外あり））",
            "NGワード（強く（※例外あり））",
            "NGワード（元気を出す）",
        ],
    ),
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
        "原則",
        [
            "利用者主体・自立支援の原則",
            "家族対応の原則",
            "職業倫理の前提",
            "チームアプローチの原則",
            "人の見方の原則",
            "コンプライアンスの原則",
            "コミュニケーションの原則",
        ],
    ),
    (
        "利用者主体・自立支援",
        [
            "利用者主体・自立支援（場面）",
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
    r"^(?:介護保険|障害者総合支援法|人体のしくみ|生活支援技術|医療的ケア|人間の尊厳と自立|介護の基本|社会の理解|人間関係とコミュニケーション|コミュニケーション技術|発達と老化の理解|認知症の理解|障害の理解|こころとからだのしくみ|法律|福祉の関連人物|利用者主体・自立支援|利用者本位・自立支援|コミュニケーション|介護過程|NGワード|ラッキーワード|選択肢の分類)（(.+)）$"
)

# theme_extract の .txt はすべて公開対象（作業用ファイルもファイル名で判別して落とさない）
THEME_SRC_SKIP_SUBSTRINGS: tuple[str, ...] = ()


def short_theme_label(title: str) -> str:
    """グループ内の子用の短い表示名（介護保険（理念）→ 理念）。"""
    m = RE_GROUP_CHILD_PAREN.match(title)
    text = m.group(1) if m else title
    # 番号と見出しのあいだの全角スペースを半角に（1　理念 → 1 理念）
    return re.sub(r"(\d)\u3000", r"\1 ", text)


def format_subject_label(
    title: str,
    *,
    points: int | None = None,
    letter_map: dict[str, str] | None = None,
) -> str:
    """科目表示名。letter_map があれば先頭に A/B/C を付ける。"""
    letter = (letter_map or {}).get(title, "")
    prefix = f"{letter} " if letter else ""
    if points is None:
        return f"{prefix}{title}" if prefix else title
    return f"{prefix}{title}（{points}）"


def apply_subject_points(
    groups: list[dict],
    ungrouped: list[dict],
    *,
    letter_map: dict[str, str] | None = None,
) -> None:
    """科目カテゴリーに国試配点を付け、表示ラベルへ反映する。"""
    for group in groups:
        title = str(group.get("title") or "")
        points = SUBJECT_POINTS.get(title)
        if points is not None:
            group["points"] = points
        elif not letter_map or title not in letter_map:
            continue
        group["label"] = format_subject_label(
            title, points=points, letter_map=letter_map
        )
    for theme in ungrouped:
        title = str(theme.get("title") or "")
        points = SUBJECT_POINTS.get(title)
        if points is not None:
            theme["points"] = points
        elif not letter_map or title not in letter_map:
            continue
        theme["label"] = format_subject_label(
            title, points=points, letter_map=letter_map
        )


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
    "hikaku-jinbutsu.html",
    "hikaku-jiritsu.html",
    "hikaku-jiritsu-kata.html",
    "hikaku-jiritsu-vs.html",
    "hikaku-jiritsu-ng.html",
    "hikaku-kaigo-katei.html",
    "hikaku-icf.html",
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
    if title in THEME_SLUG_OVERRIDES:
        return THEME_SLUG_OVERRIDES[title]
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


# 第38回は QB 未収録のため、教科書末尾扱いの表記
QB_ROUND_38_LABEL = "528〜"


def load_qb_pages_from_bank() -> dict[str, int | str]:
    """question_bank_*.txt から id → 教科書ページ番号（または第38回の「528〜」）。

    第29回も含む（表示用。questions.json は更新しない）。
    """
    mapping: dict[str, int | str] = {}
    if not QUESTION_BANK_TXT.is_file():
        return mapping
    for raw in QUESTION_BANK_TXT.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = RE_QB_PAGE.match(line)
        if not m:
            continue
        qid = f"{int(m.group(1))}-{int(m.group(2))}"
        mapping[qid] = int(m.group(3))
    # 第38回はバンクにページが無いので、他年度のあと・問題番号順用にラベルだけ付ける
    for n in range(1, 126):
        mapping[f"38-{n}"] = QB_ROUND_38_LABEL
    return mapping


def sort_text_theme_questions_by_qb(questions: list[dict]) -> list[dict]:
    """テキスト: 科目内は QB ページ順。第38回は末尾・問題番号順。"""

    def sort_key(q: dict) -> tuple:
        try:
            round_n = int(q.get("round") or 0)
        except (TypeError, ValueError):
            round_n = 0
        try:
            number_n = int(q.get("number") or 0)
        except (TypeError, ValueError):
            number_n = 0
        if round_n == 38:
            return (1, 0, number_n, round_n)
        qb = q.get("qb")
        if isinstance(qb, int):
            page = qb
        else:
            try:
                page = int(qb)  # type: ignore[arg-type]
            except (TypeError, ValueError):
                page = 10**9
        return (0, page, number_n, round_n)

    return sorted(questions, key=sort_key)


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


def _write_appendix_theme_txt(title: str, items: list[dict]) -> None:
    items = sorted(
        items,
        key=lambda q: (
            -int(q.get("round") or 0),
            int(q.get("number") or 0),
        ),
    )
    lines: list[str] = []
    for q in items:
        qid = str(q.get("id") or "").strip()
        if not qid:
            qid = f"{int(q.get('round') or 0)}-{int(q.get('number') or 0)}"
        subject = str(q.get("subject") or "").strip()
        lines.append(f"【{qid}｜{subject}】")
    APPENDIX_SRC_DIR.mkdir(parents=True, exist_ok=True)
    out = APPENDIX_SRC_DIR / f"{title}.txt"
    out.write_text(("\n".join(lines) + ("\n" if lines else "")), encoding="utf-8")
    print(f"自動生成: appendix_extract/{out.name} → {len(lines)} 問")


def regenerate_illustration_theme_txt(by_id: dict[str, dict]) -> None:
    """questions.json から図あり問題を抽出し、イラスト問題.txt を自動生成する。"""
    items = [q for q in by_id.values() if question_has_figure(q)]
    _write_appendix_theme_txt(ILLUST_THEME_TITLE, items)


def question_is_inappropriate(question: dict) -> bool:
    """正答なし、または正答が複数ある不適切問題か。"""
    answers = question.get("answers")
    if answers is None:
        note = str(question.get("note") or "")
        return "正答なし" in note or "問題不成立" in note
    if isinstance(answers, list):
        return len(answers) != 1
    if isinstance(answers, str):
        raw = answers.strip()
        if raw in ("", "なし"):
            return True
        return len(parse_answer_like(raw) or []) != 1
    return False


def parse_answer_like(raw: str) -> list[int] | None:
    """カンマ区切り等の正答セルを番号リストへ（簡易）。"""
    nums: list[int] = []
    for part in raw.replace("・", ",").replace("と", ",").replace("/", ",").split(","):
        part = part.strip()
        if not part:
            continue
        try:
            n = int(part)
        except ValueError:
            continue
        if n not in nums:
            nums.append(n)
    return nums or None


def regenerate_inappropriate_theme_txt(by_id: dict[str, dict]) -> None:
    """正答なし・複数正答の問を抽出し、不適切問題.txt を自動生成する。"""
    items = [q for q in by_id.values() if question_is_inappropriate(q)]
    _write_appendix_theme_txt(INAPPROPRIATE_THEME_TITLE, items)


def annotate_inappropriate_question(question: dict) -> dict:
    """不適切の理由が note に無い場合、正答なし／複数正答の注釈を付ける。"""
    q = rewrite_question_assets(question)
    note = str(q.get("note") or "").strip()
    if "正答なし" in note or "問題不成立" in note or "不適切" in note:
        return q
    answers = q.get("answers")
    if answers is None or answers == [] or answers == "なし":
        q["note"] = "問題不成立のため、正答なし"
        return q
    if isinstance(answers, list) and len(answers) > 1:
        joined = "・".join(str(n) for n in answers)
        q["note"] = f"不適切問題のため、正答が複数（{joined}）"
    return q


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


def ensure_bank_html() -> None:
    """カコモン・バンク用 HTML が無いときだけ雛形をコピーする（手編集を壊さない）。"""
    BANK_DIR.mkdir(parents=True, exist_ok=True)
    for name in ("index.html", "view.html"):
        dest = BANK_DIR / name
        if dest.is_file():
            continue
        raise FileNotFoundError(f"カコモン・バンク HTML がありません: {dest}")


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
    src_dir: Path | None = None,
    src_dirs: list[Path] | None = None,
    site_label: str,
    flat: bool = False,
    card_low: bool = False,
    only_titles: set[str] | None = None,
    exclude_titles: set[str] | None = None,
    group_order: list[str] | None = None,
    ungrouped_order: list[str] | None = None,
    letter_map: dict[str, str] | None = None,
    # True: 全件表示（もっと見るなし）。カコモン・バンク以外は基本 True。
    show_all_questions: bool = False,
) -> list[dict]:
    sync_shared_assets(site_dir)
    data_dir = site_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    for old in data_dir.glob("*.json"):
        old.unlink()

    by_id = load_questions_by_id()
    qb_pages = load_qb_pages_from_bank()
    dirs = list(src_dirs) if src_dirs else ([src_dir] if src_dir else [])
    if not dirs:
        raise ValueError(f"{site_label}: src_dir / src_dirs がありません")
    # 付録の自動テーマは appendix ビルド時に生成（イラストは themes 時にも更新）
    if THEME_SRC_DIR in dirs and only_titles is None:
        regenerate_illustration_theme_txt(by_id)
    if APPENDIX_SRC_DIR in dirs and only_titles is None:
        regenerate_illustration_theme_txt(by_id)
        regenerate_inappropriate_theme_txt(by_id)
    sources: list[Path] = []
    seen_stems: set[str] = set()
    for directory in dirs:
        required = directory == THEME_SRC_DIR and len(dirs) == 1
        for path in list_theme_source_files(directory, required=required):
            if path.stem in seen_stems:
                continue
            seen_stems.add(path.stem)
            sources.append(path)
    if only_titles is not None:
        sources = [path for path in sources if path.stem in only_titles]
    if exclude_titles:
        sources = [path for path in sources if path.stem not in exclude_titles]
    if not sources:
        shown = ", ".join(str(d) for d in dirs)
        print(f"警告: {site_label}用 .txt がありません → {shown}")

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
            if title == INAPPROPRIATE_THEME_TITLE:
                q = annotate_inappropriate_question(src)
            else:
                q = rewrite_question_assets(src)
            # 教科書ページはバンク対応表を正とする（questions.json は変更しない）
            if qid in qb_pages:
                q["qb"] = qb_pages[qid]
            questions.append(q)

        if title == "テキスト":
            questions = sort_text_theme_questions_by_qb(questions)

        # カコモン・バンク以外は全件表示。バンクのみ直近5年＋「あと5年分見る」。
        show_all = show_all_questions or title in SHOW_ALL_IN_ORDER_TITLES
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
            "ids": [
                q.get("id") or f"{q.get('round')}-{q.get('number')}" for q in questions
            ],
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

    # テキストページ先頭に出す「優先して理解する問題」へのリンク情報
    by_title = {theme["title"]: theme for theme in themes}
    if TEXT_THEME_TITLE in by_title and TEXT_LEAD_THEME_TITLE in by_title:
        text_meta = by_title[TEXT_THEME_TITLE]
        lead_meta = by_title[TEXT_LEAD_THEME_TITLE]
        text_path = data_dir / f"{text_meta['slug']}.json"
        text_payload = json.loads(text_path.read_text(encoding="utf-8"))
        text_payload["leadTheme"] = {
            "title": lead_meta["title"],
            "label": lead_meta.get("label") or lead_meta["title"],
            "slug": lead_meta["slug"],
            "count": lead_meta["count"],
            "displayCount": lead_meta["displayCount"],
            "href": lead_meta["href"],
        }
        text_path.write_text(
            json.dumps(text_payload, ensure_ascii=False, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )

    if group_order is not None:
        groups, ungrouped = build_grouped_index(themes)
        by_group = {group["title"]: group for group in groups}
        missing_groups = [name for name in group_order if name not in by_group]
        if missing_groups:
            raise RuntimeError(
                f"{site_label} に無いグループ: {', '.join(missing_groups)}"
            )
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
    apply_subject_points(groups, ungrouped, letter_map=letter_map)
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


def remove_remote_tree(ftps: FTP_TLS, path: str) -> None:
    """リモートのディレクトリを中身ごと削除（無ければ無視）。"""
    parts = [p for p in path.strip("/").split("/") if p]
    if not parts:
        return
    parent = "/" + "/".join(parts[:-1])
    name = parts[-1]
    try:
        ftps.cwd(parent)
    except Exception:
        print(f"スキップ: リモート無し → {path}")
        return

    def _wipe(dir_name: str) -> None:
        try:
            ftps.cwd(dir_name)
        except Exception:
            return
        for entry in list(ftps.nlst()):
            if entry in (".", ".."):
                continue
            try:
                ftps.delete(entry)
                continue
            except Exception:
                pass
            _wipe(entry)
            try:
                ftps.rmd(entry)
            except Exception:
                pass
        ftps.cwd("..")

    try:
        _wipe(name)
        ftps.cwd(parent)
        ftps.rmd(name)
        print(f"リモート削除: {path}")
    except Exception as err:
        print(f"警告: リモート削除できず {path}: {err}")


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
        if name in KORYAKU_HTML_FILES and label != "テーマ":
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
        label="テーマ",
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
    upload_one_site(
        ftps,
        site_dir=BANK_DIR,
        remote_dir=REMOTE_BANK_DIR,
        public_url=PUBLIC_BANK_URL,
        html_dir=BANK_DIR,
        version=version,
        label=BANK_LABEL,
    )
    for key in ("a", "b", "c"):
        remove_remote_tree(ftps, f"{REMOTE_BASE_DIR}/kaigo/kakomon/part-{key}")
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


def build_jinbutsu_hikaku() -> None:
    """福祉の関連人物攻略マップ HTML/JSON。"""
    script = ROOT / "work" / "study" / "build_jinbutsu_hikaku.py"
    if not script.is_file():
        print("警告: 人物攻略の生成スクリプトがありません")
        return
    import subprocess

    subprocess.run([sys.executable, str(script)], check=True)


def build_jiritsu_hikaku() -> None:
    """利用者本位・自立支援適切マップ HTML/JSON。"""
    script = ROOT / "work" / "study" / "build_jiritsu_hikaku.py"
    if not script.is_file():
        print("警告: 自立支援攻略の生成スクリプトがありません")
        return
    import subprocess

    subprocess.run([sys.executable, str(script)], check=True)


def build_jiritsu_ng_hikaku() -> None:
    """利用者本位・自立支援不適切マップ HTML/JSON。"""
    script = ROOT / "work" / "study" / "build_jiritsu_ng_hikaku.py"
    if not script.is_file():
        print("警告: 自立支援不適切マップの生成スクリプトがありません")
        return
    import subprocess

    subprocess.run([sys.executable, str(script)], check=True)


def build_kaigo_katei_hikaku() -> None:
    """介護過程攻略マップ HTML/JSON。"""
    script = ROOT / "work" / "study" / "build_kaigo_katei_hikaku.py"
    if not script.is_file():
        print("警告: 介護過程攻略の生成スクリプトがありません")
        return
    import subprocess

    subprocess.run([sys.executable, str(script)], check=True)


def build_icf_hikaku() -> None:
    """ICF攻略マップ HTML/JSON。"""
    script = ROOT / "work" / "study" / "build_icf_hikaku.py"
    if not script.is_file():
        print("警告: ICF攻略の生成スクリプトがありません")
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
        "hikaku-jinbutsu.html",
        "hikaku-jiritsu.html",
        "hikaku-jiritsu-kata.html",
        "hikaku-jiritsu-vs.html",
        "hikaku-jiritsu-ng.html",
        "hikaku-kaigo-katei.html",
        "hikaku-icf.html",
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
    for json_name in (
        "hikaku-kaigo-shogai.json",
        "hikaku-jinbutsu.json",
        "hikaku-jiritsu.json",
        "hikaku-jiritsu-kata.json",
        "hikaku-jiritsu-vs.json",
        "hikaku-jiritsu-ng.json",
        "hikaku-kaigo-katei.json",
        "hikaku-icf.json",
    ):
        hikaku_json = THEMES_DIR / "data" / json_name
        if not hikaku_json.is_file():
            raise FileNotFoundError(f"不足: {hikaku_json}")
        with hikaku_json.open("rb") as f:
            ftps.storbinary(f"STOR {json_name}", f)
        print(f"[比較表] アップロード完了: data/{json_name}")

    # 付録の導線（言い回しカード削除後の app.js など）
    sync_shared_assets(APPENDIX_DIR)
    ensure_remote_dir(ftps, REMOTE_APPENDIX_DIR)
    for name in ("app.js", "themes.css", "style.css", "ruby.json", "index.html"):
        local_path = APPENDIX_DIR / name
        if not local_path.is_file():
            raise FileNotFoundError(f"不足: {local_path}")
        if name.endswith(".html"):
            content = prepare_html(local_path.read_text(encoding="utf-8"), version)
            ftps.storbinary(f"STOR {name}", io.BytesIO(content.encode("utf-8")))
        else:
            with local_path.open("rb") as f:
                ftps.storbinary(f"STOR {name}", f)
        print(f"[付録] アップロード完了: {name}")
    for stale_name in ("hikaku-jiritsu-cards.html", "hikaku-jiritsu-cards.json"):
        try:
            if stale_name.endswith(".json"):
                ensure_remote_dir(ftps, f"{REMOTE_APPENDIX_DIR}/data")
            else:
                ensure_remote_dir(ftps, REMOTE_APPENDIX_DIR)
            ftps.delete(stale_name)
            print(f"[付録] リモート削除: {stale_name}")
        except Exception as err:
            print(f"[付録] リモート削除スキップ {stale_name}: {err}")

    ftps.quit()
    print(
        f"[比較表] 公開URL: {PUBLIC_THEMES_URL}hikaku-kaigo-shogai.html?_cb={version}"
    )
    print(
        f"[人物攻略] 公開URL: {PUBLIC_THEMES_URL}hikaku-jinbutsu.html?_cb={version}"
    )
    print(
        f"[自立支援適切] 公開URL: {PUBLIC_THEMES_URL}hikaku-jiritsu.html?_cb={version}"
    )
    print(
        f"[自立支援比較] 公開URL: {PUBLIC_THEMES_URL}hikaku-jiritsu-kata.html?_cb={version}"
    )
    print(
        f"[自立支援言い回し対比] 公開URL: {PUBLIC_THEMES_URL}hikaku-jiritsu-vs.html?_cb={version}"
    )
    print(
        f"[自立支援不適切] 公開URL: {PUBLIC_THEMES_URL}hikaku-jiritsu-ng.html?_cb={version}"
    )
    print(
        f"[介護過程攻略] 公開URL: {PUBLIC_THEMES_URL}hikaku-kaigo-katei.html?_cb={version}"
    )
    print(
        f"[ICF攻略] 公開URL: {PUBLIC_THEMES_URL}hikaku-icf.html?_cb={version}"
    )


def build_themes_site() -> None:
    """テーマ（+攻略・比較表）だけローカル生成。"""
    build_site(
        site_dir=THEMES_DIR,
        index_title="テーマ",
        src_dir=THEME_SRC_DIR,
        site_label="テーマ",
        exclude_titles=all_part_titles(),
        show_all_questions=True,
    )
    # data/ 再生成の後に置く（build_site が data/*.json を消すため）
    build_kaigo_koryaku()
    build_hikaku()
    build_jinbutsu_hikaku()
    build_jiritsu_hikaku()
    build_jiritsu_ng_hikaku()
    build_kaigo_katei_hikaku()
    build_icf_hikaku()


def build_appendix_site() -> None:
    """付録だけローカル生成。"""
    build_site(
        site_dir=APPENDIX_DIR,
        index_title="付録",
        src_dir=APPENDIX_SRC_DIR,
        site_label="付録",
        show_all_questions=True,
    )


def _open_ftps() -> FTP_TLS:
    ftps = FTP_TLS()
    ftps.connect(FTP_HOST, 21, timeout=30)
    ftps.login(FTP_USER, FTP_PASS)
    ftps.prot_p()
    ftps.set_pasv(True)
    return ftps


def upload_themes_site(*, version: str | None = None) -> str:
    """テーマサイトだけ FTP アップロード。cache-bust 用 version を返す。"""
    version = version or make_cache_bust_version()
    ftps = _open_ftps()
    try:
        upload_one_site(
            ftps,
            site_dir=THEMES_DIR,
            remote_dir=REMOTE_THEMES_DIR,
            public_url=PUBLIC_THEMES_URL,
            html_dir=THEMES_DIR,
            version=version,
            label="テーマ",
        )
    finally:
        ftps.quit()
    return version


def upload_appendix_site(*, version: str | None = None) -> str:
    """付録サイトだけ FTP アップロード。cache-bust 用 version を返す。"""
    version = version or make_cache_bust_version()
    ftps = _open_ftps()
    try:
        upload_one_site(
            ftps,
            site_dir=APPENDIX_DIR,
            remote_dir=REMOTE_APPENDIX_DIR,
            public_url=PUBLIC_APPENDIX_URL,
            html_dir=APPENDIX_DIR,
            version=version,
            label="付録",
        )
    finally:
        ftps.quit()
    return version


def deploy_themes_site(*, build_only: bool = False) -> None:
    build_themes_site()
    if not build_only:
        upload_themes_site()


def deploy_appendix_site(*, build_only: bool = False) -> None:
    build_appendix_site()
    if not build_only:
        upload_appendix_site()


def main() -> int:
    parser = argparse.ArgumentParser(description="テーマ過去問を生成・デプロイ")
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
    parser.add_argument(
        "--themes-only",
        action="store_true",
        help="テーマ（+攻略）だけ生成・FTP",
    )
    parser.add_argument(
        "--appendix-only",
        action="store_true",
        help="付録だけ生成・FTP",
    )
    args = parser.parse_args()
    try:
        if args.hikaku_only:
            # 問題カード用に攻略 JSON が必要（なければ生成）
            need_koryaku = (
                not (THEMES_DIR / "data" / "koryaku-kaigo-hoken.json").is_file()
                or not (THEMES_DIR / "data" / "koryaku-shogai-sogo.json").is_file()
            )
            if need_koryaku:
                build_kaigo_koryaku()
            build_hikaku()
            build_jinbutsu_hikaku()
            build_jiritsu_hikaku()
            build_jiritsu_ng_hikaku()
            build_kaigo_katei_hikaku()
            build_icf_hikaku()
            if not args.build_only:
                upload_hikaku_only()
            return 0

        if args.themes_only:
            deploy_themes_site(build_only=args.build_only)
            return 0

        if args.appendix_only:
            deploy_appendix_site(build_only=args.build_only)
            return 0

        build_themes_site()
        build_site(
            site_dir=REFERENCE_DIR,
            index_title="参考テーマ",
            src_dir=REFERENCE_SRC_DIR,
            site_label="参考テーマ",
            flat=True,
            card_low=True,
            show_all_questions=True,
        )
        build_appendix_site()
        ensure_bank_html()
        build_site(
            site_dir=BANK_DIR,
            index_title=BANK_LABEL,
            src_dirs=[PART_SRC_DIR / part["folder"] for part in PART_SITES],
            site_label=BANK_LABEL,
            only_titles=all_part_titles(),
            group_order=BANK_GROUP_ORDER,
            ungrouped_order=BANK_UNGROUPED_ORDER,
            letter_map=SUBJECT_PART_LETTER,
        )
        # 旧 A/B/C パート公開ディレクトリはローカルからも削除
        for key in ("a", "b", "c"):
            old = KAKOMON_DIR / f"part-{key}"
            if old.is_dir():
                shutil.rmtree(old)
                print(f"削除: {old}")
        if not args.build_only:
            upload_sites()
    except Exception as err:
        print(str(err), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
