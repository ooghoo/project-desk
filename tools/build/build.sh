#!/bin/bash
# 项目台 · 本地构建脚本
# 用法：bash tools/build/build.sh
# 日志：build/logs/build.log   安装包：build/app/项目台.app

set -uo pipefail
# tools/build/ → 上两级才是仓库根目录
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1
mkdir -p build/logs build/app
LOG="build/logs/build.log"
: > "$LOG"
log() { echo "$@" | tee -a "$LOG"; }

# 本机 node 可能由其他工具托管，不在默认 PATH，这里显式解析
NODE_BIN=""
for cand in /opt/homebrew/bin /usr/local/bin "$HOME/.workbuddy/binaries/node/versions/24.14.0/bin" "$HOME/.workbuddy/binaries/node/versions/22.22.2-6/bin"; do
  if [ -x "$cand/npm" ]; then NODE_BIN="$cand"; break; fi
done
if [ -z "$NODE_BIN" ]; then
  NODE_BIN=$(dirname "$(command -v npm 2>/dev/null || true)" 2>/dev/null)
fi
[ -n "$NODE_BIN" ] && export PATH="$NODE_BIN:$PATH"
export PATH="$HOME/.cargo/bin:$PATH"

log "=== $(date '+%Y-%m-%d %H:%M:%S') 项目台构建开始 ==="
log "node: $(node -v 2>/dev/null || echo 未找到)  npm: $(npm -v 2>/dev/null || echo 未找到)"
log "rustc: $(rustc --version 2>/dev/null || echo 未找到)"

if ! command -v npm >/dev/null 2>&1; then
  log "找不到 npm，请先安装 Node.js 18+"
  log "EXIT_CODE=1"
  exit 1
fi
if ! command -v cargo >/dev/null 2>&1; then
  log "找不到 cargo，请先安装 Rust（https://rustup.rs）"
  log "EXIT_CODE=1"
  exit 1
fi

log "--- 1/2 前端构建（tsc 类型检查 + vite 打包到 dist/）---"
if ! npm run build 2>&1 | tee -a "$LOG"; then
  log "EXIT_CODE=1"
  exit 1
fi

log "--- 2/2 打包 macOS 应用 ---"
if [ -x ./node_modules/.bin/tauri ]; then
  ./node_modules/.bin/tauri build --bundles app 2>&1 | tee -a "$LOG"
else
  npx --yes @tauri-apps/cli build --bundles app 2>&1 | tee -a "$LOG"
fi
STATUS=${PIPESTATUS[0]}

if [ "$STATUS" -eq 0 ]; then
  APP_SRC="src-tauri/target/release/bundle/macos/项目台.app"
  if [ -d "$APP_SRC" ]; then
    rm -rf "build/app/项目台.app"
    cp -R "$APP_SRC" "build/app/项目台.app"
    log "已拷贝安装包：build/app/项目台.app"
  else
    log "未找到 $APP_SRC"
  fi
fi

log ""
log "=== 完成，退出码 $STATUS ==="
log "EXIT_CODE=$STATUS"
exit "$STATUS"
