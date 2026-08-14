from janome.tokenizer import Tokenizer

def extract_and_print_words(text, filter_pos=None):
    """
    文章から単語を抜き出してprint表示する関数
    
    :param text: 対象の日本語文章
    :param filter_pos: 抽出したい品詞のリスト（例: ['名詞', '動詞', '形容詞', '副詞']）
                       Noneの場合は助詞や記号を含むすべての単語を表示します。
    """
    tokenizer = Tokenizer()
    
    print("=== 抽出結果 ===")
    for token in tokenizer.tokenize(text):
        pos_main = token.part_of_speech.split(',')[0]  # 品詞の大分類（名詞、動詞、助詞など）
        surface = token.surface                       # 文章中での表記（例：選び）
        base_form = token.base_form                   # 辞書形・原形（例：選ぶ）

        # 品詞フィルターが指定されている場合は絞り込み
        if filter_pos is None or pos_main in filter_pos:
            print(f"単語: {surface:<8} (原形: {base_form:<8}) [品詞: {pos_main}]")


if __name__ == "__main__":
    # 例題となる文章
    sample_text = "次の記述のうち、介護保険制度における一人暮らしの要支援者を支えるサービスの内容として、適切なものを1つ選びなさい。"

    print("【対象文章】")
    print(sample_text)
    print("\n" + "-" * 50 + "\n")

    # 1. すべての構成単語を表示する場合
    print("[パターン1: 全単語の抽出]")
    extract_and_print_words(sample_text)

    print("\n" + "-" * 50 + "\n")

    # 2. 一般用語のデータベース作成用に主要な品詞（名詞・動詞・形容詞・副詞）のみに絞り込む場合
    print("[パターン2: 名詞・動詞・形容詞・副詞のみ抽出]")
    target_pos = ["名詞", "動詞", "形容詞", "副詞"]
    extract_and_print_words(sample_text, filter_pos=target_pos)
