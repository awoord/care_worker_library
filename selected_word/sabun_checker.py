import csv
from pathlib import Path

# 1. このプログラム（.py）が置いてあるフォルダの場所を取得
current_dir = Path(__file__).resolve().parent

# 2. 比較したい2つのCSVファイル名を設定
file_a_path = current_dir / "extracted.csv"  # 1つ目のファイル名
file_b_path = current_dir / "in_db.csv"  # 2つ目のファイル名


# 3. CSVファイルの1列目のデータを読み込む関数
def read_first_column(file_path):
    words = set()
    if file_path.exists():
        with open(file_path, mode="r", encoding="utf-8-sig") as f:
            reader = csv.reader(f)
            for row in reader:
                if row:
                    word = row[0].strip()
                    if word:
                        words.add(word)
    return words


# 4. それぞれのファイルから単語を取り出す
words_a = read_first_column(file_a_path)
words_b = read_first_column(file_b_path)

# 5. 差分を計算する
only_in_a = words_a - words_b  # file_a だけにある単語
only_in_b = words_b - words_a  # file_b だけにある単語

# 6. 結果を画面に表示する
print("=" * 40)
print(f"{file_a_path.name} の件数: {len(words_a)} 件")
print(f"{file_b_path.name} の件数: {len(words_b)} 件")
print("=" * 40)

if only_in_a:
    print(f"\n【{file_a_path.name} だけに入っている単語】（{len(only_in_a)} 件）:")
    for word in only_in_a:
        print(word)

if only_in_b:
    print(f"\n【{file_b_path.name} だけに入っている単語】（{len(only_in_b)} 件）:")
    for word in only_in_b:
        print(word)

if not only_in_a and not only_in_b:
    print("\n2つのファイルに差分はありません（中身は一致しています）。")
