#!/usr/bin/env python3
"""最も適切なもの Layer A：残 weak 行の磨き直し

Style:
  ✕ = 制度・役割の正体＋この設問の手がかりに合わない理由（1〜2文）
  語尾を避けたい: ではありません / 適切ではありません / いえません 等
  ○ は現状維持（弱いでない行は書き換えない）
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EXPLAIN_DIR = ROOT / "explains"
QUEUE_JSON = ROOT / "explains_mottomo_A_queue.json"
REVIEW_MD = ROOT / "explains_mottomo_A_needs_review.md"
REPORT_MD = ROOT / "explains_mottomo_A_report.md"

WEAK_END_RE = re.compile(
    r"(ではありません|適切ではありません|正しくありません|誤りです|いえません|考えにくいです)[。．]?$"
)

# qid -> {choice: explain}  （弱い行のみ。適用時に既存へマージ）
UPDATES: dict[str, dict[str, str]] = {
    "29-16": {
        "1": "障害福祉計画の策定は市町村などが行うもので、協議会の役割は支援体制の課題共有です。",
        "2": "相談支援事業所への評価は別の仕組みが担い、協議会は支援体制の課題を共有する場です。",
        "3": "個別支援計画はサービス事業所などが作成し、協議会は体制の課題共有が役割です。",
        "4": "苦情解決は事業所の苦情解決体制などが担い、協議会は支援体制の課題共有が役割です。",
    },
    "29-17": {
        "3": "訪問介護は身体介護・生活援助が中心で、家賃の集金までは担いません。",
    },
    "31-11": {
        "1": "通所介護計画の変更は事業所単独で先に行うのではなく、まず担当ケアマネによる全体の再調整が先です。",
        "4": "児童相談所は児童虐待・養育相談などが中心で、保育所入所困難の第一の窓口は別です。",
    },
    "31-16": {
        "1": "援護・措置の事務は行政職員などが担い、社会福祉士の主たる業務は相談援助です。",
    },
    "31-17": {
        "2": "介護保険審査会は処分への不服申立などが中心で、事業所への苦情はまず事業所の苦情対応窓口です。",
        "5": "日常生活自立支援事業は福祉サービスの利用援助・金銭管理などで、苦情解決の仕組みとは別です。",
    },
    "31-68": {
        "1": "オペレーターは随時の通報を受ける職員で、サービス提供責任者とは別に置かれます。",
    },
    "32-12": {
        "1": "地域包括支援センターは主に高齢者の総合相談窓口で、障害福祉の支給申請は市町村窓口です。",
    },
    "32-23": {
        "4": "日常的な金銭管理は日常生活自立支援事業や成年後見などが担い、サービス提供責任者の役割外です。",
    },
    "32-24": {
        "3": "医療と介護の連携は日常の情報共有や協働も含み、体調不良時の受診だけに限りません。",
        "4": "多職種連携のプランは要介護度の改善だけを優先するのではなく、本人の意向を中心にします。",
    },
    "33-13": {
        "2": "介護保険の第1号被保険者は原則65歳からです。",
    },
    "33-23": {
        "2": "介護医療院の開設許可は、都道府県知事などが行います。",
        "4": "入所者一人当たりの床面積は、介護老人福祉施設とは別の基準です。",
        "5": "サービス管理責任者の必置は障害福祉サービスの要件で、介護医療院には求められません。",
    },
    "33-24": {
        "5": "通所介護の入浴は、「外出して食材を選びたい」思いへの提案にはなりません。",
    },
    "34-2": {
        "2": "ハローワークの紹介は就労支援で、虐待への対応にはなりません。",
        "4": "長男への直接の事実確認は、本人の安全を脅かすおそれがあります。",
    },
    "34-16": {
        "2": "生活保護の申請は、本人や家族などが行います。",
        "4": "生活保護を担当する職員に、社会福祉士の資格は必須とされていません。",
        "5": "生活保護の費用は、国と地方が分担します。",
    },
    "34-21": {
        "4": "家でのリハビリテーション依頼は、家事・勉強の不安への対応にはなりません。",
    },
    "35-17": {
        "2": "ハローワークへの正規雇用相談は就労支援で、母親の認知症への助言にはなりません。",
        "3": "Ｇさんの発達障害の治療勧奨は、今回の「二人で暮らし続けたい」相談の主題から外れます。",
    },
    "36-9": {
        "1": "世界保健機関（ＷＨＯ）は国際的な保健機関で、19世紀後半の住み込み援助の活動とは別です。",
        "2": "福祉事務所は生活保護などの行政窓口で、19世紀後半の住み込み援助とは別です。",
        "3": "地域包括支援センターは高齢者の総合相談機関で、近代のセツルメント運動とは別です。",
        "4": "生活協同組合は協同組合による生活向上の組織で、貧困地域への住み込み援助そのものとは異なります。",
    },
    "36-14": {
        "1": "移動支援は地域生活支援事業で、介護給付費の対象外です。",
        "2": "行動援護は知的・精神障害などで行動上著しい困難がある人が対象で、視覚障害者向けの同行援護とは別です。",
        "3": "同行援護は視覚障害者が対象で、知的障害者向けの行動援護とは別です。",
        "5": "共同生活援助（グループホーム）は住まいの場で、外出支援を主目的とするサービスとは異なります。",
    },
    "36-15": {
        "1": "公正取引委員会は競争政策などが中心で、個別の電話勧誘の第一の相談先は消費生活センターです。",
        "2": "都道府県障害者権利擁護センターは障害者虐待対応などが中心で、消費トラブルは消費生活センターが窓口です。",
        "5": "市町村保健センターは保健・健康相談が中心で、消費勧誘の相談は消費生活センターが向いています。",
    },
    "36-18": {
        "1": "地域包括支援センターは主に高齢者向けで、55歳の生活困窮はまず福祉事務所が窓口です。",
        "3": "精神保健福祉センターは精神保健の専門相談で、障害の有無が不明な生活困窮の第一窓口は福祉事務所です。",
        "4": "公共職業安定所は就労相談が中心で、当面の生活困窮はまず福祉事務所が窓口です。",
        "5": "年金事務所は年金手続きが中心で、生活全般の困りごとは福祉事務所が窓口です。",
    },
    "36-68": {
        "1": "掃除や洗濯の方法を教えることは家事支援で、いまの情緒的な孤立への対応にはなりません。",
        "5": "いまの相談は長女の孤立感が中心で、介護サービスの変更を提案する場面とは異なります。",
    },
    "36-69": {
        "2": "浴室を広くする改築は大がかりで、まず入浴補助用具などの検討が先です。",
        "5": "通所介護の入浴は施設での入浴で、「自宅での入浴を続けたい」相談の第一の答えにはなりません。",
    },
    "37-12": {
        "5": "居宅療養管理指導は医師等の療養管理で、日中の話し相手への対応にはなりません。",
    },
    "37-18": {
        "5": "年金制度は所得保障で、医療費の支払いには使いません。",
    },
    "37-72": {
        "3": "個別避難計画は主に市町村が作成するもので、施設長への義務づけとは別です。",
    },
    "38-6": {
        "3": "自発的活動支援は障害者の社会参加活動などで、なじみの店での買物支援とは異なります。",
    },
    "38-9": {
        "1": "義歯を作成するのは歯科医師の役割で、歯科衛生士は口腔ケアなどを担います。",
        "2": "車いすの貸与は福祉用具貸与などで行い、看護師の役割とは異なります。",
        "3": "訪問介護計画の作成はサービス提供責任者の役割で、介護支援専門員は居宅サービス計画を作ります。",
        "4": "下肢の機能訓練は理学療法士などの役割で、福祉用具専門相談員は用具の選定相談を担います。",
    },
    "38-18": {
        "1": "補装具の判定は身体障害者更生相談所などが行い、地域活動支援センターは創作・生産活動や交流の場です。",
        "5": "利用者負担の額は法令の基準などで決まり、市町村障害福祉計画の策定内容とは別です。",
    },
    "38-20": {
        "1": "民生委員からの地域課題の相談は受けとめ、本人来所だけを促して門前払いしません。",
        "2": "すぐに個人のケアプランを作成するのは個人対応で、地域の見守り不足という課題への答えにはなりません。",
        "5": "介護保険審査会は要介護認定の審査判定機関で、実態把握のために置くものとは異なります。",
    },
}

# 新たに要確認へ追加するもの（既存 qid はスキップ）
UNCERTAIN: list[tuple[str, str]] = [
    (
        "36-14",
        "移動支援が地域生活支援事業（介護給付費の対象外）であることの教科書表現は確認推奨。",
    ),
    (
        "38-9",
        "老健カンファでの職種役割（義歯作成・車いす貸与・訪問介護計画・機能訓練）の境界表現は教科書対照推奨。",
    ),
]


def apply_updates(updates: dict[str, dict[str, str]]) -> tuple[list[str], int]:
    by_session: dict[int, dict[str, dict[str, str]]] = {}
    for qid, patch in updates.items():
        session = int(qid.split("-")[0])
        by_session.setdefault(session, {})[qid] = patch
        for n, text in patch.items():
            if WEAK_END_RE.search(text.strip()):
                raise SystemExit(f"weak ending in UPDATES {qid}-{n}: {text}")

    changed: list[str] = []
    polished_lines = 0
    for session, qmap in sorted(by_session.items()):
        path = EXPLAIN_DIR / f"explains_{session}.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        for qid, patch in qmap.items():
            if qid not in data["items"]:
                raise SystemExit(f"missing {qid} in {path.name}")
            explains = dict(data["items"][qid]["explains"])
            for n, text in patch.items():
                if explains.get(n) != text:
                    polished_lines += 1
                explains[n] = text
            data["items"][qid]["explains"] = explains
            changed.append(qid)
        path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return changed, polished_lines


def sync_queue(updates: dict[str, dict[str, str]]) -> None:
    if not QUEUE_JSON.exists():
        return
    queue = json.loads(QUEUE_JSON.read_text(encoding="utf-8"))
    for it in queue:
        qid = it["id"]
        if qid not in updates:
            continue
        session = int(qid.split("-")[0])
        path = EXPLAIN_DIR / f"explains_{session}.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        it["explains"] = data["items"][qid]["explains"]
        # refresh weak fields
        ans = set(str(a) for a in it.get("answers") or [])
        weak_ns = [
            n
            for n, e in it["explains"].items()
            if n not in ans and WEAK_END_RE.search((e or "").strip())
        ]
        it["weak_ns"] = weak_ns
        it["weak"] = len(weak_ns)
    QUEUE_JSON.write_text(
        json.dumps(queue, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def append_review(uncertain: list[tuple[str, str]]) -> list[str]:
    if not uncertain:
        return []
    text = REVIEW_MD.read_text(encoding="utf-8") if REVIEW_MD.exists() else ""
    existing = set(re.findall(r"- `([^`]+)`:", text))
    added: list[str] = []
    lines_to_add: list[str] = []
    for qid, note in uncertain:
        if qid in existing:
            continue
        lines_to_add.append(f"- `{qid}`: {note}")
        added.append(qid)

    if not lines_to_add:
        return []

    section = "## ポリッシュ追加（要確認）"
    block = "\n".join([section, "", *lines_to_add, ""])
    if section in text:
        text = re.sub(
            rf"{re.escape(section)}\n.*?(?=\n## |\Z)",
            block.rstrip() + "\n\n",
            text,
            count=1,
            flags=re.S,
        )
        REVIEW_MD.write_text(text, encoding="utf-8")
    else:
        REVIEW_MD.write_text(text.rstrip() + "\n\n" + block, encoding="utf-8")
    return added


def recount_weak() -> tuple[int, int, int, list[tuple[str, int, str]]]:
    queue = json.loads(QUEUE_JSON.read_text(encoding="utf-8"))
    by_session: dict[int, dict] = {}
    details: list[tuple[str, int, str]] = []
    n_ge1 = n_ge2 = 0
    for it in queue:
        qid = it["id"]
        session = int(qid.split("-")[0])
        if session not in by_session:
            by_session[session] = json.loads(
                (EXPLAIN_DIR / f"explains_{session}.json").read_text(encoding="utf-8")
            )["items"]
        explains = by_session[session][qid]["explains"]
        ans = set(str(a) for a in (it.get("answers") or []))
        weak_ns = [
            n
            for n, e in explains.items()
            if n not in ans and WEAK_END_RE.search((e or "").strip())
        ]
        weak = len(weak_ns)
        if weak >= 1:
            n_ge1 += 1
            details.append((qid, weak, it.get("subject") or ""))
        if weak >= 2:
            n_ge2 += 1
    return len(queue), n_ge1, n_ge2, sorted(details, key=lambda x: (-x[1], x[0]))


def update_report(
    polished_q: int, polished_lines: int, n_ge1: int, n_ge2: int
) -> None:
    if not REPORT_MD.exists():
        return
    text = REPORT_MD.read_text(encoding="utf-8")

    # Ensure polish row in table
    polish_row = f"| polish | 残 weak 行の磨き直し（正体＋この手がかり） | {polished_q}問 / {polished_lines}行 |"
    if "| polish |" in text:
        text = re.sub(r"\| polish \|.*?\|", polish_row, text, count=1)
    elif "| **合計** |" in text:
        text = text.replace(
            "| **合計** |",
            polish_row + "\n| **合計** |",
        )

    # Update weak counts section
    new_section = (
        "## 最終 weak 集計（キュー77・現行 explains）\n"
        "\n"
        "ヒューリスティック語尾: `ではありません|適切ではありません|正しくありません|誤りです|いえません|考えにくいです`"
        "（正解選択肢は除外）\n"
        "\n"
        "| 指標 | 件数 |\n"
        "|------|------|\n"
        f"| weak≥1 | **{n_ge1}** |\n"
        f"| weak≥2 | **{n_ge2}** |\n"
        "\n"
        "改訂前ダンプ: weak≥1=60 / weak≥2=50  \n"
        f"初回パッチ後: weak≥1=29 / weak≥2=17  \n"
        f"ポリッシュ後: weak≥1={n_ge1} / weak≥2={n_ge2}（{polished_q}問・{polished_lines}行を磨き直し）\n"
    )
    text = re.sub(
        r"## 最終 weak 集計.*?(?=\n## )",
        new_section + "\n",
        text,
        count=1,
        flags=re.S,
    )

    # Add polish pass note under 実施内容 if missing
    if "### ポリッシュパス" not in text:
        note = (
            "\n### ポリッシュパス\n"
            "\n"
            f"- 対象: 初回パッチ後に残った weak≥1（当時29問）の弱い✕行\n"
            f"- スクリプト: `_patch_mottomo_A_polish.py`\n"
            f"- 結果: {polished_q}問・{polished_lines}行を書き換え → weak≥1={n_ge1} / weak≥2={n_ge2}\n"
        )
        text = text.replace("\n## 方針（スタイル）", note + "\n## 方針（スタイル）")

    REPORT_MD.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    n_lines = sum(len(v) for v in UPDATES.values())
    print(f"UPDATES: {len(UPDATES)} qids, {n_lines} lines")

    changed, polished_lines = apply_updates(UPDATES)
    sync_queue(UPDATES)
    added = append_review(UNCERTAIN)

    n_all, n_ge1, n_ge2, details = recount_weak()
    update_report(len(changed), polished_lines, n_ge1, n_ge2)

    print(f"updated {len(changed)} questions, polished_lines={polished_lines}")
    print(f"review added: {added}")
    print(f"--- recount (queue={n_all}) weak>=1: {n_ge1}  weak>=2: {n_ge2} ---")
    for qid, weak, subj in details:
        print(f"  {qid}\tweak={weak}\t{subj}")
    if not details:
        print("  (none)")
