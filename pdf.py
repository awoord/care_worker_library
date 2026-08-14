import os
from pypdf import PdfReader, PdfWriter

def main():
    # 1. デスクトップのパスを取得
    desktop_path = os.path.join(os.path.expanduser("~"), "Desktop")
    
    # 2. パスの設定
    pdf_a_path = os.path.join(desktop_path, "a_text.pdf")
    pdf_b_path = os.path.join(desktop_path, "b_text.pdf")
    output_path = os.path.join(desktop_path, "mihiraki_output.pdf")
    
    if not os.path.exists(pdf_a_path) or not os.path.exists(pdf_b_path):
        print("エラー: デスクトップにファイルが見つかりません。")
        return

    reader_a = PdfReader(pdf_a_path)
    reader_b = PdfReader(pdf_b_path)
    writer = PdfWriter()
    
    # 3. 先頭（1ページ目）に表紙用の「白紙ページ」を追加
    # Aの最初のページのサイズに合わせて白紙を作ります
    first_page = reader_a.pages[0]
    width = first_page.mediabox.width
    height = first_page.mediabox.height
    writer.add_blank_page(width=width, height=height)
    
    len_a = len(reader_a.pages)
    len_b = len(reader_b.pages)
    
    # 4. 2ページ目以降、AとBを交互に追加（これでAが左、Bが右になります）
    for i in range(max(len_a, len_b)):
        if i < len_a:
            writer.add_page(reader_a.pages[i])
        if i < len_b:
            writer.add_page(reader_b.pages[i])
            
    # 5. 保存
    with open(output_path, "wb") as f:
        writer.write(f)
        
    print(f"見開き用PDFを作成しました: {output_path}")

if __name__ == "__main__":
    main()
