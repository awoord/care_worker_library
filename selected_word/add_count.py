import csv
from pathlib import Path

# 1. プログラム（.py）と同じフォルダの場所を取得
current_dir = Path(__file__).resolve().parent

requested_path = current_dir / "requested.csv"
extracted_path = current_dir / "extracted.csv"

# 2. extracted.csv を読み込み、「言葉」と「数字」を記録する
extracted_data = {}  # 言葉と数字の組み合わせ表
extracted_rows = []  # extracted.csv の全データ

with open(extracted_path, mode="r", encoding="utf-8-sig") as f:
    reader = csv.reader(f)
    for row in reader:
        if row:
            word = row[0].strip()
            count = row[1].strip() if len(row) > 1 else "0"
            extracted_data[word] = count
            extracted_rows.append([word, count])

# 3. requested.csv を読み込み、同じ言葉があればその数字を、なければ「0」を2列目に入れる
updated_requested_rows = []
matched_words = set()  # 一致した単語を記録する箱

with open(requested_path, mode="r", encoding="utf-8-sig") as f:
    reader = csv.reader(f)
    for row in reader:
        if row:
            word = row[0].strip()
            # extracted.csv に同じ言葉がある場合
            if word in extracted_data:
                count = extracted_data[word]
                updated_requested_rows.append([word, count])
                matched_words.add(word)
            # 同じ言葉がない場合は「0」を入れる
            else:
                updated_requested_rows.append([word, "0"])

# 4. requested.csv に結果を上書き保存する
with open(requested_path, mode="w", encoding="utf-8-sig", newline="") as f:
    writer = csv.writer(f)
    writer.writerows(updated_requested_rows)

# 5. extracted.csv から一致した単語を削除し、残ったデータで上書き保存する
remaining_extracted_rows = [
    row for row in extracted_rows if row[0] not in matched_words
]

with open(extracted_path, mode="w", encoding="utf-8-sig", newline="") as f:
    writer = csv.writer(f)
    writer.writerows(remaining_extracted_rows)

print(f"移動した単語数: {len(matched_words)} 件")
print("両方のファイルの更新が完了しました。")
