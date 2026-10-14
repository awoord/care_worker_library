# work/selected_word/ — 単語の選別作業

| ファイル / スクリプト | 用途 |
|------------------------|------|
| `db_words.csv` | DBにある語 |
| `extracted.csv` | 抽出結果 |
| `text_woreds.csv` | 手入力 → 出現回数付きで上書き |
| `refresh_text_words.py` | **ワンクリック**: 最新db取得 → 重複除外 → 出現数 |
| `count_text_words_in_kakomon.py` | 手元の db_words.csv だけで除外＋出現数 |
| `remove_db_from_extracted.py` | extracted から db語を除く |

```bash
# text_woreds.csv に語を入れたあと
python3 work/selected_word/refresh_text_words.py
```
