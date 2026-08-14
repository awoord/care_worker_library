# ① ライブラリ（便利な道具が入った箱を読み込む）
import random


# ② 関数（どこからでも単体で呼び出せる命令）
def print_title(text):
    print(f"=== {text} ===")


# ③ クラス（作成するモノの設計図）
class Dog:
    def __init__(self, name):
        self.name = name

    # ⑤ メソッド（クラスの中で定義された、そのモノ専用の命令）
    def bark(self):
        print(f"{self.name}「ワンワン！」")


# --- 実行部分 ---

# 関数の呼び出し（ドットなし）
print_title("犬ロボットのテスト")

# ④ インスタンス（設計図から作った実際のデータ）
my_dog = Dog("ポチ")

# メソッドの呼び出し（ドットあり）
my_dog.bark()

# ライブラリの機能を使用
luck_number = random.randint(1, 10)
print(f"今日のラッキー数字: {luck_number}")
