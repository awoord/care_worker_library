# deploy/ — FTPデプロイ本体

| スクリプト | 用途 |
|------------|------|
| `auto_upload.py` | `test/` → `/test/` |
| `deploy_prod.py` | ルートの index/css/js → 本番 |
| `deploy_test_to_prod.py` | test をルートへコピーして本番へ（注意） |

ルート直下の同名スクリプトは、ここを呼ぶ互換ラッパーです。

サイト別デプロイは各所にあります:

- `kaigo/kakomon/deploy_kakomon.py`
- `kaigo/kakomon/themes/deploy_themes.py`
- `kaigo/p/deploy_private.py`
- `kaigo/words/deploy_kaigo_words.py`
