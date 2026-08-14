import re
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
    # Cモード（長単位）でトークナイズを実行
    for token in tokenizer.tokenize(text, split_mode):
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
                    "base_form": token.dictionary_form(),  # 辞書形（例：「選び」→「選ぶ」）
                    "surface": token.surface(),  # 文章中の表記（例：「選び」）
                    "pos": pos_main,  # 品詞
                }
            )

    return results


if __name__ == "__main__":
    # --------------------------------------------------
    # ファイルパスの設定
    # --------------------------------------------------
    current_dir = Path(__file__).resolve().parent

    file_path = current_dir.parent / "kakomon" / "kaigo_kakomon_38.txt"

    if not file_path.exists():
        file_path = current_dir.parent.parent / "kakomon" / "kaigo_kakomon_38txt"

    # --------------------------------------------------
    # ファイル読み込みと処理実行
    # --------------------------------------------------
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            sample_text = f.read()

        print(sample_text)
        print("\n" + "=" * 50 + "\n")

        terms = extract_general_terms(sample_text)

        print("【抽出された単語一覧（ひらがな1文字の単語のみ）】")
        for item in terms:
            # 文章中の表記（surface）が「ひらがな1文字だけ」かどうかを判定
            if re.fullmatch(r"[ぁ-ん]", item["surface"]):
                print(
                    f"原形（辞書形）: {item['base_form']:<8} | 文章中表記: {item['surface']:<8} | 品詞: {item['pos']}"
                )

    except FileNotFoundError:
        print(f"【エラー】ファイルが見つかりません: {file_path}")
        print("パスの配置を確認してください。")
