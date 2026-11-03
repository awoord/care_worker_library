# work/ — 作業場（公開しない）

| フォルダ | 内容 |
|----------|------|
| `deploy_themes.py` | 重要テーマ・パート・参考・付録の公開 |
| `theme_extract/` | 重要テーマの元 .txt → `deploy_themes.py` |
| `part_extract/A` `B` `C` | A・B・Cパートの元 .txt → 同上 |
| `reference_extract/` | 参考テーマの元 .txt → 同上 |
| `appendix_extract/` | 付録テーマの元 .txt → 同上 |
| `selected_word/` | 採用候補・db突合せ・出現回数 |
| `excluded_word/` | 抽出から除外する語 |
| `extractor/` | 形態素などで語を抜く |
| `books/` | 単語帳 HTML 生成 |

例:

```bash
python3 work/selected_word/refresh_text_words.py
python3 work/deploy_themes.py
```
