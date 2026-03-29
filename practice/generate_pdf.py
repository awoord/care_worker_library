import json
import os
import webbrowser
from pathlib import Path
from jinja2 import Environment, FileSystemLoader

def generate_and_show():
    # 1. 自身のファイルが存在するディレクトリの絶対パスを取得（パス問題の解決）
    base_dir = Path(__file__).resolve().parent
    
    json_path = base_dir / 'words.json'
    template_path = 'template.j2'  # FileSystemLoaderにbase_dirを渡すためファイル名のみ
    temp_html_path = base_dir / 'temp.html'

    # 2. JSONデータの読み込み
    if not json_path.exists():
        print(f"エラー: {json_path} が見つかりません。")
        return

    with open(json_path, 'r', encoding='utf-8') as f:
        words_data = json.load(f)

    # 3. Jinja2テンプレートの設定
    # テンプレートを探す場所を base_dir (practiceフォルダ) に固定
    env = Environment(loader=FileSystemLoader(str(base_dir)))
    try:
        template = env.get_template(template_path)
    except Exception as e:
        print(f"エラー: テンプレートが見つかりません。 {e}")
        return

    # 4. データをHTMLに流し込む
    html_content = template.render(words=words_data)
    
    # HTMLファイルとして保存
    with open(temp_html_path, 'w', encoding='utf-8') as f:
        f.write(html_content)

    # 5. OSのデフォルトブラウザでHTMLファイルを開く
    # 絶対パスで指定（file:// スキーマを使用）
    temp_html_url = f"file://{temp_html_path.absolute()}"
    print(f"ブラウザを開いて {temp_html_path} を表示します...")
    webbrowser.open(temp_html_url)

if __name__ == "__main__":
    generate_and_show()
