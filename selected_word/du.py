import csv
from pathlib import Path

# 1. このプログラムが置いてあるフォルダの場所を取得
current_dir = Path(__file__).resolve().parent

# 2. 比較する2つのファイル名と、結果を保存するファイル名を設定
file1_path = current_dir / "pri_gemini.csv"  # 1つ目のCSVファイル名に変更してください
file2_path = current_dir / "pri_gpt.csv"  # 2つ目のCSVファイル名に変更してください
output_path = current_dir / "duplicates.csv"  # 出力されるCSVファイル名

# 3. 1つ目のファイル（file1.csv）の内容を読み込んで記録する
file1_data = set()
with open(file1_path, mode="r", encoding="utf-8-sig") as f:
    reader = csv.reader(f)
    for row in reader:
        if row:  # 空の行は無視する
            # 1列目の単語（文字）を前後の余白を消して登録
            word = row[0].strip()
            if word:
                file1_data.add(word)

# 4. 2つ目のファイル（file2.csv）を上から確認し、重複している行だけを書き出す
written_words = set()  # 結果ファイル内で同じ単語が二重に出るのを防ぐための記録

with open(file2_path, mode="r", encoding="utf-8-sig") as in_f, \
     open(output_path, mode="w", encoding="utf-8-sig", newline="") as out_f:
    
    reader = csv.reader(in_f)
    writer = csv.writer(out_f)
    
    for row in reader:
        if row:
            word = row[0].strip()
            # 1つ目のファイルにも存在し、まだ書き出していない単語の場合
            if word in file1_data and word not in written_words:
                writer.writerow(row)  # その行全体を書き出す
                written_words.add(word)

print(f"重複データの抽出が完了しました。保存先: {output_path}")
