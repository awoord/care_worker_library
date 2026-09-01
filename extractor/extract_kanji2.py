import csv
from collections import Counter
from pathlib import Path
import re
from sudachipy import Dictionary, SplitMode

KANJI2_RE = re.compile(r"^[一-龥々〆ヵヶ]{2}$")


def is_kanji2_word(word: str) -> bool:
    """漢字2文字のみの単語か判定する。"""
    return bool(word and KANJI2_RE.fullmatch(word))


def extract_kanji2_terms(text, excluded_words, keep_words, mode=SplitMode.C):
    """
    文章から一般単語を取り出し、辞書形が漢字2文字のみの語に絞る。
    extractor.py と同じ除外・keep_words ルールを適用する。
    """
    tokenizer = Dictionary().create()
    target_pos = ["名詞", "動詞", "形容詞", "副詞", "形状詞"]
    results = []

    for line in text.splitlines():
        if not line.strip():
            continue

        for token in tokenizer.tokenize(line, mode):
            pos_parts = token.part_of_speech()
            pos_main = pos_parts[0]
            pos_sub = pos_parts[1]
            base_form = token.dictionary_form()
            surface = token.surface()

            if base_form in keep_words or surface in keep_words:
                if is_kanji2_word(base_form):
                    results.append(
                        {
                            "base_form": base_form,
                            "surface": surface,
                            "pos": pos_main,
                        }
                    )
                continue

            if pos_main not in target_pos:
                continue

            if pos_sub in ["数", "数詞"]:
                continue

            if re.search(r"[a-zａ-ｚ]", surface) or re.search(r"[a-zａ-ｚ]", base_form):
                continue

            if re.search(r"[A-ZＡ-Ｚ]", surface) or re.search(r"[A-ZＡ-Ｚ]", base_form):
                if not (
                    re.fullmatch(r"[A-ZＡ-Ｚ]{2,}", surface)
                    or re.fullmatch(r"[A-ZＡ-Ｚ]{2,}", base_form)
                ):
                    continue

            if re.fullmatch(r"[ぁ-ん]{1,2}", surface) or re.fullmatch(
                r"[ぁ-ん]{1,2}", base_form
            ):
                continue

            if re.fullmatch(r"[ァ-ヴー・]{1}", surface) or re.fullmatch(
                r"[ァ-ヴー・]{1}", base_form
            ):
                continue

            if base_form in excluded_words or surface in excluded_words:
                continue

            if not is_kanji2_word(base_form):
                continue

            results.append(
                {
                    "base_form": base_form,
                    "surface": surface,
                    "pos": pos_main,
                }
            )

    return results


def load_words_from_csv(file_path):
    """指定されたCSV・テキストファイルから単語を読み取ってセットにして返す。"""
    words = set()
    if file_path.exists():
        with open(file_path, "r", encoding="utf-8-sig", errors="ignore") as f:
            reader = csv.reader(f)
            for row in reader:
                for cell in row:
                    word = cell.strip()
                    if word:
                        words.add(word)
    return words


if __name__ == "__main__":
    current_dir = Path(__file__).resolve().parent

    kakomon_dir = current_dir.parent / "kakomon"
    if not kakomon_dir.exists():
        kakomon_dir = current_dir.parent.parent / "kakomon"

    excluded_word_dir = current_dir.parent / "excluded_word"

    excluded_words = set()

    jlpt5_path = excluded_word_dir / "jlpt5.csv"
    jlpt5_words = load_words_from_csv(jlpt5_path)
    excluded_words.update(jlpt5_words)
    if jlpt5_path.exists():
        print(f"【jlpt5.csv 読み込み成功】: {len(jlpt5_words)} 個の単語を追加")
    else:
        print(f"【スキップ】jlpt5.csv が見つかりませんでした: {jlpt5_path}")

    done_path = excluded_word_dir / "done.csv"
    done_words = load_words_from_csv(done_path)
    excluded_words.update(done_words)
    if done_path.exists():
        print(f"【done.csv 読み込み成功】: {len(done_words)} 個の単語を追加")
    else:
        print(f"【スキップ】done.csv が見つかりませんでした: {done_path}")

    kanji_path = excluded_word_dir / "kanji_1word.csv"
    if not kanji_path.exists():
        kanji_path = excluded_word_dir / "kanji_1word.txt"
    if not kanji_path.exists():
        kanji_path = excluded_word_dir / "kanji_1word"

    kanji_words = load_words_from_csv(kanji_path)
    excluded_words.update(kanji_words)
    if kanji_path.exists():
        print(f"【{kanji_path.name} 読み込み成功】: {len(kanji_words)} 個の単語を追加")
    else:
        print("【スキップ】kanji_1word ファイルが見つかりませんでした")

    elementary_files = ["elementary1.csv", "elementary2.csv", "elementary3.csv"]
    for file_name in elementary_files:
        elem_path = excluded_word_dir / file_name
        elem_words = load_words_from_csv(elem_path)
        excluded_words.update(elem_words)
        if elem_path.exists():
            print(f"【{file_name} 読み込み成功】: {len(elem_words)} 個の単語を追加")
        else:
            print(f"【スキップ】{file_name} が見つかりませんでした")

    hiragana_path = excluded_word_dir / "hiragana.csv"
    hiragana_words = load_words_from_csv(hiragana_path)
    excluded_words.update(hiragana_words)
    if hiragana_path.exists():
        print(f"【hiragana.csv 読み込み成功】: {len(hiragana_words)} 個の単語を追加")
    else:
        print(f"【スキップ】hiragana.csv が見つかりませんでした: {hiragana_path}")

    medical_path = excluded_word_dir / "medical_words.csv"
    medical_words = load_words_from_csv(medical_path)
    excluded_words.update(medical_words)
    if medical_path.exists():
        print(f"【medical_words.csv 読み込み成功】: {len(medical_words)} 個の単語を追加")
    else:
        print(f"【スキップ】medical_words.csv が見つかりませんでした: {medical_path}")

    same_words_path = excluded_word_dir / "same_words.csv"
    same_words = load_words_from_csv(same_words_path)
    excluded_words.update(same_words)
    if same_words_path.exists():
        print(f"【same_words.csv 読み込み成功】: {len(same_words)} 個の単語を追加")
    else:
        print(f"【スキップ】same_words.csv が見つかりませんでした: {same_words_path}")

    keep_words = {
        "誤る",
        "養護者",
        "徐々に",
        "専念する",
        "動機",
        "危篤",
        "やむを得ず",
        "在宅復帰",
        "区域",
        "事業",
        "議論",
        "専門学校",
        "切磋琢磨",
        "昇進",
        "用意する",
        "解釈する",
        "末期",
        "下降",
        "厳禁",
    }

    excluded_words.difference_update(keep_words)

    print(f"\n【除外対象の総単語数】: {len(excluded_words)} 種類\n")

    combined_text = ""
    loaded_files_count = 0

    for num in range(29, 39):
        file_path = kakomon_dir / f"kaigo_kakomon_{num}.txt"

        if file_path.exists():
            with open(file_path, "r", encoding="utf-8") as f:
                combined_text += f.read() + "\n"
            print(f"【読み込み成功】: {file_path.name}")
            loaded_files_count += 1
        else:
            print(f"【スキップ（ファイルなし）】: {file_path.name}")

    print("\n" + "=" * 50)
    print(f"読み込み完了ファイル数: {loaded_files_count} / 10")
    print(f"合計文字数: {len(combined_text)} 文字")
    print("=" * 50 + "\n")

    if not combined_text.strip():
        print("【エラー】読み込めるテキストファイルがありませんでした。")
        exit()

    terms = extract_kanji2_terms(
        combined_text, excluded_words, keep_words, mode=SplitMode.C
    )

    word_counts = Counter((item["base_form"], item["pos"]) for item in terms)

    first_surfaces = {}
    for item in terms:
        key = (item["base_form"], item["pos"])
        if key not in first_surfaces:
            first_surfaces[key] = item["surface"]

    multi_count = sum(1 for c in word_counts.values() if c >= 2)
    print(f"抽出された総単語数: {len(terms)} 個")
    print(f"漢字2文字単語の種類数（重複なし）: {len(word_counts)} 種類")
    print(f"2回以上出現した単語: {multi_count} 種類")
    print("\n" + "=" * 50 + "\n")

    output_csv_path = current_dir / "kanji2_word_counts.csv"

    with open(output_csv_path, "w", encoding="utf_8_sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["順位", "原形（辞書形）", "文章中表記", "品詞", "出現回数"])

        rank = 1
        for (base_form, pos), count in word_counts.most_common():
            surface = first_surfaces[(base_form, pos)]
            writer.writerow([rank, base_form, surface, pos, count])
            rank += 1

    print(f"【保存完了】全 {len(word_counts)} 件の漢字2文字単語を保存しました:")
    print(f"ファイル名: {output_csv_path}")
