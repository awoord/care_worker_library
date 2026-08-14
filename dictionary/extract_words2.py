from janome.tokenizer import Tokenizer

def extract_general_terms(text):
    """
    文章から助詞・助動詞・記号などを除外し、
    学習対象となる単語（名詞・動詞・形容詞・副詞）の辞書形（原形）を取り出す関数
    """
    tokenizer = Tokenizer()
    
    # 抽出対象とする主要品詞（助詞・助動詞・記号を除外）
    target_pos = ["名詞", "動詞", "形容詞", "副詞"]
    
    results = []
    for token in tokenizer.tokenize(text):
        pos_parts = token.part_of_speech.split(',')
        pos_main = pos_parts[0]  # 大分類（名詞、動詞等）
        pos_sub = pos_parts[1]   # 細分類（数、非自立等）
        
        # 1. 助詞・助動詞・記号を除外
        if pos_main in target_pos:
            # 2. 数字（「1」など）を除外
            if pos_sub == "数":
                continue
                
            results.append({
                "base_form": token.base_form,  # 辞書形（例：「選び」→「選ぶ」）
                "surface": token.surface,      # 文章中の表記（例：「選び」）
                "pos": pos_main                # 品詞
            })
            
    return results


if __name__ == "__main__":
    sample_text = "次の記述のうち、介護保険制度における一人暮らしの要支援者を支えるサービスの内容として、適切なものを1つ選びなさい。"

    print("【対象文章】")
    print(sample_text)
    print("\n" + "=" * 50 + "\n")

    terms = extract_general_terms(sample_text)

    print("【抽出された一般用語・単語一覧（原形）】")
    for item in terms:
        print(f"原形（辞書形）: {item['base_form']:<8} | 文章中表記: {item['surface']:<8} | 品詞: {item['pos']}")
