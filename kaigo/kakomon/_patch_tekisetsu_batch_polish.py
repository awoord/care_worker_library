#!/usr/bin/env python3
"""適切なもの：weak>=2 残りを磨き直し

Style: ✕ = 用語・選択肢の正体／正しい関連事実（ではありません／いえません／適切ではありません で終わらない）
      ○ = なぜふさわしいか
      事実は控えめ。不確かなものは UNCERTAIN へ。
"""
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EXPLAIN_DIR = ROOT / "explains"
REVIEW_MD = ROOT / "explains_tekisetsu_needs_review.md"
QUEUE_JSON = ROOT / "explains_tekisetsu_queue.json"
QUESTIONS_JSON = ROOT / "questions.json"

WEAK_END_RE = re.compile(r"(ではありません|いえません|適切ではありません)[。．]?$")

# qid -> {choice_n_str: explain}
UPDATES: dict[str, dict[str, str]] = {
    # --- こころとからだのしくみ ---
    "29-23": {
        "1": "日光を浴びるとビタミンDが作られ、骨の強化に役立ちます。",
        "2": "食物繊維は、便通を整える栄養素です。",
        "3": "ビタミンEは抗酸化などに関わる栄養素で、骨強化の主因はビタミンDやカルシウムです。",
        "4": "適度な運動は、骨に刺激を与えて強くするのに役立ちます。",
        "5": "炭水化物は、体の主なエネルギー源です。",
    },
    "32-106": {
        "1": "抗ヒスタミン薬は、眠気を起こしやすくします。",
        "2": "抗ヒスタミン薬では、夜間よく眠っても日中に強い眠気が出ることがあります。",
        "3": "睡眠中の足の痛がゆさは、むずむず脚症候群などでみられます。",
        "4": "睡眠中の無呼吸は、睡眠時無呼吸症候群などでみられます。",
        "5": "夢の行動が現実に出るのは、レム睡眠行動障害などでみられます。",
    },
    "33-99": {
        "1": "唾液分泌は主に唾液腺の働きで、義歯で必ず増えるとは限りません。",
        "2": "義歯を使うと、話す言葉が明瞭になりやすくなります。",
        "3": "合った義歯では、舌は比較的動かしやすく保たれます。",
        "4": "義歯は頬や唇を支え、口もとのしわを減らしやすいです。",
        "5": "味覚は主に舌の味蕾で感じるため、義歯だけでは味覚は大きく変わりにくいです。",
    },
    "33-107": {
        "1": "レム睡眠のときに、夢をよく見ます。",
        "2": "入眠は、ノンレム睡眠から始まります。",
        "3": "筋緊張がほぼ消えるのは、レム睡眠の特徴です。",
        "4": "速い眼球運動がみられるのは、レム睡眠の特徴です。",
        "5": "高齢者では、レム睡眠の時間は減りやすいです。",
    },
    "36-24": {
        "1": "扁桃は、のどの左右にあるリンパ組織です。",
        "2": "食物が食道に入るのは、通常の飲み込みです。",
        "3": "耳管は、中耳と咽頭をつなぐ管です。",
        "4": "食物が気管に入ることが、誤嚥です。",
        "5": "咽頭は、飲み込みの通過路です。",
    },
    "38-62": {
        "1": "神経膠細胞（グリア細胞）が、神経細胞を支えます。",
        "2": "情報伝達をつかさどるのは、主に神経細胞です。",
        "3": "セロトニンは、神経伝達物質の一つです。",
        "4": "運動野があるのは、前頭葉です。",
        "5": "海馬は、主に記憶に関わる部位です。",
    },
    "38-64": {
        "1": "立っている姿勢を保つときは、大殿筋が収縮します。",
        "2": "膝の屈曲で主に働くのはハムストリングスなどで、大腿四頭筋は伸展に働きます。",
        "3": "肘の屈曲で主に働くのは上腕二頭筋などで、上腕三頭筋は伸展に働きます。",
        "4": "三角筋は、主に肩の外転に働きます。",
        "5": "前脛骨筋は、足関節の背屈に働きます。",
    },
    "38-65": {
        "1": "網膜は、光を感じる膜です。",
        "2": "角膜は、目の表面の透明な膜です。",
        "3": "脈絡膜は、血管に富む層です。",
        "4": "硝子体は、目の内部を満たすゼリー状の組織です。",
        "5": "白内障で濁るのは、水晶体です。",
    },
    "38-72": {
        "1": "第1段階は、否認です。",
        "2": "第2段階は、怒りです。",
        "3": "第3段階は、取引です。",
        "4": "キューブラー・ロスの死の受容では、「抑うつ」は第4段階です。",
        "5": "第5段階は、受容です。",
    },
    # --- 介護の基本 ---
    "29-64": {
        "1": "この意見具申で重視されたのは、市町村の役割などです。",
        "2": "意見具申のうち介護保険につながる事項は、市町村の役割重視です。",
        "3": "施設福祉サービスの法定化は、別の制度議論として扱われやすい内容です。",
        "4": "就労支援策は、雇用・障害福祉などの文脈で語られることが多いです。",
        "5": "福祉文化の創造は、理念的な提言として扱われやすい内容です。",
    },
    "31-65": {
        "1": "家族の介護離職防止は、仕事と介護の両立支援などの政策課題です。",
        "2": "医学的管理は、医師や看護師の役割です。",
        "3": "日常生活への適応訓練は、主にリハビリテーション職の役割です。",
        "4": "社会福祉士及び介護福祉士法では、関係者等との連携が義務とされています。",
        "5": "子育て支援は、児童福祉・子育て施策の分野です。",
    },
    "36-65": {
        "1": "療養上の世話や診療の補助を業とするのは、看護師などの役割です。",
        "2": "喀痰吸引を行うときは、研修や認定などの手続きを経ます。",
        "3": "介護福祉士は、名称独占の資格です。",
        "4": "介護福祉士に、5年ごとの資格更新研修はありません。",
        "5": "介護福祉士は、信用を傷つける行為が禁止されています。",
    },
    "37-71": {
        "1": "専門職が出向いて支援するのは、アウトリーチです。",
        "2": "地域資源を活用して共生を目指すのは、地域共生などの考え方です。",
        "3": "チームアプローチは、複数の専門職が共通の目標に向かって協働することです。",
        "4": "専門職が代わってサービスを決めるのは、利用者の自己決定を損なう対応です。",
        "5": "当事者同士が支えあうのは、ピアサポートです。",
    },
    "38-7": {
        "1": "夜間対応型訪問介護は、要介護者を対象とするサービスです。",
        "2": "要支援者は、自宅で安全に移動するために介護予防住宅改修を利用できます。",
        "3": "小規模多機能型居宅介護は、通い・訪問・泊まりで生活全体を支えるサービスです。",
        "4": "身元保証や死後の財産処分は、民間の終身サポート事業などで扱う内容です。",
        "5": "金銭管理の日常生活自立支援事業は、社会福祉協議会などが行う福祉サービスです。",
    },
    # --- 発達と老化の理解 ---
    "30-37": {
        "1": "パーキンソン病では、前屈みの姿勢がみられやすいです。",
        "2": "パーキンソン病では、小股・すり足歩行がみられやすいです。",
        "3": "自律神経症状では、低血圧などがみられやすいです。",
        "4": "パーキンソン病では、便秘がみられやすいです。",
        "5": "パーキンソン病では、表情が乏しい無表情（仮面様顔貌）がみられます。",
    },
    "34-69": {
        "1": "安定型の愛着は、再会すると安心して再び遊び始めることです。",
        "2": "再会して怒りを示すのは、アンビバレント型などの特徴です。",
        "3": "再会しても関心を示さないのは、回避型などの特徴です。",
        "4": "養育者がいなくても不安にならない反応は、回避型などに近い特徴です。",
        "5": "養育者がいなくても不安にならない反応は、安定型以外のパターンにみられます。",
    },
    "36-31": {
        "1": "神経系は、生後早期から急速に発達します。",
        "2": "一般型（筋骨格など）は、思春期ごろに再び伸びる曲線です。",
        "3": "生殖器系の組織は、12歳ごろから急速に発達します。",
        "4": "循環器系（一般型）は、乳幼児期と思春期に伸びる曲線です。",
        "5": "リンパ系は、小児期にピークとなり、その後はやや低下します。",
    },
    "36-36": {
        "1": "0歳時の平均余命は、平均寿命の説明です。",
        "2": "65歳時の平均余命は、高齢期の余命の指標です。",
        "3": "平均余命から介護期間を引く説明は、健康寿命の公式定義とは別の言い方です。",
        "4": "介護なしで死亡する人の平均寿命は、別の生存指標の説明です。",
        "5": "健康寿命は、健康上の問題で日常生活が制限されず生活できる期間です。",
    },
    "37-37": {
        "1": "サクセスフル・エイジングは、長生きそのものより活動や関係を保つ老い方を重視します。",
        "2": "周囲との交流を続けることは、サクセスフル・エイジングで大切にされます。",
        "3": "痛みがあっても、できる範囲で活動を続けることが望ましいです。",
        "4": "難聴に補聴器をつけパソコン教室に通うのは、補いながら活動を続ける例です。",
        "5": "できなくなった活動でも、別の楽しみ方を探す姿勢が望ましいです。",
    },
    # --- 生活支援技術 ---
    "30-92": {
        "1": "糖尿病では足先・足底などの末梢を重点観察し、図のＡはその対象としては優先度が低いです。",
        "2": "糖尿病では足先・足底などの末梢を重点観察し、図のＢはその対象としては優先度が低いです。",
        "3": "糖尿病では足先・足底などの末梢を重点観察し、図のＣはその対象としては優先度が低いです。",
        "4": "糖尿病では足先・足底などの末梢を重点観察し、図のＤはその対象としては優先度が低いです。",
        "5": "糖尿病では足の皮膚トラブルに注意し、図のＥを観察します。",
    },
    "32-43": {
        "1": "手すりは健側（左側）になるよう導きます。",
        "2": "階段を昇るときは、患側側の後方に立ちます。",
        "3": "階段を昇るときは、健側の左足から出します。",
        "4": "右片麻痺で階段を降りるときは、利用者の右前方に立ちます。",
        "5": "階段を降りるときは、患側の右足から出します。",
    },
    # --- 社会の理解 ---
    "35-12": {
        "1": "自立支援医療は、障害者自立支援法などの仕組みで始まったものです。",
        "2": "共同生活援助（グループホーム）は、障害者自立支援法などの仕組みで制度化されました。",
        "3": "成年後見制度は、民法の改正などで創設されたものです。",
        "4": "障害者基本法の改正で、社会的障壁の除去が新たに規定されました。",
        "5": "パラリンピックの開催は、スポーツ・大会運営の事柄です。",
    },
    "36-16": {
        "1": "介護老人福祉施設の入所者は、原則として福祉避難所の対象外です。",
        "2": "福祉避難所は、災害対策基本法などに基づく避難所です。",
        "3": "医療的ケアが必要な人も、福祉避難所の対象になり得ます。",
        "4": "訪問介護員の派遣は、介護保険や障害福祉サービスの仕組みで行われます。",
        "5": "同行援護のヘルパー派遣は、障害福祉サービスの仕組みで行われます。",
    },
    # --- 総合問題 ---
    "30-122": {
        "1": "居宅介護事業所の管理者は、事業所の運営管理を行います。",
        "2": "相談支援専門員は、サービス等利用計画の作成などを行います。",
        "3": "医師は、医学的な診断や指示を行います。",
        "4": "移動支援は市町村の地域生活支援事業のため、N市の判断で利用できます。",
        "5": "介護支援専門員は、介護保険のケアプラン作成を行います。",
    },
    "36-118": {
        "1": "居宅介護住宅改修費の支給限度基準額は、20万円です。",
        "2": "居宅介護住宅改修費の支給限度基準額は、20万円です。",
        "3": "居宅介護住宅改修費の支給限度基準額は、20万円です。",
        "4": "居宅介護住宅改修費の支給限度基準額は、20万円です。",
        "5": "居宅介護住宅改修費の支給限度基準額は、20万円です。",
    },
    # --- 認知症の理解 ---
    "29-43": {
        "1": "血管性認知症は、女性より男性に多くみられます。",
        "2": "血管性認知症は、段階的（まだら状）に進行しやすいです。",
        "3": "血管性認知症では、人格は比較的保たれやすいです。",
        "4": "血管性認知症では、初期にめまいを自覚することがあります。",
        "5": "血管性認知症は、比較的幅広い年齢層でみられます。",
    },
    "32-77": {
        "1": "この組合せは、平成29年版高齢社会白書の推計値とは異なります。",
        "2": "この組合せは、平成29年版高齢社会白書の推計値とは異なります。",
        "3": "この組合せは、平成29年版高齢社会白書の推計値とは異なります。",
        "4": "推計は2012年462万人、2025年約700万人です。",
        "5": "この組合せは、平成29年版高齢社会白書の推計値とは異なります。",
    },
    # --- 介護過程 ---
    "38-108": {
        "1": "実践状況は、実施のたびに記録します。",
        "2": "実施は、利用者の目標達成のために行います。",
        "3": "実施の目的は、利用者支援です。",
        "4": "介護計画は介護福祉職が立案し、チームで実践します。",
        "5": "実施前に、利用者へ支援内容を説明して同意を得ます。",
    },
    # --- 医療的ケア ---
    "33-109": {
        "1": "経管栄養の注入量を指示するのは、医師です。",
        "2": "看護師は、経管栄養の実施や観察に関わります。",
        "3": "訪問看護事業所の管理者は、事業所の運営管理を行います。",
        "4": "訪問介護事業所の管理者は、事業所の運営管理を行います。",
        "5": "介護支援専門員は、ケアプランの作成などを行います。",
    },
}

SUBJECT_BY_QID: dict[str, str] = {
    "29-23": "こころとからだのしくみ",
    "32-106": "こころとからだのしくみ",
    "33-99": "こころとからだのしくみ",
    "33-107": "こころとからだのしくみ",
    "36-24": "こころとからだのしくみ",
    "38-62": "こころとからだのしくみ",
    "38-64": "こころとからだのしくみ",
    "38-65": "こころとからだのしくみ",
    "38-72": "こころとからだのしくみ",
    "29-64": "介護の基本",
    "31-65": "介護の基本",
    "36-65": "介護の基本",
    "37-71": "介護の基本",
    "38-7": "介護の基本",
    "30-37": "発達と老化の理解",
    "34-69": "発達と老化の理解",
    "36-31": "発達と老化の理解",
    "36-36": "発達と老化の理解",
    "37-37": "発達と老化の理解",
    "30-34": "発達と老化の理解",
    "30-92": "生活支援技術",
    "32-43": "生活支援技術",
    "30-88": "生活支援技術",
    "33-40": "生活支援技術",
    "30-105": "生活支援技術",
    "35-12": "社会の理解",
    "36-16": "社会の理解",
    "30-122": "総合問題",
    "36-118": "総合問題",
    "32-119": "総合問題",
    "29-43": "認知症の理解",
    "32-77": "認知症の理解",
    "33-81": "認知症の理解",
    "37-47": "認知症の理解",
    "38-108": "介護過程",
    "29-112": "介護過程",
    "33-109": "医療的ケア",
}

# newly uncertain / soft wording from this polish (+ rest dump gaps)
UNCERTAIN: list[tuple[str, str]] = [
    ("29-64", "1989年意見具申の誤選択肢の正確な位置づけは史料確認が望ましい"),
    ("30-92", "図なしではＡ〜Ｄの部位を断定できない（正答Ｅ・足の観察で記述）"),
    ("36-31", "スキャモン曲線の年齢目安（4歳・12歳・20歳）は教科書表記の確認推奨"),
    ("35-12", "障害者基本法改正で「新たに規定」された文言の正確な範囲は条文対照推奨"),
    ("36-16", "福祉避難所の法的根拠・対象者の例外は自治体運用差あり"),
    ("32-77", "認知症高齢者数推計（2012年462万／2025年約700万）は原典（高齢社会白書）で要確認"),
    ("29-43", "血管性認知症の年齢層分布の言い切りは統計確認が望ましい"),
    ("33-109", "経管栄養の注入量指示者が医師であることの手引き表現は確認推奨"),
    # rest dump: ICF / 図依存など既存漏れ防止
    ("29-112", "ICFの能力／実行状況の境界は教科書表現の確認が望ましい"),
    ("30-88", "図なしではＡ〜Ｄの具体配置を断定できない（正答Ｅ・端から離れる原則で記述）"),
    ("33-40", "図なしではＡ〜Ｅの解剖位置を断定できない（正答ＡとＣのみ明記）"),
    ("30-105", "死後の着物の合わせ（左前／右前）は教科書・葬儀慣習で説明が分かれるため確認推奨"),
    ("30-34", "明暗順応のどちらがより低下するかの比較表現は要確認"),
    ("32-119", "社会福祉法人の「公益事業」該当は社会福祉法上の分類確認が望ましい"),
    ("33-81", "有病率「100万人に1人程度」は概数表現のため出典確認推奨"),
    ("37-47", "認知症疾患医療センターの実施主体・法的根拠の言い回しは施策文書で確認推奨"),
]

# needs_review の見出し（既存＋rest dumpで欠けやすい科目）
SECTION_ORDER = [
    "こころとからだ・介護の基本",
    "こころとからだのしくみ",
    "介護の基本",
    "社会の理解",
    "発達と老化の理解",
    "認知症の理解",
    "障害の理解",
    "生活支援技術",
    "総合問題",
    "介護過程",
    "医療的ケア",
    "人間の尊厳と自立",
    "人間関係とコミュニケーション",
    "コミュニケーション技術",
]

# こころとからだ／介護の基本は既存見出しに寄せる
SECTION_ALIAS = {
    "こころとからだのしくみ": "こころとからだ・介護の基本",
    "介護の基本": "こころとからだ・介護の基本",
}


def apply_updates(updates: dict[str, dict[str, str]]) -> list[str]:
    by_session: dict[int, dict[str, dict[str, str]]] = {}
    for qid, explains in updates.items():
        session = int(qid.split("-")[0])
        by_session.setdefault(session, {})[qid] = explains

    changed: list[str] = []
    for session, qmap in sorted(by_session.items()):
        path = EXPLAIN_DIR / f"explains_{session}.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        for qid, explains in qmap.items():
            if qid not in data["items"]:
                raise SystemExit(f"missing {qid} in {path.name}")
            if set(explains.keys()) != {"1", "2", "3", "4", "5"}:
                raise SystemExit(f"bad keys for {qid}: {sorted(explains)}")
            for n, text in explains.items():
                if WEAK_END_RE.search(text.strip()):
                    raise SystemExit(f"weak ending left in {qid}-{n}: {text}")
            data["items"][qid]["explains"] = explains
            changed.append(qid)
        path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return changed


def _parse_review_sections(text: str) -> tuple[str, dict[str, list[str]]]:
    """Return (preamble, {section_title: [bullet lines]})."""
    if "## " not in text:
        return text.rstrip() + "\n", {}
    first = text.index("## ")
    preamble = text[:first]
    rest = text[first:]
    sections: dict[str, list[str]] = {}
    parts = re.split(r"(?=^## )", rest, flags=re.M)
    for part in parts:
        part = part.strip("\n")
        if not part.startswith("## "):
            continue
        lines = part.splitlines()
        title = lines[0][3:].strip()
        bullets = []
        for line in lines[1:]:
            s = line.strip()
            if s.startswith("- `"):
                bullets.append(s)
        sections[title] = bullets
    return preamble, sections


def _qid_from_bullet(line: str) -> str | None:
    m = re.match(r"- `([^`]+)`:", line)
    return m.group(1) if m else None


def append_review(uncertain: list[tuple[str, str]]) -> None:
    if REVIEW_MD.exists():
        text = REVIEW_MD.read_text(encoding="utf-8")
    else:
        text = "# 「適切なもの」解説・要確認リスト\n作成日: 2026-09-10\n方針: ✕は当てはめ対象の正体／正しい用途、○はなぜその状況にふさわしいか。統計・法令・図依存は要確認。\n"

    preamble, sections = _parse_review_sections(text)

    for qid, reason in uncertain:
        subj = SUBJECT_BY_QID.get(qid, "その他")
        section = SECTION_ALIAS.get(subj, subj)
        bullets = sections.setdefault(section, [])
        existing = {_qid_from_bullet(b) for b in bullets}
        if qid in existing:
            continue
        bullets.append(f"- `{qid}`: {reason}")

    # ensure empty subject headers from rest dump appear if referenced
    for title in SECTION_ORDER:
        sections.setdefault(title, sections.get(title, []))

    out = [preamble.rstrip(), ""]
    # keep stable order: known sections first, then any extras
    seen: set[str] = set()
    for title in SECTION_ORDER:
        bullets = sections.get(title) or []
        if not bullets and title not in (
            "障害の理解",
            "医療的ケア",
            "人間の尊厳と自立",
            "人間関係とコミュニケーション",
            "コミュニケーション技術",
            "介護過程",
        ):
            # skip empty cosmetic sections except ones user asked to keep visible
            continue
        if title in (
            "障害の理解",
            "人間の尊厳と自立",
            "人間関係とコミュニケーション",
            "コミュニケーション技術",
        ) and not bullets:
            continue
        seen.add(title)
        out.append(f"## {title}")
        out.append("")
        if bullets:
            out.extend(bullets)
        elif title in ("医療的ケア", "介護過程"):
            pass
        out.append("")
    for title, bullets in sections.items():
        if title in seen or not bullets:
            continue
        out.append(f"## {title}")
        out.append("")
        out.extend(bullets)
        out.append("")

    REVIEW_MD.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")


def load_answers() -> dict[str, list[str]]:
    answers: dict[str, list[str]] = {}
    for session in range(29, 39):
        path = ROOT / f"answers_{session}.csv"
        if not path.exists():
            continue
        for i, line in enumerate(path.read_text(encoding="utf-8").splitlines()):
            if i == 0 and line.lower().startswith("q"):
                continue
            if not line.strip():
                continue
            parts = line.split(",")
            if len(parts) < 2:
                continue
            qnum, raw = parts[0].strip(), parts[1].strip()
            if not raw or raw in ("なし", "-", "—", "－", "不明", "?"):
                continue
            nums = re.findall(r"\d+", raw)
            answers[f"{session}-{qnum}"] = nums
    return answers


def recount_weak() -> tuple[int, int, list[tuple[str, int, str]]]:
    """Return (n_tekisetsu, n_weak_ge2, details)."""
    answers = load_answers()
    # prefer questions.json stems if available
    stems: dict[str, str] = {}
    subjects: dict[str, str] = {}
    if QUESTIONS_JSON.exists():
        qdata = json.loads(QUESTIONS_JSON.read_text(encoding="utf-8"))
        items = qdata.get("questions") or qdata.get("items") or []
        if isinstance(items, list):
            for it in items:
                qid = it.get("id") or f"{it.get('session')}-{it.get('number')}"
                stems[qid] = it.get("stem") or it.get("question") or ""
                subjects[qid] = it.get("subject") or ""
        elif isinstance(items, dict):
            for qid, it in items.items():
                stems[qid] = it.get("stem") or it.get("question") or ""
                subjects[qid] = it.get("subject") or ""

    if QUEUE_JSON.exists():
        for it in json.loads(QUEUE_JSON.read_text(encoding="utf-8")):
            qid = it["id"]
            stems.setdefault(qid, it.get("stem") or "")
            subjects.setdefault(qid, it.get("subject") or "")

    details: list[tuple[str, int, str]] = []
    n_all = 0
    for session in range(29, 39):
        path = EXPLAIN_DIR / f"explains_{session}.json"
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        for qid, item in data.get("items", {}).items():
            stem = stems.get(qid, "")
            if "適切なもの" not in stem:
                # fallback: only count if in original queue
                if qid not in stems and qid not in (
                    json.loads(QUEUE_JSON.read_text(encoding="utf-8"))
                    if QUEUE_JSON.exists()
                    else []
                ):
                    continue
                if "適切なもの" not in stem:
                    # try queue membership
                    continue
            n_all += 1
            ans = set(answers.get(qid) or [])
            explains = item.get("explains") or {}
            weak_ns = [
                n
                for n, e in explains.items()
                if n not in ans and WEAK_END_RE.search((e or "").strip())
            ]
            weak = len(weak_ns)
            if weak >= 2:
                details.append((qid, weak, subjects.get(qid, "")))
    return n_all, len(details), sorted(details, key=lambda x: (-x[1], x[0]))


def recount_weak_from_queue() -> tuple[int, int, list[tuple[str, int, str]]]:
    """Recount using queue ids (authoritative 適切なもの set) + current explains."""
    queue = json.loads(QUEUE_JSON.read_text(encoding="utf-8"))
    answers = load_answers()
    by_session: dict[int, dict] = {}
    details: list[tuple[str, int, str]] = []
    for it in queue:
        qid = it["id"]
        session = int(qid.split("-")[0])
        if session not in by_session:
            by_session[session] = json.loads(
                (EXPLAIN_DIR / f"explains_{session}.json").read_text(encoding="utf-8")
            )["items"]
        explains = by_session[session][qid]["explains"]
        ans = set(str(a) for a in (it.get("answers") or answers.get(qid) or []))
        weak_ns = [
            n
            for n, e in explains.items()
            if n not in ans and WEAK_END_RE.search((e or "").strip())
        ]
        weak = len(weak_ns)
        if weak >= 2:
            details.append((qid, weak, it.get("subject") or ""))
    return len(queue), len(details), sorted(details, key=lambda x: (-x[1], x[0]))


if __name__ == "__main__":
    expected = 29
    if len(UPDATES) != expected:
        raise SystemExit(f"expected {expected} updates, got {len(UPDATES)}")
    missing_subj = [qid for qid in UPDATES if qid not in SUBJECT_BY_QID]
    if missing_subj:
        raise SystemExit(f"missing SUBJECT_BY_QID: {missing_subj}")

    changed = apply_updates(UPDATES)
    append_review(UNCERTAIN)

    counts = Counter(SUBJECT_BY_QID[qid] for qid in changed)
    print(f"updated {len(changed)} questions")
    print("--- counts by subject ---")
    for subj, n in counts.most_common():
        print(f"{subj}: {n}")

    n_all, n_weak, details = recount_weak_from_queue()
    print(f"--- recount (queue={n_all}) weak>=2: {n_weak} ---")
    for qid, weak, subj in details[:40]:
        print(f"  {qid}\tweak={weak}\t{subj}")
    if len(details) > 40:
        print(f"  ... and {len(details) - 40} more")
