#!/bin/bash
# 项目台 · 后端单元测试
# 用法：bash tools/build/test.sh     日志：build/logs/test.log
set -uo pipefail
# tools/build/ → 上两级才是仓库根目录
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1
mkdir -p build/logs
export PATH="$HOME/.cargo/bin:$PATH"
LOG="$ROOT/build/logs/test.log"
: > "$LOG"

{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') cargo test ==="
  cd "$ROOT/src-tauri" && cargo test 2>&1
} | tee -a "$LOG"
STATUS=${PIPESTATUS[0]}

echo "" | tee -a "$LOG" > /dev/null
echo "EXIT_CODE=$STATUS" | tee -a "$LOG"
exit "$STATUS"
