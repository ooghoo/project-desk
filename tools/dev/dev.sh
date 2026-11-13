#!/bin/bash
# 项目台 · 开发模式（前端热更新 + Tauri 窗口）
# 用法：bash tools/dev/dev.sh
set -uo pipefail
# tools/dev/ → 上两级才是仓库根目录
cd "$(dirname "$0")/../.." || exit 1
export PATH="$HOME/.cargo/bin:$PATH"
npx tauri dev
