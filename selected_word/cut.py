import csv
from pathlib import Path

# 1. このプログラム（.py）と同じフォルダの場所を取得
current_dir = Path(__file__).resolve().parent

file_a_path = current_dir / "extracted_without_cut.csv"
file_b_path = current_dir / "in_db.csv"
output_file_path = current_dir / "extracted_without_cut.csv"  # 新しく保存するファイル名

# 2. b.csv の1列目にある単語を読み込んで記録する
b_words = set()
if file_b_path.exists():
    with open(file_b_path, mode="r", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        for row in reader:
            if row:
                word = row[0].strip()
                if word:
                    b_words.add(word)

# 3. a.csv を読み込み、b.csv にない単語の行だけを残す
kept_rows = []
if file_a_path.exists():
    with open(file_a_path, mode="r", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        for row in reader:
            if row:
                word = row[0].strip()
                # b.csv に含まれていない単語だけをリストに追加
                if word not in b_words:
                    kept_rows.append(row)

# 4. 新しいファイル（a_without_b.csv）に書き出す（a.csv は上書きされません）
with open(output_file_path, mode="w", encoding="utf-8-sig", newline="") as f:
    writer = csv.writer(f)
    writer.writerows(kept_rows)

print("処理が完了しました。")
print(f"除外後に残った件数: {len(kept_rows)} 件")
print(f"新しいファイルとして保存しました: {output_file_path.name}")
