import collections
import re
from janome.tokenizer import Tokenizer
from janome.analyzer import Analyzer
from janome.tokenfilter import CompoundNounFilter

# 1. テキストの読み込み
with open("../kakomon/kaigo_kakomon_3.txt", "r", encoding="utf-8") as f:
    text = f.read()

# 2. 分析器（Analyzer）の準備
tokenizer = Tokenizer()
token_filters = [CompoundNounFilter()]
a = Analyzer(tokenizer=tokenizer, token_filters=token_filters)

extracted_words = []

# 3. 単語の抽出と振り分け
for token in a.analyze(text):
    pos = token.part_of_speech.split(",")[0]

    # --- 名詞の抽出 ---
    if pos == "名詞":
        if re.match(r"^[一-龠]{2,}$", token.surface):
            extracted_words.append(token.surface)
        elif re.match(r"^[ァ-ヶー]{2,}$", token.surface):
            extracted_words.append(token.surface)

    # --- 動詞の抽出（追加箇所） ---
    elif pos == "動詞":
        # 「伝える」「控える」などの基本形（辞書形）を抽出
        # 漢字を含む動詞のみを対象とする場合は re.search(r'[一-龠]', token.base_form) を使用
        verb = token.base_form
        if re.search(r"[一-龠]", verb):  # 漢字を含む動詞に限定
            extracted_words.append(verb)

    # 3. 形容詞の抽出（追加箇所）
    elif pos == "形容詞":
        adj = token.base_form
        # 「明るい」「痛い」など、漢字を含む形容詞を抽出
        if re.search(r"[一-龠]", adj):
            extracted_words.append(adj)

    # 4. 副詞の抽出（追加箇所）
    elif pos == "副詞":
        adv = token.base_form
        # 「非常に」「時々」など、すべての副詞を抽出
        # 漢字を含まない「ゆっくり」なども重要なら re.search を外しても良い
        extracted_words.append(adv)

# 4. 出現回数のカウント
word_count = collections.Counter(extracted_words)

# 5. 結果の出力（頻度順）
for word, count in word_count.most_common()[0:1000]:
    print(f"{word}\t{count}")
