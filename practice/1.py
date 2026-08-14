from sudachipy import Dictionary, SplitMode

tokenizer = Dictionary().create()
text = "一人暮らしの要支援者を支えるサービスの内容として、適切なものを1つ選びなさい。"

# 抽出したい品詞（大分類）
target_pos = ["名詞", "動詞", "形容詞"]

# Cモードで分解
tokens = tokenizer.tokenize(text, SplitMode.C)

results = []
for token in tokens:
    # 品詞の大分類（リストの0番目）を取得
    main_pos = token.part_of_speech()[0]
    
    # 目的の品詞が含まれているか判定
    if main_pos in target_pos:
        results.append({
            "surface": token.surface(),
            "dictionary_form": token.dictionary_form(),
            "pos": main_pos
        })

# 結果を表示
for item in results:
    print(f"表記: {item['surface']:<10} | 原形: {item['dictionary_form']:<10} | 品詞: {item['pos']}")
