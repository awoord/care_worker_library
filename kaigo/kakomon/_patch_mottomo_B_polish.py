#!/usr/bin/env python3
"""最も適切なもの Layer B：残 weak 行の磨き直し（人間関係とコミュニケーション）"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EXPLAIN_DIR = ROOT / "explains"
QUEUE_JSON = ROOT / "explains_mottomo_B_queue.json"
REVIEW_MD = ROOT / "explains_mottomo_B_needs_review.md"

WEAK_END_RE = re.compile(
    r"ではありません|適切ではありません|正しくありません|誤りです|いえません|考えにくいです"
)

# 弱い語尾だけを、正体＋この問い／場面への不合に書き換え
UPDATES: dict[str, dict[str, str]] = {
    "29-5": {
        "5": "利用者と家族の意見が違うときは、まず利用者本人の意向を大切にするのが基本です。",
    },
    "29-6": {
        "1": "父親の気持ちを想像させる助言は、いま語っているＧさんの気持ちの受け止めより先に出る働きかけです。",
        "3": "一人暮らしの情報提供は解決策の提示で、共感を示す応答としては先になります。",
    },
    "30-5": {
        "2": "問題行動を否定するのは評価・制止で、ありのままを受け止める受容とは違います。",
        "3": "言い分に同調（賛成）することと、価値観を尊重する受容は同じではありませんが、受容は賛成ではなく尊重です。",
        "4": "感情を分析するのは解釈の作業で、ありのままを受け止める受容の説明とは焦点が違います。",
        "5": "否定的感情を抑え込むのは防衛・抑制で、感情を受け止める受容とは違います。",
    },
    "30-6": {
        "1": "初対面の緊張をほぐすきっかけづくりはアイスブレイクに近く、開かれた質問の主目的（考えの明確化）とは違います。",
        "5": "同じ話を一旦止めるのは会話の中断で、考えを引き出す開かれた質問の目的とは違います。",
    },
    "32-3": {
        "1": "強みを重視するのは自己評価の偏りで、感情の動きとその背景を洞察する自己覚知とは違います。",
        "4": "私生活を打ち明けるのは自己開示で、自己の感情とその背景を洞察する自己覚知とは違います。",
        "5": "価値観を他者に合わせるのは同調で、自己を知る自己覚知とは違います。",
    },
    "34-4": {
        "3": "利用者に情報を開示させることが目的ではなく、介護福祉職が自己を開示して信頼形成につなげます。",
        "4": "自己開示は信頼関係を築くための関わりで、信頼関係を評価する手段としては使いません。",
    },
    "35-5": {
        "1": "騒音の影響を調べるのは現状把握（チェック寄り）で、改善策を実行するアクションとは段階が違います。",
        "2": "苦情を寄せた住民に話を聞きに行くのも確認で、駐車スペース確保のような改善の実行とは段階が違います。",
        "3": "夏祭りの感想を聞くのは評価・確認に近く、違法駐車への改善実行とは焦点が違います。",
        "5": "周辺の交通量を調べるのも調査で、改善策を実行するアクションとは段階が違います。",
    },
    "37-4": {
        "1": "あいづちで発話を引き出すのは双方向のやり取りで、介護福祉職が自分を打ち明ける互いの自己開示とは違います。",
        "2": "能力を測る評価ではなく、戸惑うＡさんから発話を引き出す双方向のやり取りが意図です。",
    },
    "38-26": {
        "1": "ゆっくり話すのは話し方・準言語の調整で、部屋の場所を身ぶりで示す非言語とは違います。",
        "2": "大きな声で伝えるのも声の使い方（準言語）で、指差しなどの非言語とは違います。",
        "3": "部屋番号を紙に書くのは文字による伝え方で、ドアを指差す非言語とは違います。",
    },
}


def apply() -> list[str]:
    by_session: dict[int, dict] = {}
    updated: list[str] = []
    for qid, mp in UPDATES.items():
        session = int(qid.split("-")[0])
        if session not in by_session:
            path = EXPLAIN_DIR / f"explains_{session}.json"
            by_session[session] = json.loads(path.read_text(encoding="utf-8"))
        item = by_session[session]["items"][qid]
        explains = item["explains"]
        for n, text in mp.items():
            if n not in explains:
                raise SystemExit(f"{qid}: missing key {n}")
            explains[n] = text
        item["status"] = "draft"
        updated.append(qid)
    for session, data in by_session.items():
        path = EXPLAIN_DIR / f"explains_{session}.json"
        path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    return updated


def refresh_queue() -> tuple[int, int]:
    queue = json.loads(QUEUE_JSON.read_text(encoding="utf-8"))
    by: dict[str, dict] = {}
    for p in EXPLAIN_DIR.glob("explains_*.json"):
        d = json.loads(p.read_text(encoding="utf-8"))
        by.update(d.get("items") or {})
    ge1 = ge2 = 0
    for it in queue:
        qid = it["id"]
        exp = (by.get(qid) or {}).get("explains") or {}
        it["explains"] = exp
        ans = set(str(it.get("answers") or ""))
        weak_ns = [
            n
            for n, e in exp.items()
            if n not in ans and WEAK_END_RE.search((e or "").strip())
        ]
        # also catch mid-sentence weak if ends with ） after ではありません
        it["weak_ns"] = weak_ns
        it["weak"] = len(weak_ns)
        if len(weak_ns) >= 1:
            ge1 += 1
        if len(weak_ns) >= 2:
            ge2 += 1
    QUEUE_JSON.write_text(
        json.dumps(queue, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return ge1, ge2


def append_review() -> None:
    section = "## ポリッシュ追加（要確認）"
    lines = [
        section,
        "",
        "- （語尾磨きのみ。新規の内容不確実はなし）",
        "",
    ]
    block = "\n".join(lines)
    if REVIEW_MD.exists():
        text = REVIEW_MD.read_text(encoding="utf-8")
        if section in text:
            return
        REVIEW_MD.write_text(text.rstrip() + "\n\n" + block, encoding="utf-8")
    else:
        REVIEW_MD.write_text(block, encoding="utf-8")


def main() -> None:
    # 30-5-3 still contains ではありません mid-sentence — rewrite cleaner
    UPDATES["30-5"]["3"] = (
        "言い分に同調（賛成）することと、価値観を尊重する受容は別です。受容は賛成ではなく尊重です。"
    )
    updated = apply()
    ge1, ge2 = refresh_queue()
    append_review()
    print("polished", len(updated), updated)
    print("weak>=1", ge1, "weak>=2", ge2)


if __name__ == "__main__":
    main()
