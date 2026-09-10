#!/usr/bin/env python3
"""過去問ドットコムの各問題ページから正解番号を拾い、CSVにする。

- 問の一覧・番号は kakomon_v2/kaigo_kakomon_all.txt（load_questions）に合わせる
- URL は kakomonn_links（問題文突合済み ID）を使う
- 取得元は非公式サイトのため、公式正答との突合を推奨
- サイト負荷を抑えるため待機を入れる。利用規約に注意

使い方:
  python3 fetch_kakomonn_answers.py --session 38 --limit 5
  python3 fetch_kakomonn_answers.py --from 29 --to 38 --resume

出力（既定）:
  ../kaigo/kakomon/answers_kakomonn.csv
  列: session,number,answer,qid,url,status
"""

from __future__ import annotations

import argparse
import csv
import http.cookiejar
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from extract_by_keyword import KAKOMON_TXT, load_questions
from kakomonn_links import question_id, question_url

DIR = Path(__file__).resolve().parent
OUT_DEFAULT = DIR.parent / "kaigo" / "kakomon" / "answers_kakomonn.csv"

USER_AGENT = (
    "Mozilla/5.0 (compatible; care-worker-library/1.0; "
    "+local answer CSV builder)"
)

# 「正解は4です」「正解は「４」です」など
RE_ANSWER_IS = re.compile(
    r"正解は\s*[「『]?\s*([1-5１-５])\s*[」』]?",
)
# 「正解は4と5」「正解は４・５」「正解は 4 , 5」など複数正答
RE_ANSWER_MULTI = re.compile(
    r"正解は\s*[「『]?\s*([1-5１-５])(?:\s*[と・,、]\s*([1-5１-５]))+\s*[」』]?",
)
RE_ANSWER_DIGITS = re.compile(r"[1-5１-５]")
ANSWER_API_URL = "https://kaigofukushi.kakomonn.com/questions/answer"
# expound 内の短い判定語
RE_OK_MARK = re.compile(r"(正解です|正答です|正しい記述です)")
RE_NG_MARK = re.compile(r"(不正解|誤りです|誤っている|適切でない)")
ZEN_DIGITS = str.maketrans("１２３４５", "12345")


def to_half_digit(ch: str) -> int:
    return int(ch.translate(ZEN_DIGITS))


def parse_answers_from_phrase(html: str) -> list[int] | None:
    """解説文の『正解はN』『正解はNとM』を優先して取る。"""
    text = re.sub(r"<[^>]+>", " ", html)
    text = unicodedata.normalize("NFKC", text)
    multi_hits: list[tuple[int, ...]] = []
    for m in RE_ANSWER_MULTI.finditer(text):
        digits = [to_half_digit(d) for d in RE_ANSWER_DIGITS.findall(m.group(0))]
        # 「正解は」直後の番号だけ（文中の別数字を拾わないようフレーズ内に限定）
        phrase = m.group(0)
        digits = [to_half_digit(d) for d in RE_ANSWER_DIGITS.findall(phrase)]
        if len(digits) >= 2:
            multi_hits.append(tuple(sorted(set(digits))))
    if multi_hits:
        counts: dict[tuple[int, ...], int] = {}
        for pair in multi_hits:
            counts[pair] = counts.get(pair, 0) + 1
        best_pair = max(counts.items(), key=lambda kv: (kv[1], kv[0]))[0]
        return list(best_pair)

    hits = [to_half_digit(m.group(1)) for m in RE_ANSWER_IS.finditer(text)]
    if not hits:
        return None
    counts_n: dict[int, int] = {}
    for n in hits:
        counts_n[n] = counts_n.get(n, 0) + 1
    best = max(counts_n.items(), key=lambda kv: (kv[1], -kv[0]))
    if best[1] >= 1:
        return [best[0]]
    return None


def parse_answer_from_phrase(html: str) -> int | None:
    answers = parse_answers_from_phrase(html)
    if not answers or len(answers) != 1:
        return None
    return answers[0]


def parse_answer_from_expound(html: str) -> int | None:
    """expound-N ブロック内の正誤ラベルから取る。"""
    found: list[int] = []
    for n in range(1, 6):
        marker = f'<div class="expound-{n}">'
        start = html.find(marker)
        if start < 0:
            continue
        start += len(marker)
        ends = []
        for k in range(n + 1, 6):
            pos = html.find(f'<div class="expound-{k}">', start)
            if pos >= 0:
                ends.append(pos)
        bottom = html.find('<div class="expound-bottom"', start)
        if bottom >= 0:
            ends.append(bottom)
        if not ends:
            # 終端不明なら短く切る（後続の『正解は…』食い込み防止）
            end = start + 1200
        else:
            end = min(ends)
        chunk = re.sub(r"<[^>]+>", " ", html[start:end])
        chunk = unicodedata.normalize("NFKC", chunk)
        # 『不正解とその解説』見出しは無視し、本文側の判定を見る
        chunk = chunk.replace("不正解とその解説", " ")
        ok = RE_OK_MARK.search(chunk)
        ng = RE_NG_MARK.search(chunk)
        if ok and (not ng or ok.start() < ng.start()):
            found.append(n)
            continue
        # 「正解」単独（「不正解」より先）
        idx_c = chunk.find("正解")
        idx_w = chunk.find("不正解")
        if idx_c >= 0 and (idx_w < 0 or idx_c < idx_w):
            if idx_c == 0 or chunk[idx_c - 1] != "不":
                found.append(n)
    if len(found) == 1:
        return found[0]
    return None


def format_answers(answers: list[int] | None) -> str:
    if not answers:
        return ""
    return ",".join(str(n) for n in sorted(set(answers)))


def parse_answers(html: str) -> list[int] | None:
    """複数形式に対応して正解番号リスト（1〜5）を返す。"""
    # 1) 『正解はN』『正解はNとM』が最も明示的
    by_phrase = parse_answers_from_phrase(html)
    if by_phrase is not None:
        return by_phrase
    # 2) expound ラベル（複数正解あり得る）
    found: list[int] = []
    for n in range(1, 6):
        marker = f'<div class="expound-{n}">'
        start = html.find(marker)
        if start < 0:
            continue
        start += len(marker)
        ends = []
        for k in range(n + 1, 6):
            pos = html.find(f'<div class="expound-{k}">', start)
            if pos >= 0:
                ends.append(pos)
        bottom = html.find('<div class="expound-bottom"', start)
        if bottom >= 0:
            ends.append(bottom)
        end = min(ends) if ends else start + 1200
        chunk = re.sub(r"<[^>]+>", " ", html[start:end])
        chunk = unicodedata.normalize("NFKC", chunk)
        chunk = chunk.replace("不正解とその解説", " ")
        ok = RE_OK_MARK.search(chunk)
        ng = RE_NG_MARK.search(chunk)
        if ok and (not ng or ok.start() < ng.start()):
            found.append(n)
            continue
        idx_c = chunk.find("正解")
        idx_w = chunk.find("不正解")
        if idx_c >= 0 and (idx_w < 0 or idx_c < idx_w):
            if idx_c == 0 or chunk[idx_c - 1] != "不":
                found.append(n)
    if found:
        return found
    return None


def parse_answer(html: str) -> int | None:
    answers = parse_answers(html)
    if not answers or len(answers) != 1:
        return None
    return answers[0]


def stem_fingerprint(stem: str) -> str:
    """ページ突合用の短い指紋（空白除去・NFKC）。"""
    s = unicodedata.normalize("NFKC", stem or "")
    s = re.sub(r"\s+", "", s)
    return s[:40]


def page_matches_stem(html: str, fingerprint: str) -> bool:
    if not fingerprint or len(fingerprint) < 8:
        return True
    text = unicodedata.normalize("NFKC", re.sub(r"<[^>]+>", "", html))
    text = re.sub(r"\s+", "", text)
    return fingerprint in text


def fetch_html(opener: urllib.request.OpenerDirector, url: str, timeout: float = 20.0) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with opener.open(req, timeout=timeout) as res:
        raw = res.read()
    return raw.decode("utf-8", errors="replace")


def parse_answers_from_api_html(fragment: str) -> list[int] | None:
    """answer API の response_data03（『正解は N です』）から取る。"""
    text = unicodedata.normalize("NFKC", re.sub(r"<[^>]+>", " ", fragment or ""))
    m = re.search(r"正解は\s*([1-5](?:\s*[,，、・と]\s*[1-5])*)", text)
    if not m:
        return None
    nums = [int(d) for d in RE_ANSWER_DIGITS.findall(m.group(1))]
    return sorted(set(nums)) if nums else None


def fetch_answers_via_post(
    opener: urllib.request.OpenerDirector,
    url: str,
    html: str,
    timeout: float = 20.0,
) -> list[int] | None:
    """
    解説非公開ページ向け: 解答APIに適当な選択肢を送ると正解が返る。
    """
    csrf_m = re.search(r'name="csrf-token"\s+content="([^"]+)"', html)
    study_m = re.search(r'id="intStudyRandumId"[^>]*value="([^"]*)"', html)
    cat_m = re.search(r'id="intIdCategoryFlag"[^>]*value="([^"]*)"', html)
    if not csrf_m or not study_m or not cat_m:
        return None
    data = urllib.parse.urlencode(
        {
            "strAnswerData": "1-",
            "intStudyRandumId": study_m.group(1),
            "intIdCategoryFlag": cat_m.group(1),
        }
    ).encode()
    req = urllib.request.Request(
        ANSWER_API_URL,
        data=data,
        headers={
            "User-Agent": USER_AGENT,
            "X-CSRF-TOKEN": csrf_m.group(1),
            "X-Requested-With": "XMLHttpRequest",
            "Referer": url,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        method="POST",
    )
    with opener.open(req, timeout=timeout) as res:
        payload = json.loads(res.read().decode("utf-8", errors="replace"))
    return parse_answers_from_api_html(str(payload.get("response_data03") or ""))


def parse_answers_from_circle_marks(html: str) -> list[int] | None:
    """expound 内の 〇/○ × 表記から正解を取る（ロック解除前後どちらでも有効）。"""
    found: list[int] = []
    for n in range(1, 6):
        marker = f'<div class="expound-{n}">'
        start = html.find(marker)
        if start < 0:
            continue
        start += len(marker)
        ends = []
        for k in range(n + 1, 6):
            pos = html.find(f'<div class="expound-{k}">', start)
            if pos >= 0:
                ends.append(pos)
        for needle in (
            '<div class="expound-bottom"',
            'class="commentary',
            "参考になった",
            'id="js-commentary',
        ):
            pos = html.find(needle, start)
            if pos >= 0:
                ends.append(pos)
        end = min(ends) if ends else start + 400
        head = unicodedata.normalize("NFKC", re.sub(r"<[^>]+>", " ", html[start:end][:220]))
        idx_ok_candidates = [i for i in (head.find("〇"), head.find("○")) if i >= 0]
        idx_ng_candidates = [i for i in (head.find("×"), head.find("✕"), head.find("✖")) if i >= 0]
        if not idx_ok_candidates:
            continue
        idx_ok = min(idx_ok_candidates)
        idx_ng = min(idx_ng_candidates) if idx_ng_candidates else -1
        if idx_ng < 0 or idx_ok < idx_ng:
            found.append(n)
    return found or None


def resolve_answers(
    opener: urllib.request.OpenerDirector,
    url: str,
    html: str,
) -> tuple[list[int] | None, str]:
    """正解を取る。未解答ロック中はHTML解説を信用せずAPIを使う。"""
    locked = "解説は問題に回答すると" in html
    if locked:
        api_answers = fetch_answers_via_post(opener, url, html)
        if api_answers:
            return api_answers, "api"
        # API失敗時のみサークルマークを試す
        circled = parse_answers_from_circle_marks(html)
        if circled:
            return circled, "circle"
        return None, "none"

    answers = parse_answers(html)
    if answers:
        return answers, "html"
    circled = parse_answers_from_circle_marks(html)
    if circled:
        return circled, "circle"
    # 念のためAPIも試す
    if "解答する" in html:
        api_answers = fetch_answers_via_post(opener, url, html)
        if api_answers:
            return api_answers, "api"
    return None, "none"


def iter_targets(session_from: int, session_to: int):
    """all.txt に存在する (回, 問番号) だけを、ファイル順で返す。"""
    questions = load_questions(
        KAKOMON_TXT,
        session_min=session_from,
        session_max=session_to,
    )
    for q in questions:
        session = int(q.session)
        number = int(q.number)
        qid = question_id(session, number)
        url = question_url(session, number)
        fp = stem_fingerprint(q.stem.split("\n", 1)[0] if q.stem else "")
        if qid is None or url is None:
            yield session, number, None, None, fp, "no_url"
            continue
        yield session, number, qid, url, fp, "pending"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="過去問ドットコムから正解番号CSVを作る"
    )
    parser.add_argument("--from", dest="session_from", type=int, default=29)
    parser.add_argument("--to", dest="session_to", type=int, default=38)
    parser.add_argument(
        "--session",
        type=int,
        default=None,
        help="1回分だけ（--from/--to より優先）",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="取得件数の上限（0 で制限なし。動作確認用）",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.8,
        help="リクエスト間隔秒（既定: 0.8）",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=OUT_DEFAULT,
        help=f"出力CSV（既定: {OUT_DEFAULT.name}）",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="status=ok の行はスキップして再開（失敗分は再取得）",
    )
    parser.add_argument(
        "--fresh",
        action="store_true",
        help="既存CSVを無視して新規作成",
    )
    args = parser.parse_args()

    if args.session is not None:
        session_from = session_to = args.session
    else:
        session_from, session_to = args.session_from, args.session_to
    if session_from > session_to:
        print("--from は --to 以下にしてください", file=sys.stderr)
        return 1
    if not KAKOMON_TXT.is_file():
        print(f"過去問テキストがありません: {KAKOMON_TXT}", file=sys.stderr)
        return 1

    done_ok: set[tuple[int, int]] = set()
    rows_by_key: dict[tuple[int, int], dict] = {}
    if args.resume and not args.fresh and args.output.is_file():
        with args.output.open(encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f):
                try:
                    key = (int(row["session"]), int(row["number"]))
                except (KeyError, ValueError):
                    continue
                rows_by_key[key] = row
                if (
                    row.get("status") in ("ok", "ok_stem_diff", "ok_api")
                    and str(row.get("answer", "")).strip()
                ):
                    done_ok.add(key)
        print(f"既存 ok {len(done_ok)} 件を保持、失敗分は再取得します")
    elif args.fresh and args.output.is_file():
        print(f"既存CSVを破棄して新規作成: {args.output}")

    targets = [
        t
        for t in iter_targets(session_from, session_to)
        if (t[0], t[1]) not in done_ok
    ]
    if args.limit > 0:
        targets = targets[: args.limit]

    print(
        f"取得予定: {len(targets)} 件 "
        f"（第{session_from}〜{session_to}回, 元={KAKOMON_TXT.name}, "
        f"delay={args.delay}s）"
    )

    fieldnames = ["session", "number", "answer", "qid", "url", "status"]
    args.output.parent.mkdir(parents=True, exist_ok=True)

    ok = 0
    fail = 0
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    for i, (session, number, qid, url, fp, preset) in enumerate(targets, start=1):
        status = preset
        answers: list[int] | None = None
        if preset == "no_url":
            fail += 1
            status = "no_url"
        else:
            try:
                assert url is not None and qid is not None
                html = fetch_html(opener, url)
                stem_ok = page_matches_stem(html, fp)
                answers, source = resolve_answers(opener, url, html)
                if answers is None:
                    status = "parse_failed" if stem_ok else "stem_mismatch"
                    fail += 1
                elif not stem_ok:
                    status = "ok_stem_diff"
                    ok += 1
                elif source == "api":
                    status = "ok_api"
                    ok += 1
                else:
                    status = "ok"
                    ok += 1
            except urllib.error.HTTPError as err:
                status = f"http_{err.code}"
                fail += 1
            except Exception as err:
                status = f"error:{type(err).__name__}"
                fail += 1

        answer_s = format_answers(answers)
        row = {
            "session": str(session),
            "number": str(number),
            "answer": answer_s,
            "qid": str(qid) if qid is not None else "",
            "url": url or "",
            "status": status,
        }
        rows_by_key[(session, number)] = row
        print(
            f"[{i}/{len(targets)}] {session}-{number} → "
            f"{answer_s or '-'} ({status})"
        )

        with args.output.open("w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for key in sorted(rows_by_key.keys()):
                writer.writerow(rows_by_key[key])

        if i < len(targets) and args.delay > 0 and preset != "no_url":
            time.sleep(args.delay)

    print(f"\n完了: ok={ok} fail={fail} → {args.output}")
    print("注意: 非公式サイト由来です。公式正答がある回は突合してください。")
    print(f"問題番号の基準: {KAKOMON_TXT}")
    return 0 if ok > 0 or fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
