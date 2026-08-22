import csv
from pathlib import Path

# 1. このプログラム（.py）が置いてあるフォルダの場所を取得
current_dir = Path(__file__).resolve().parent

# 2. ファイル名を設定
target_file_path = current_dir / "duplicates.csv"  # データを削りたい対象のファイル
remove_list_path = current_dir / "sumi.csv"  # 重複していたら消したい単語が入っているファイル
output_file_path = current_dir / "duplicates.csv"  # 削除後に残ったデータを保存するファイル

# 3. 削除対象の単語（remove_list.csv）を読み込んで記録する
remove_words = set()
with open(remove_list_path, mode="r", encoding="utf-8-sig") as f:
    reader = csv.reader(f)
    for row in reader:
        if row:
            word = row[0].strip()
            if word:
                remove_words.add(word)

# 4. target.csv を読み込み、重複していない行だけを残す
kept_rows = []  # 残す行を入れるリスト
removed_rows = []  # 削除した行を入れるリスト

with open(target_file_path, mode="r", encoding="utf-8-sig") as f:
    reader = csv.reader(f)
    for row in reader:
        if row:
            word = row[0].strip()
            # 削除対象リストに含まれている場合は除外する
            if word in remove_words:
                removed_rows.append(row)
            # 含まれていない場合は残す
            else:
                kept_rows.append(row)

# 5. 残ったデータを新しいCSVファイルに書き込む
with open(output_file_path, mode="w", encoding="utf-8-sig", newline="") as f:
    writer = csv.writer(f)
    writer.writerows(kept_rows)

# 6. 除外されたデータを画面に表示する
print("=" * 40)
print(f"【除外されたデータ一覧】（合計: {len(removed_rows)} 件）")
print("=" * 40)
for row in removed_rows:
    print(",".join(row))

print("\n" + "=" * 40)
print(f"処理が完了しました。残ったデータを保存しました: {output_file_path.name}")
print("=" * 40)
