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
    # 現在のPythonスクリプトが存在するディレクトリを取得
    current_dir = Path(__file__).resolve().parent

    # ケース1: extract_words2.py が dictionary フォルダ直下にある場合
    # dictionary/ → (親) → kakomon/kaigo_kakomon_3.txt
    file_path = current_dir.parent / "kakomon" / "sample.txt"

    # ケース2: extract_words2 がフォルダで、その中にスクリプトがある場合
    if not file_path.exists():
        # dictionary/extract_words2/ → (親) → (親) → kakomon/kaigo_kakomon_3.txt
        file_path = current_dir.parent.parent / "kakomon" / "sample.txt"

    # --------------------------------------------------
    # ファイル読み込みと処理実行
    # --------------------------------------------------
    try:
        # 指定されたテキストファイルをUTF-8で読み込み
        with open(file_path, "r", encoding="utf-8") as f:
            sample_text = f.read()

        print(f"【読み込み成功】: {file_path}")
        print("【対象文章】")
        print(sample_text)
        print("\n" + "=" * 50 + "\n")

        terms = extract_general_terms(sample_text)

        print("【抽出された一般用語・単語一覧（原形）】")
        for item in terms:
            print(
                f"原形（辞書形）: {item['base_form']:<8} | 文章中表記: {item['surface']:<8} | 品詞: {item['pos']}"
            )
            
    except FileNotFoundError:
        print(f"【エラー】ファイルが見つかりません: {file_path}")
        print("パスの配置を確認してください。")
