from collections import Counter
from pathlib import Path
from sudachipy import Dictionary, SplitMode


def extract_general_terms(text, mode=SplitMode.C):
    """
    文章から助詞・助動詞・記号などを除外し、
    学習対象となる単語（名詞・動詞・形容詞・副詞）の辞書形（原形）を取り出す関数
    """
    tokenizer = Dictionary().create()

    # 抽出対象とする主要品詞（助詞・助動詞・記号を除外）
    target_pos = ["名詞", "動詞", "形容詞", "副詞"]
    target_pos = ["動詞", "形容詞", "副詞"]
    target_pos = ["形容詞", "副詞"]
    target_pos = ["副詞"]
    target_pos = ["名詞"]
    target_pos = ["動詞"]
    target_pos = ["形容詞"]
    target_pos = ["名詞"]
    
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
        print(f"【テキスト全体の文字数】: {len(sample_text)} 文字")
        print("\n" + "=" * 50 + "\n")

        # ★ Cモード（長単位）から Aモード（短単位）に変更して実行します
        terms = extract_general_terms(sample_text, mode=SplitMode.A)

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

        print("【出現回数が多い順（上位30件）】")
        # .most_common(30) で上位30件だけに絞って表示
        for (base_form, pos), count in word_counts.most_common(1000):
            surface = first_surfaces[(base_form, pos)]
            print(
                f"原形: {base_form:<12} | 文章中表記: {surface:<12} | 品詞: {pos:<6} | 出現回数: {count}回"
            )

    except FileNotFoundError:
        print(f"【エラー】ファイルが見つかりません: {file_path}")
        print("パスの配置を確認してください。")
