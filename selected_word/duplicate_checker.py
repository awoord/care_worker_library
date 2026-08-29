import csv
from collections import Counter
from pathlib import Path

# 1. 調べたいCSVファイルの名前を指定する
target_file_name = "in_db.csv"  # ここを確認したいCSVファイル名に変更してください

# プログラム（.py）と同じフォルダにあるファイルを指定
current_dir = Path(__file__).resolve().parent
file_path = current_dir / target_file_name

if not file_path.exists():
    print(f"ファイルが見つかりません: {file_path.name}")
    exit()

# 2. 1列目の単語をすべて取り出してリストに集める
words = []
with open(file_path, mode="r", encoding="utf-8-sig") as f:
    reader = csv.reader(f)
    for row in reader:
        if row:  # 空行でなければ
            word = row[0].strip()
            if word:
                words.append(word)

# 3. 各単語が何回出てきたかを数える
counts = Counter(words)

# 4. 2回以上出てきた単語（重複）だけを抜き出す
duplicates = {word: count for word, count in counts.items() if count > 1}

# 5. 結果を画面に表示する
print("=" * 40)
print(f"対象ファイル: {file_path.name}")
print(f"1列目の総単語数: {len(words)} 件")
print(f"重複している単語の種類数: {len(duplicates)} 種類")
print("=" * 40)

if duplicates:
    print("\n【重複している単語一覧（出現回数）】")
    for word, count in duplicates.items():
        print(f"・{word}: {count}回")
else:
    print("\n重複している単語はありませんでした。")
