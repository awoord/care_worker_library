# care_worker_library — フォルダ地図

ルートは **公開サイト** と **入口スクリプト** だけ。  
データ・作業・デプロイ本体は下の3つに分けています。

## ルートの見方

| 名前 | 役割 |
|------|------|
| `kaigo/` | 公開サイト（過去問・テーマ・words・秘密URL） |
| `test/` | ことばアプリ（テスト版 → `/test/`） |
| `index.html` 等 | ことば本番（J・ルート） |
| `gas/` | Google Apps Script |
| `keyword_kakomon/` | 過去問の抽出・解答取得スクリプト |
| **`data/`** | 過去問全文などのデータ |
| **`work/`** | 選語・抽出・テーマ元テキストなどの作業場 |
| **`deploy/`** | FTPデプロイ本体 |
| `auto_upload.py` 等 | 旧コマンド互換の薄いラッパー → `deploy/` へ |

## よく使う操作

| やりたいこと | コマンド |
|--------------|----------|
| 過去問検索を公開 | `python3 kaigo/kakomon/deploy_kakomon.py` |
| テーマ過去問を公開 | `python3 kaigo/kakomon/themes/deploy_themes.py` |
| ことばテスト版を上げる | `python3 auto_upload.py`（中身は `deploy/auto_upload.py`） |
| ことば秘密URL | `python3 kaigo/p/deploy_private.py` |
| ルート本番（J） | `python3 deploy_prod.py` |

## データの流れ

```
data/kakomon_v2/（全文・現行）
  → keyword_kakomon / deploy_kakomon.py
  → kaigo/kakomon/（公開）

work/theme_extract/*.txt
  → themes/deploy_themes.py
  → kaigo/kakomon/themes/（重要テーマ）

work/appendix_extract/*.txt
  → themes/deploy_themes.py
  → kaigo/kakomon/appendix/（付録）
```

## 詳細

- `data/README.md`
- `work/README.md`
- `deploy/README.md`
- `kaigo/README.md`
