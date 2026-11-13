#!/bin/bash
# 项目台 · 清理开发过程中的临时文件
# 用法：bash tools/maintain/cleanup.sh
# 注意：不会删除 build/ 下的安装包与日志，需要保留请手动清理。
set -uo pipefail
# tools/maintain/ → 上两级才是仓库根目录
cd "$(dirname "$0")/../.." || exit 1

rm -rf .tmp .probe
# icon.iconset 是 iconutil 的中间产物，由 make_icon.py 重新生成
rm -rf src-tauri/icons/icon.iconset

# 跳过工具链目录与构建产物，避免误删耗时重建
find . -name ".DS_Store" \
  -not -path "./node_modules/*" \
  -not -path "./src-tauri/target/*" \
  -not -path "./build/*" \
  -delete 2>/dev/null

echo "清理完成"
