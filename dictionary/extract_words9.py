import re
from collections import Counter
from pathlib import Path
from sudachipy import Dictionary, SplitMode


def extract_general_terms(text):
    """
    文章から助詞・助動詞・記号などを除外し、
    学習対象となる単語（名詞・動詞・形容詞・副詞）の辞書形（原形）を取り出す関数
    """
    tokenizer = Dictionary().create()

    # 分割モードを Cモード（長単位）に設定
    split_mode = SplitMode.C

    # 抽出対象とする主要品詞（助詞・助動詞・記号を除外）
    target_pos = ["名詞", "動詞", "形容詞", "副詞"]

    results = []

    # テキストを改行ごとに分解して1行ずつ処理する
    for line in text.splitlines():
        # 空白行は処理をスキップする
        if not line.strip():
            continue

        # 1行ごとにトークナイズを実行
        for token in tokenizer.tokenize(line, split_mode):
            pos_parts = token.part_of_speech()
            pos_main = pos_parts[0]  # 大分類（名詞、動詞等）
            pos_sub = pos_parts[1]  # 細分類（数、非自立等）

            # 1. 助詞・助動詞・記号を除外
            if pos_main in target_pos:
                # 2. 数字（「1」など）を除外
                if pos_sub in ["数", "数詞"]:
                    continue

                results.append(
                    {
                        "base_form": token.dictionary_form(),  # 辞書形
                        "surface": token.surface(),  # 文章中の表記
                        "pos": pos_main,  # 品詞
                    }
                )

    return results


if __name__ == "__main__":
    # --------------------------------------------------
    # ファイルパスの設定
    # --------------------------------------------------
    current_dir = Path(__file__).resolve().parent

    file_path = current_dir.parent / "kakomon" / "kaigo_kakomon_3.txt"

    if not file_path.exists():
        file_path = current_dir.parent.parent / "kakomon" / "kaigo_kakomon_3.txt"

    # --------------------------------------------------
    # ファイル読み込みと処理実行
    # --------------------------------------------------
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            sample_text = f.read()

        print(f"【読み込み成功】: {file_path}")
        print("\n" + "=" * 50 + "\n")

        terms = extract_general_terms(sample_text)

        # 1. ひらがな1文字の単語だけを取り出し、(原形, 表記, 品詞) の組みを作成する
        target_words = [
            (item["base_form"], item["surface"], item["pos"])
            for item in terms
            #if re.fullmatch(r"[ぁ-ん]", item["surface"])
            if re.fullmatch(r"[ぁ-ん]{5}", item["surface"])
        ]

        # 2. 同じ組みが何回出てきたかを自動で集計する
        counts = Counter(target_words)

        print("【抽出された単語一覧（ひらがな1文字・重複なし・出現回数付き）】")
        # 3. 集計結果を1つずつ取り出して表示する
        for (base_form, surface, pos), count in counts.items():
            print(
                f"原形（辞書形）: {base_form:<8} | 文章中表記: {surface:<8} | 品詞: {pos:<6} | 出現回数: {count}回"
            )

    except FileNotFoundError:
        print(f"【エラー】ファイルが見つかりません: {file_path}")
        print("パスの配置を確認してください。")
