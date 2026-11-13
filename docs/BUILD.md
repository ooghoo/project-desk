# 构建成 App · 完整指南

本文说明如何把「项目台」源码构建成可双击运行的 macOS 应用。

---

## 1. 环境要求

| 依赖 | 最低版本 | 本机验证版本 | 说明 |
| --- | --- | --- | --- |
| macOS | 11.0 (Big Sur) | — | `tauri.conf.json` 里 `minimumSystemVersion` |
| Node.js | 18+ | v24.14.0 | 构建前端 |
| npm | 9+ | 11.9.0 | 依赖管理 |
| Rust | 1.77+ | 1.99.1 | 编译后端 |
| Xcode CLT | — | — | 提供 macOS SDK 与链接器 |

### 1.1 安装依赖

```bash
# Node.js（若已有则跳过）
brew install node

# Rust（若已有则跳过）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### 1.2 本机特殊情况：cargo 不在默认 PATH

Rust 装完后 `cargo` 位于 `~/.cargo/bin`，**不在默认 PATH 里**。直接敲 `cargo` 会报
`command not found`，跑 Tauri 构建会报：

```
failed to run 'cargo metadata' command ... No such file or directory
```

解决：构建前显式加上

```bash
export PATH="$HOME/.cargo/bin:$PATH"
```

仓库内的脚本都已内置这行，**手动执行时需要自己加**。

---

## 2. 安装项目依赖

先进入项目根目录（包含 `package.json` 的目录），再安装：

```bash
cd project-desk        # 换成你 clone / 存放项目时用的目录名
npm install
```

> 本文的路径都相对项目根目录书写，例如 `bash tools/build/build.sh`、
> `build/app/项目台.app`，不要写成绝对路径。

产物：`node_modules/`（约 116 MB，已 gitignore）。

---

## 3. 构建 App

### 3.1 一条命令（推荐）

```bash
bash tools/build/build.sh
```

脚本会依次完成：

1. 探测 node / cargo 并修正 PATH
2. 前端类型检查 + 打包（`tsc --noEmit && vite build` → `dist/`）
3. Tauri 打包（Rust release 编译 → `项目台.app`）
4. 把安装包拷贝到 `build/app/项目台.app`
5. 全过程写入 `build/logs/build.log`

首次构建约 2 分钟（Rust 全量编译），之后增量约 30 秒。

### 3.2 手动分步执行

```bash
export PATH="$HOME/.cargo/bin:$PATH"

# 第 1 步：前端（产物到 dist/）
npm run build

# 第 2 步：Tauri 打包
./node_modules/.bin/tauri build --bundles app
```

Tauri 原始输出位置：

```
src-tauri/target/release/bundle/macos/项目台.app
```

---

## 4. 产物位置

| 内容 | 路径 |
| --- | --- |
| **可运行安装包** | `build/app/项目台.app` |
| 构建日志 | `build/logs/build.log` |
| 测试日志 | `build/logs/test.log` |
| 前端产物（中间件） | `dist/` |
| Tauri 原始输出 | `src-tauri/target/release/bundle/macos/项目台.app` |

### 安装到「应用程序」

把 `build/app/项目台.app` 拖进 Finder 的「应用程序」即可。命令行等价写法
（`/Applications` 是 macOS 系统目录，必须写绝对路径）：

```bash
cp -R build/app/项目台.app /Applications/
```

首次启动若提示「无法验证开发者」，右键点开 →「打开」→ 确认即可（未做公证签名）。

---

## 5. 常用命令

```bash
# 开发模式（前端热更新 + Tauri 窗口）
bash tools/dev/dev.sh

# 后端单元测试（45 项）
bash tools/build/test.sh

# 测试 + 构建一步到位
bash tools/build/verify.sh

# 清理临时文件
bash tools/maintain/cleanup.sh

# 重新生成应用图标
python3 tools/maintain/make_icon.py
```

> **打包前请先退出正在运行的「项目台」**，否则覆盖可执行文件会失败。

---

## 6. 常见问题

### 6.1 `cargo: command not found`

见 [1.2](#12-本机特殊情况cargo-不在默认-path)。

### 6.2 `failed to run 'cargo metadata'`

同 6.1，Tauri CLI 通过 PATH 找 cargo。

### 6.3 端口 1420 被占用

开发模式下 Vite 固定用 1420 端口（`vite.config.ts` 里 `strictPort: true`）。
先关掉占用进程，或改 `vite.config.ts` 的 `server.port`。

### 6.4 菜单栏显示英文

已在 `src-tauri/Info.plist` 声明 `CFBundleDevelopmentRegion` 与
`CFBundleLocalizations = [zh-Hans]`。注意**必须写 `zh-Hans`，写 `zh_CN` 无效**。

### 6.5 首次构建很慢

Rust 依赖树较大（tauri + rusqlite），首次全量编译约 2 分钟，属正常现象。
之后有缓存会快很多。

---

## 7. 工作区目录说明

```
本地项目管理/
├── src/                     前端源码（React + TypeScript）
│   ├── components/          通用组件
│   ├── dialogs/             弹窗
│   ├── lib/                 store / api / 工具
│   ├── App.tsx              根组件
│   └── types.ts             与后端对应的类型
├── src-tauri/               后端源码（Rust + Tauri）
│   ├── src/                 Rust 模块
│   │   ├── db.rs            SQLite 与迁移
│   │   ├── commands.rs      Tauri 命令
│   │   ├── detect.rs        项目类型识别
│   │   ├── launcher.rs      运行脚本生成与执行
│   │   ├── manifest.rs      launcher.json 解析
│   │   └── runs.rs          运行状态推导
│   ├── icons/               应用图标
│   ├── Cargo.toml
│   └── tauri.conf.json      Tauri 主配置
├── fixtures/                测试用示例项目
│   ├── demo-html/           静态页面示例
│   ├── demo-python/         Python 脚本示例
│   └── launcher.json        配置文件模板
├── tools/                   构建与维护脚本
│   ├── build/               build.sh / test.sh / verify.sh
│   ├── dev/                 dev.sh
│   └── maintain/            cleanup.sh / make_icon.py
├── build/                   构建产物（gitignore）
│   ├── app/项目台.app        可运行安装包
│   └── logs/                构建与测试日志
├── docs/                    文档
│   └── BUILD.md             本文件
├── dist/                    前端产物（中间件，gitignore）
├── index.html               Vite 入口
├── package.json             前端依赖与脚本
├── vite.config.ts           前端构建配置
└── tsconfig.json            TypeScript 配置
```

### 为什么这些文件不能移动

以下文件被工具链按固定路径查找，**移动会导致构建失败**：

| 文件 / 目录 | 被谁依赖 |
| --- | --- |
| `index.html` | Vite 默认入口 |
| `src/` | `index.html` 与 `tsconfig.json` 引用 |
| `dist/` | `tauri.conf.json` 的 `frontendDist: "../dist"` |
| `package.json` / `vite.config.ts` | npm 与 Vite 按约定在根目录查找 |
| `src-tauri/` | Tauri CLI 默认项目目录 |

---

## 8. 数据存放位置

App 的运行数据（数据库、运行日志）**不在这个工作区**，而是：

```
~/Documents/项目台/
├── project-desk.sqlite3     项目与配置数据库
├── project-desk.sqlite3-wal
├── runs/                    每次运行的脚本与日志
└── debug.log                前端事件调试日志
```

早期版本曾放在 `~/Library/Application Support/com.nathan.projectdesk/`，
新版首次启动会自动迁移（**保留源文件不删**），可在设置页「数据库位置」确认。

---

## 9. 换一台机器重建

```bash
git clone https://github.com/ooghoo/project-desk.git   # 也可直接拷贝整个工作区（不含 build/ 与 node_modules/）
cd project-desk
npm install
bash tools/build/build.sh
```

若报缺少 Rust，先执行 [1.2](#12-本机特殊情况cargo-不在默认-path) 的安装步骤。
