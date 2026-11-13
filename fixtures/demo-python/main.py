"""示例任务：在项目台里点击「运行」时，这段脚本会在 Terminal.app 中执行。

用途：验证运行链路（解释器选择、工作目录、终端输出、退出码、窗口保留）。
"""

import sys
import time

print("项目台 · Python 示例任务")
print(f"解释器：{sys.executable}")
print("工作目录：", end="")
import os

print(os.getcwd())
print("-" * 40)

for i in range(3, 0, -1):
    print(f"倒计时 {i} …", flush=True)
    time.sleep(1)

print("完成：输出会同时写入 runs/<id>/task.log，退出码 0")
sys.exit(0)
