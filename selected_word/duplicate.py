import csv
from pathlib import Path

# 1. このプログラム（.py）と同じフォルダの場所を取得
current_dir = Path(__file__).resolve().parent

file_a_path = current_dir / "in_db.csv"
file_b_path = current_dir / "extracted.csv"


# 2. CSVファイルの1列目から単語を取り出す関数
def get_words(file_path):
    words = set()
    if file_path.exists():
        with open(file_path, mode="r", encoding="utf-8-sig") as f:
            reader = csv.reader(f)
            for row in reader:
                if row:  # 空の行でなければ
                    word = row[0].strip()
                    if word:
                        words.add(word)
    return words


# 3. a.csv と b.csv の単語を読み込む
words_a = get_words(file_a_path)
words_b = get_words(file_b_path)

# 4. 両方のファイルに共通して入っている単語（重複している単語）を取り出す
duplicate_words = words_a & words_b

# 5. 結果を画面に表示する
print("=" * 40)
print(f"重複している単語一覧（合計: {len(duplicate_words)} 件）")
print("=" * 40)

if duplicate_words:
    for word in sorted(duplicate_words):
        print(word)
else:
    print("重複している単語はありませんでした。")
