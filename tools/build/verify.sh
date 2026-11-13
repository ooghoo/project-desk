#!/bin/bash
# 项目台 · 一键验证（单元测试 + 打包）
# 用法：bash tools/build/verify.sh
# 注意：运行前请先退出正在运行的「项目台」，避免覆盖可执行文件失败。
set -uo pipefail
cd "$(dirname "$0")" || exit 1

bash ./test.sh
TEST_STATUS=$?

bash ./build.sh
BUILD_STATUS=$?

echo ""
echo "======== 结果 ========"
echo "cargo test : $TEST_STATUS"
echo "tauri build: $BUILD_STATUS"
exit $(( TEST_STATUS + BUILD_STATUS ))
