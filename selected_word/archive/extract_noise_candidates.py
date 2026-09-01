#!/usr/bin/env python3
"""
extracted.csv から、ChatGPT 重要語選定の前に除外候補をルールで切り出す。

入力:
  extracted.csv       … 単語,出現回数
  db_words.csv        … 登録済み（あれば除外）
  requested.csv       … 希望語（あれば除外しない）
  noise_blocklist.txt … 手動除外（あれば）

出力（上書きしない）:
  noise_candidates.csv    … 除外候補（単語,出現回数,ルール,理由）
  extracted_for_chatgpt.csv … 除外後のリスト

使い方:
  python3 extract_noise_candidates.py
  python3 extract_noise_candidates.py --mode strict
  python3 extract_noise_candidates.py --min-count 2   # 出現2回以下も低頻度ルール対象
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from dataclasses import dataclass
from pathlib import Path

DIR = Path(__file__).resolve().parent
EXTRACTED_CSV = DIR / "extracted.csv"
DB_WORDS_CSV = DIR / "db_words.csv"
REQUESTED_CSV = DIR / "requested.csv"
BLOCKLIST_TXT = DIR / "noise_blocklist.txt"
NOISE_OUT_CSV = DIR / "noise_candidates.csv"
FILTERED_OUT_CSV = DIR / "extracted_for_chatgpt.csv"

KATAKANA_RE = re.compile(r"^[ァ-ヴー・]+$")
LATIN_ABBR_RE = re.compile(r"^[A-Z0-9]{2,6}$")

# 施設種別・制度名（プロンプトの「選ばない」例）
FACILITY_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"デイサービス", "施設種別"),
    (r"介護老人", "施設種別"),
    (r"サービス付き高齢者", "施設種別"),
    (r"指定介護老人", "施設種別"),
    (r"老人保健施設", "施設種別"),
    (r"グループホーム", "施設種別"),
    (r"特別養護老人ホーム", "施設種別"),
    (r"有料老人ホーム", "施設種別"),
)

LAW_INSTITUTION_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"厚生労働省", "制度・法令"),
    (r"法定雇用率", "制度・法令"),
    (r"国家試験", "制度・法令"),
    (r"社会保険庁", "制度・法令"),
    (r"雇用対策", "制度・法令"),
    (r"介護保険法", "制度・法令"),
    (r"障害者総合支援法", "制度・法令"),
)

MEDICAL_ABBR_WORDS = frozenset({
    "ADL", "IADL", "ICF", "ALS", "BPSD", "QOL", "MR", "CT", "MRI", "ECG", "CPAP",
})

MEDICAL_DEVICE_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"カテーテル", "医療機器"),
    (r"カニューレ", "医療機器"),
    (r"ストーマ", "医療機器"),
    (r"ペースメーカー", "医療機器"),
)

CONSUMER_LEISURE_KEYWORDS: tuple[tuple[str, str], ...] = (
    (r"ペットフード", "日用品・娯楽"),
    (r"コーヒー", "日用品・娯楽"),
    (r"スーパー", "日用品・娯楽"),
    (r"財布", "日用品・娯楽"),
    (r"チーズ", "日用品・娯楽"),
    (r"ヨーグルト", "日用品・娯楽"),
    (r"アスパラガス", "日用品・娯楽"),
    (r"温泉", "日用品・娯楽"),
    (r"アニメ", "日用品・娯楽"),
    (r"グッズ", "日用品・娯楽"),
    (r"クイズ", "日用品・娯楽"),
    (r"花柄", "日用品・娯楽"),
    (r"無地", "日用品・娯楽"),
    (r"出張", "日用品・娯楽"),
    (r"泊まり", "日用品・娯楽"),
    (r"エコノミー", "日用品・娯楽"),
    (r"サンダル", "日用品・娯楽"),
    (r"バスマット", "日用品・娯楽"),
)

NATURE_LOW_FREQ_WORDS = frozenset({
    "太陽", "月", "星", "宇宙", "天気", "台風", "地震", "噴火",
})

# strict モード: 低頻度の解剖・疾患っぽい語
ANATOMY_STRICT_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"(?:咽頭|頸髄|下垂体|幽門|噴門|胃底|小弯|大弯|空腸|回腸|右肺|左肺|上端|下端)$", "解剖部位"),
    (r"(?:梗塞|脳梗塞|心筋梗塞)$", "疾患名"),
    (r"(?:がん|癌)$", "疾患名"),
    (r"症候群$", "疾患名"),
)

DAILY_BEGINNER_STRICT = frozenset({
    "コーヒー", "スーパー", "財布", "タオル", "孫", "長女", "趣味", "住宅", "衣服",
})


@dataclass(frozen=True)
class WordRow:
    word: str
    count: int


@dataclass(frozen=True)
class NoiseHit:
    rule: str
    reason: str


def load_word_rows(path: Path) -> list[WordRow]:
    if not path.exists():
        raise FileNotFoundError(f"ファイルが見つかりません: {path}")

    rows: list[WordRow] = []
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.reader(f):
            if not row:
                continue
            word = row[0].strip()
            if not word or word.startswith("#"):
                continue
            try:
                count = int(row[1].strip()) if len(row) > 1 else 0
            except ValueError:
                count = 0
            rows.append(WordRow(word=word, count=count))
    return rows


def load_word_set(path: Path) -> set[str]:
    if not path.exists():
        return set()
    words: set[str] = set()
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.reader(f):
            if not row:
                continue
            word = row[0].strip()
            if word and not word.startswith("#"):
                words.add(word)
    return words


def load_blocklist(path: Path) -> set[str]:
    if not path.exists():
        return set()
    words: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        words.add(line.split("#", 1)[0].strip())
    return words


def match_patterns(word: str, patterns: tuple[tuple[str, str], ...]) -> NoiseHit | None:
    for pattern, label in patterns:
        if re.search(pattern, word):
            return NoiseHit(rule="pattern", reason=label)
    return None


def classify_noise(
    row: WordRow,
    *,
    mode: str,
    min_count: int,
    db_words: set[str],
    blocklist: set[str],
    protect: set[str],
) -> NoiseHit | None:
    word = row.word
    count = row.count

    if word in protect:
        return None

    if word in db_words:
        return NoiseHit(rule="db_registered", reason="db登録済み")

    if word in blocklist:
        return NoiseHit(rule="manual_blocklist", reason="手動除外リスト")

    hit = match_patterns(word, FACILITY_PATTERNS)
    if hit:
        return NoiseHit(rule="facility_type", reason=hit.reason)

    hit = match_patterns(word, LAW_INSTITUTION_PATTERNS)
    if hit:
        return NoiseHit(rule="law_institution", reason=hit.reason)

    if word in MEDICAL_ABBR_WORDS or LATIN_ABBR_RE.fullmatch(word):
        return NoiseHit(rule="medical_abbrev", reason="略語")

    hit = match_patterns(word, MEDICAL_DEVICE_PATTERNS)
    if hit:
        return NoiseHit(rule="medical_device", reason=hit.reason)

    for pattern, label in CONSUMER_LEISURE_KEYWORDS:
        if re.search(pattern, word):
            return NoiseHit(rule="consumer_leisure", reason=label)

    if count <= min_count and word in NATURE_LOW_FREQ_WORDS:
        return NoiseHit(rule="nature_low_freq", reason="自然・天文（低頻度）")

    # 低頻度カタカナ外来語（一般読解に必須でないことが多い）
    if count <= min_count and KATAKANA_RE.fullmatch(word) and len(word) >= 3:
        return NoiseHit(rule="katakana_loanword_low_freq", reason="低頻度カタカナ")

    if mode == "strict":
        if word in DAILY_BEGINNER_STRICT and count <= 20:
            return NoiseHit(rule="daily_beginner", reason="初級日常語")

        hit = match_patterns(word, ANATOMY_STRICT_PATTERNS)
        if hit and count <= min_count:
            return NoiseHit(rule=hit.reason, reason=f"strict:{hit.reason}")

        # 人名・固有名っぽい長いカタカナ（例: ハヴィガースト）
        if count <= min_count and KATAKANA_RE.fullmatch(word) and len(word) >= 6:
            if not re.search(r"(サービス|セラピー|ケア|メンタル|リハビリ|トレーニング)", word):
                return NoiseHit(rule="proper_noun_like", reason="固有名詞っぽいカタカナ")

    return None


def save_csv(path: Path, header: list[str], rows: list[list[str]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="extracted.csv から除外候補をルール抽出")
    parser.add_argument(
        "--mode",
        choices=("conservative", "strict"),
        default="conservative",
        help="conservative=誤除外を抑える / strict=解剖・疾患・固有名も低頻度で除外",
    )
    parser.add_argument(
        "--min-count",
        type=int,
        default=1,
        help="低頻度ルールの上限（既定: 1 = 出現1回のみ）",
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=EXTRACTED_CSV,
        help="入力 CSV（既定: extracted.csv）",
    )
    args = parser.parse_args()

    rows = load_word_rows(args.input)
    db_words = load_word_set(DB_WORDS_CSV)
    protect = load_word_set(REQUESTED_CSV)
    blocklist = load_blocklist(BLOCKLIST_TXT)

    noise_rows: list[list[str]] = []
    kept_rows: list[list[str]] = []
    rule_counts: dict[str, int] = {}

    for row in rows:
        hit = classify_noise(
            row,
            mode=args.mode,
            min_count=args.min_count,
            db_words=db_words,
            blocklist=blocklist,
            protect=protect,
        )
        if hit:
            noise_rows.append([row.word, str(row.count), hit.rule, hit.reason])
            rule_counts[hit.rule] = rule_counts.get(hit.rule, 0) + 1
        else:
            kept_rows.append([row.word, str(row.count)])

    save_csv(NOISE_OUT_CSV, ["単語", "出現回数", "ルール", "理由"], noise_rows)
    save_csv(FILTERED_OUT_CSV, ["単語", "出現回数"], kept_rows)

    print(f"入力              : {args.input.name} ({len(rows)} 語)")
    print(f"モード            : {args.mode} / min-count={args.min_count}")
    print(f"除外候補          : {len(noise_rows)} 語 -> {NOISE_OUT_CSV.name}")
    print(f"ChatGPT用残り     : {len(kept_rows)} 語 -> {FILTERED_OUT_CSV.name}")
    if protect:
        print(f"保護（requested） : {len(protect)} 語")
    print("ルール別件数:")
    for rule, n in sorted(rule_counts.items(), key=lambda x: (-x[1], x[0])):
        print(f"  {rule}: {n}")
    print("完了しました。")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as err:
        print("エラー:", err, file=sys.stderr)
        raise SystemExit(1)
