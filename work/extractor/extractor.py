import csv
from collections import Counter
from pathlib import Path
import re
from sudachipy import Dictionary, SplitMode


def extract_general_terms(text, excluded_words, keep_words, mode=SplitMode.C):
    """
    文章から助詞・助動詞・記号・小文字英語・1文字英語・2文字以下のひらがな・
    除外リスト単語を除外し、一般単語・カタカナ語・大文字英略語（2文字以上）を取り出す関数。
    ※keep_words に登録された単語は除外せず必ず抽出する。
    """
    tokenizer = Dictionary().create()

    # 抽出対象とする主要品詞
    target_pos = ["名詞", "動詞", "形容詞", "副詞", "形状詞"]

    results = []

    # テキストを改行ごとに分解して1行ずつ処理する
    for line in text.splitlines():
        # 空白行は処理をスキップする
        if not line.strip():
            continue

        # 指定したモード（Cモード等）でトークナイズを実行
        for token in tokenizer.tokenize(line, mode):
            pos_parts = token.part_of_speech()
            pos_main = pos_parts[0]  # 大分類（名詞、動詞等）
            pos_sub = pos_parts[1]  # 細分類（数、非自立等）
            base_form = token.dictionary_form()  # 辞書形
            surface = token.surface()  # 文章中の表記

            # --- 指定された単語（keep_words）は無条件で残す ---
            if base_form in keep_words or surface in keep_words:
                results.append(
                    {
                        "base_form": base_form,
                        "surface": surface,
                        "pos": pos_main,
                    }
                )
                continue

            # 1. 助詞・助動詞・記号などを除外（対象品詞以外はスキップ）
            if pos_main not in target_pos:
                continue

            # 2. 数字（「1」など）を除外
            if pos_sub in ["数", "数詞"]:
                continue

            # 3. 小文字のアルファベット（a〜z、ａ〜ｚ）を含む単語を除外（例: injury）
            if re.search(r"[a-zａ-ｚ]", surface) or re.search(r"[a-zａ-ｚ]", base_form):
                continue

            # 4. アルファベットを含む場合、大文字2文字以上（例: ADL, BPSD）以外（＝1文字のAやBなど）を除外
            if re.search(r"[A-ZＡ-Ｚ]", surface) or re.search(r"[A-ZＡ-Ｚ]", base_form):
                if not (
                    re.fullmatch(r"[A-ZＡ-Ｚ]{2,}", surface)
                    or re.fullmatch(r"[A-ZＡ-Ｚ]{2,}", base_form)
                ):
                    continue

            # 5. 文字数が2文字以下かつ、ひらがなだけの単語を除外
            if re.fullmatch(r"[ぁ-ん]{1,2}", surface) or re.fullmatch(
                r"[ぁ-ん]{1,2}", base_form
            ):
                continue

            # 6. カタカナ1文字のみの単語を除外（2文字以上のカタカナ語は残す）
            if re.fullmatch(r"[ァ-ヴー・]{1}", surface) or re.fullmatch(
                r"[ァ-ヴー・]{1}", base_form
            ):
                continue

            # 7. 除外リストに含まれる単語を除外
            if base_form in excluded_words or surface in excluded_words:
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
    """
    指定されたCSV・テキストファイルから単語を読み取ってセット（集合）にして返す関数
    """
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
    # --------------------------------------------------
    # フォルダパスの設定
    # --------------------------------------------------
    current_dir = Path(__file__).resolve().parent

    kakomon_dir = current_dir.parent / "kakomon"
    if not kakomon_dir.exists():
        kakomon_dir = current_dir.parent.parent / "kakomon"

    # excluded_wordフォルダのパスを設定（dictionaryフォルダの1つ上にある階層）
    excluded_word_dir = current_dir.parent / "excluded_word"

    # --------------------------------------------------
    # 除外リストの作成（複数のCSVファイルから読み込み）
    # --------------------------------------------------
    excluded_words = set()

    # 1. jlpt5.csv を読み込んで追加
    jlpt5_path = excluded_word_dir / "jlpt5.csv"
    jlpt5_words = load_words_from_csv(jlpt5_path)
    excluded_words.update(jlpt5_words)
    if jlpt5_path.exists():
        print(f"【jlpt5.csv 読み込み成功】: {len(jlpt5_words)} 個の単語を追加")
    else:
        print(f"【スキップ】jlpt5.csv が見つかりませんでした: {jlpt5_path}")

    # 2. done.csv を読み込んで追加
    done_path = excluded_word_dir / "done.csv"
    done_words = load_words_from_csv(done_path)
    excluded_words.update(done_words)
    if done_path.exists():
        print(f"【done.csv 読み込み成功】: {len(done_words)} 個の単語を追加")
    else:
        print(f"【スキップ】done.csv が見つかりませんでした: {done_path}")

    # 3. kanji_1word（.csv / .txt / 拡張子なし）を読み込んで追加
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

    # 4. elementaryの3つのファイルを読み込んで追加
    elementary_files = ["elementary1.csv", "elementary2.csv", "elementary3.csv"]
    for file_name in elementary_files:
        elem_path = excluded_word_dir / file_name
        elem_words = load_words_from_csv(elem_path)
        excluded_words.update(elem_words)
        if elem_path.exists():
            print(f"【{file_name} 読み込み成功】: {len(elem_words)} 個の単語を追加")
        else:
            print(f"【スキップ】{file_name} が見つかりませんでした")

    # 5. hiragana.csv を読み込んで追加
    hiragana_path = excluded_word_dir / "hiragana.csv"
    hiragana_words = load_words_from_csv(hiragana_path)
    excluded_words.update(hiragana_words)
    if hiragana_path.exists():
        print(f"【hiragana.csv 読み込み成功】: {len(hiragana_words)} 個の単語を追加")
    else:
        print(f"【スキップ】hiragana.csv が見つかりませんでした: {hiragana_path}")

    # 6. medical_words.csv を読み込んで追加
    medical_path = excluded_word_dir / "medical_words.csv"
    medical_words = load_words_from_csv(medical_path)
    excluded_words.update(medical_words)
    if medical_path.exists():
        print(f"【medical_words.csv 読み込み成功】: {len(medical_words)} 個の単語を追加")
    else:
        print(f"【スキップ】medical_words.csv が見つかりませんでした: {medical_path}")

    # 7. same_words.csv を読み込んで追加
    same_words_path = excluded_word_dir / "same_words.csv"
    same_words = load_words_from_csv(same_words_path)
    excluded_words.update(same_words)
    if same_words_path.exists():
        print(f"【same_words.csv 読み込み成功】: {len(same_words)} 個の単語を追加")
    else:
        print(f"【スキップ】same_words.csv が見つかりませんでした: {same_words_path}")

    # --------------------------------------------------
    # 除外させない単語リスト（keep_words）
    # --------------------------------------------------
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

    # 除外リスト（excluded_words）の中に指定単語が入っていた場合は削除する
    excluded_words.difference_update(keep_words)

    print(f"\n【除外対象の総単語数】: {len(excluded_words)} 種類\n")

    # --------------------------------------------------
    # 29〜38の10個のファイルを順番に読み込んで結合する
    # --------------------------------------------------
    combined_text = ""
    loaded_files_count = 0

    # 29から38までの数字を順番にループ処理する
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

    # --------------------------------------------------
    # 形態素解析と集計処理
    # --------------------------------------------------
    terms = extract_general_terms(
        combined_text, excluded_words, keep_words, mode=SplitMode.C
    )

    # (原形, 品詞) のペアで数をカウント
    word_counts = Counter((item["base_form"], item["pos"]) for item in terms)

    # 最初に出てきた文章中表記を保持
    first_surfaces = {}
    for item in terms:
        key = (item["base_form"], item["pos"])
        if key not in first_surfaces:
            first_surfaces[key] = item["surface"]

    # 集計結果の全体像を表示
    multi_count = sum(1 for c in word_counts.values() if c >= 2)
    print(f"抽出された総単語数: {len(terms)} 個")
    print(f"単語の種類数（重複なし）: {len(word_counts)} 種類")
    print(f"2回以上出現した単語: {multi_count} 種類")
    print("\n" + "=" * 50 + "\n")

    # --------------------------------------------------
    # CSVファイルへの書き出し処理
    # --------------------------------------------------
    output_csv_path = current_dir / "word_counts.csv"

    # ファイルを開いて書き込む
    with open(output_csv_path, "w", encoding="utf_8_sig", newline="") as f:
        writer = csv.writer(f)

        # 1行目に見出しを書く
        writer.writerow(["順位", "原形（辞書形）", "文章中表記", "品詞", "出現回数"])

        # 全単語を順番に書き込む
        rank = 1
        for (base_form, pos), count in word_counts.most_common():
            surface = first_surfaces[(base_form, pos)]
            writer.writerow([rank, base_form, surface, pos, count])
            rank += 1

    print(f"【保存完了】全 {len(word_counts)} 件の単語を保存しました:")
    print(f"ファイル名: {output_csv_path}")
