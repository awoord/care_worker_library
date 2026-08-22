import csv
from pathlib import Path

# 1. このプログラム（.py）が置いてあるフォルダの場所を取得
current_dir = Path(__file__).resolve().parent

# 2. 合体させたい2つのファイル名と、保存先のファイル名を設定
file1_path = current_dir / "gpt.csv"  # 1つ目のCSVファイル名に変更してください
file2_path = current_dir / "gpt.csv"  # 2つ目のCSVファイル名に変更してください
output_file_path = current_dir / "merged.csv"  # 合体後の保存ファイル名

# 3. 2つのファイルを順番に読み込み、重複を排除してまとめる
seen_words = set()  # 既に追加した単語を記録する箱
merged_rows = []  # 合体後のデータを入れるリスト

for file_path in [file1_path, file2_path]:
    if file_path.exists():
        with open(file_path, mode="r", encoding="utf-8-sig") as f:
            reader = csv.reader(f)
            for row in reader:
                if row:
                    word = row[0].strip()
                    # まだリストに入っていない単語だけを追加する
                    if word and word not in seen_words:
                        seen_words.add(word)
                        merged_rows.append(row)

# 4. まとめたデータを新しいCSVファイルに書き出す
with open(output_file_path, mode="w", encoding="utf-8-sig", newline="") as f:
    writer = csv.writer(f)
    writer.writerows(merged_rows)

print(f"合体処理が完了しました。合計 {len(merged_rows)} 件を保存しました: {output_file_path.name}")
