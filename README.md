# 项目台 · Project Desk

> **中文名**：项目台　|　**英文标识 / 仓库名**：`project-desk`

[English version →](README.en.md)

macOS 本地项目管理与脚本启动器。把散落在磁盘上的 HTML、Python、Node 项目集中到一个工作台里，用一个按钮在**应用内嵌终端**中真实运行它们。

> 产品定位：Obsidian 式项目管理工作台 + 本地脚本启动器。不做 IDE，不做内置终端，不改动任何项目源文件。
> 内部标识：`com.nathan.projectdesk`（Bundle ID）、`project-desk`（Cargo 包名）。

---

## 背景：AI 写得越多，越需要一个「台」

AI 时代，让模型顺手写一段 Python 脚本、一个 HTML 页面、一个 Node 小工具，成本几乎为零。
结果是这类项目迅速堆积：散落在磁盘各处，目录名随意，入口文件藏在子目录里，
解释器、端口、启动命令全靠记忆，过两周再看就不知道该怎么跑，甚至不敢删。

项目台就是为这批「一次性生成物」做的工作台：把它们登记成一个个项目，记下分类、标签和显示名，
用统一的按钮在应用内嵌终端里真实运行，输出、退出码、日志都留痕。
**不改项目源文件，不替你装依赖，也不替你决定怎么跑。**

配套两件事，让 AI 生成的项目「落地即可用」：根目录的 `launcher.json`（怎么跑）
和根目录的 `README.md`（是什么、怎么用）。见下一节。

---

## 与 AI 协作：项目根目录的两个约定文件

这里说的「根目录」，指的是**你添加进项目台的那个项目目录**（`projects.root_path`），
不是本仓库的根目录，也不是项目里的子目录。

| 文件 | 谁写 | 项目台拿它做什么 |
|---|---|---|
| `launcher.json` | AI 按规范生成 / 你自己 | 读取运行方式：显示名、入口、命令与参数、工作目录、端口策略、停止策略；校验失败则回退到自动识别 |
| `README.md`（或 `.markdown` / `.mdx` / `说明.md`） | AI / 你自己 | 在详情页「说明」Tab 渲染成 Markdown，作为这个项目的说明书 |

### 1. `launcher.json` 与 AI 生成规范

**[`docs/launcher-json.md`](docs/launcher-json.md)** 是给 AI 用的生成规范：
让 AI 在产出脚本、网页或小工具时，顺手在项目根目录写一份合规的 `launcher.json`。它的作用是三件事：

1. **省掉手工配置** —— 项目台添加项目时直接读取这份文件，把它作为初始运行方式，
   不用再逐项填命令、解释器、入口和端口。
2. **约束 AI 别乱猜** —— 规范明确要求：动态端口的 `url` 填 `null` 而不是猜 3000；
   参数必须放 `args` 而不是拼进 `command`；相对路径不得逃出项目根目录。
   这些正是 AI 生成配置时最容易写错、也最容易导致占用检测误判或路径被错误切分的地方。
3. **给出可校验的边界** —— `schemaVersion`、`id` 唯一性、`defaultConfig` 引用、
   枚举取值、路径存在性都有硬性校验；不合规就整份拒绝并回退到自动识别，不会悄悄跑错。

优先级：**用户在项目台手动保存的设置 ＞ `launcher.json` ＞ 自动识别结果**。
手动改过的配置不会被重新同步覆盖；运行状态与日志只由项目台管理，不回写这份文件。
可直接复制的模板见 `fixtures/launcher.json`。

### 2. 详情页「说明」读取的是根目录 README

详情页的「说明」Tab 调用 `read_project_readme`，只读取**该项目根目录**下的说明文件，
**不递归子目录**；文件名大小写不敏感，按以下名称查找：
`README.md`、`README.markdown`、`README.mdx`、`说明.md`。

- 内容按 Markdown 渲染（marked + DOMPurify 净化），超过 256 KB 只显示前 256 KB 并给出提示；
- 顶部显示实际文件名，可用默认应用打开，或在 Finder 中显示；
- 根目录没有这些文件时显示空状态，并提示当前根目录路径。

所以让 AI 生成项目时顺手写一份放在**根目录**的 `README.md`，就能在项目台里直接看到说明；
放在 `docs/`、`src/` 等子目录里是读不到的。自动识别也会把 `README.md` 当作判断依据之一，
但只有 README 时无法推断运行方式，仍需要 `launcher.json` 或手动配置。

---

## 一、技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Tauri 2（macOS 11+，.app 包体约 8 MB） |
| 后端 | Rust（文件系统、进程管理、SQLite、Terminal 集成） |
| 前端 | React 18 + TypeScript + Vite 6 |
| 样式 | 手写 CSS 变量体系，无 UI 框架、无 Tailwind |
| 图标 | Lucide |
| 数据 | SQLite（rusqlite，bundled，WAL，带版本迁移） |

## 二、目录结构

按「源码 / 安装包 / 脚本」分开存放：

```
本地项目管理/
├── src/                        前端源码（React + TS）
│   ├── App.tsx                 三栏布局、面板拖拽、全局拖放、轮询
│   ├── main.tsx                入口（UiProvider）
│   ├── types.ts                与后端 serde 模型一一对应的类型
│   ├── styles.css              全部样式（浅色/深色令牌）
│   ├── lib/                    api / store / ui / format / projectActions
│   ├── components/             Sidebar / TopBar / ProjectList / DetailPanel
│   │                           FileTree / RunsView / Settings / primitives
│   └── dialogs/                AddProject / ConfigEditor / 各类弹窗
├── src-tauri/                  后端源码（Rust）
│   ├── src/lib.rs              应用装配、中文菜单、命令注册
│   ├── src/main.rs             可执行入口
│   ├── src/db.rs               SQLite 建表、迁移、全部 CRUD
│   ├── src/models.rs           数据模型（serde camelCase）
│   ├── src/commands.rs         Tauri 命令层（唯一的前后端边界）
│   ├── src/detect.rs           项目类型识别 + Python 解释器发现
│   ├── src/launcher.rs         运行脚本生成、进程树停止、Finder 集成
│   ├── src/pty.rs              内嵌终端（portable-pty）：spawn / 输出转发 / 键盘输入 / 停止
│   ├── src/runs.rs             启动/停止/状态推导
│   ├── src/paths.rs            路径规范化与 shell 转义
│   ├── src/shellenv.rs         登录 shell 的 PATH 探测（GUI 应用必需）
│   ├── icons/                  应用图标
│   └── tauri.conf.json         窗口、CSP、打包配置
│
├── tools/                      构建与维护脚本（按用途分层）
│   ├── build/build.sh          一键构建，拷贝安装包到 build/app/
│   ├── build/test.sh           后端单元测试
│   ├── build/verify.sh         测试 + 构建
│   ├── dev/dev.sh              开发模式（热更新 + Tauri 窗口）
│   ├── maintain/cleanup.sh     清理临时文件
│   └── maintain/make_icon.py   重新生成应用图标（可选）
│
├── fixtures/                   测试用示例项目（可添加进工作台验证运行链路）
│   ├── demo-python/main.py
│   ├── demo-html/index.html
│   └── launcher.json           配置文件模板（规范见 docs/launcher-json.md）
│
├── build/                      构建产物（已 gitignore）
│   ├── app/项目台.app           可运行安装包
│   └── logs/                   build.log / test.log
│
├── docs/BUILD.md               构建成 App 的完整指南
├── docs/launcher-json.md       launcher.json 生成规范（AI 生成用）
├── index.html / vite.config.ts / tsconfig*.json / package.json
├── README.md                   中文说明
└── README.en.md                English README
```

> `index.html`、`src/`、`dist/`、`package.json`、`src-tauri/` 被工具链按固定路径查找，**不能移动**。
> 详见 `docs/BUILD.md` 第 7 节。

`node_modules/`、`dist/`、`src-tauri/target/` 为工具链产物，均已在 `.gitignore` 中。

## 三、开发环境

- macOS 11 以上，Xcode Command Line Tools（`xcode-select --install`）
- Node.js ≥ 18
- Rust stable（`rustup` 安装，1.99.1 实测）

本机实测版本：Node v22.22.2 / npm 11.9.0 / Rust 1.99.1 / Tauri CLI 2.x。

国内网络下 `rustup` 建议加镜像：

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | RUSTUP_DIST_SERVER=https://rsproxy.cn sh -s -- -y --profile minimal
```

> 若 shell 里找不到 `npm`（Node 由其他工具托管时常见），`tools/build/build.sh` 已内置常见路径探测，可直接使用。
>
> `cargo` 默认不在 PATH（位于 `~/.cargo/bin`），手动执行构建前需 `export PATH="$HOME/.cargo/bin:$PATH"`。

## 四、常用命令

```bash
npm install                # 安装前端依赖
npm run dev                # 仅启动前端（浏览器里可看 UI，但无后端能力）
npm run app:dev            # 启动完整桌面应用（开发模式，热更新）
npm run build              # 类型检查 + 前端构建
npm run app:build          # 打包 macOS .app

bash tools/build/build.sh    # 一键构建，日志 build/logs/build.log，安装包 build/app/项目台.app
bash tools/build/test.sh     # 后端单元测试，日志 build/logs/test.log
bash tools/build/verify.sh   # 测试 + 构建
bash tools/dev/dev.sh        # 开发模式
bash tools/maintain/cleanup.sh   # 清理临时文件
```

> 完整构建指南见 **[`docs/BUILD.md`](docs/BUILD.md)**。

产物：

```
build/app/项目台.app                                   ← 直接双击运行 / 拖进「应用程序」
src-tauri/target/release/bundle/macos/项目台.app     ← Tauri 原始输出
```

数据库与任务日志：

```
~/Library/Application Support/com.nathan.projectdesk/project-desk.sqlite3
~/Library/Application Support/com.nathan.projectdesk/runs/<run_id>/
    task.sh      本次运行生成的脚本（可审查）
    task.pid     进程号
    task.exit    退出码
    task.log     完整输出
```

## 五、核心实现说明

### 1. 显示名称与磁盘路径彻底分离

`projects.name` 是应用内元数据，`projects.root_path` 是真实目录。重命名只 `UPDATE projects SET name`，任何路径操作都不会写入磁盘目录名。改名、分类、标签、收藏、重新定位都不会触碰源文件。

### 2. 项目识别

扫描根目录的 `package.json`（scripts）、任意 `*.html`（`index.html` 优先，其余按名称排序）、`main.py/app.py/run.py/...`、`pyproject.toml`、`requirements.txt`、`*.sh`、项目内虚拟环境（`.venv/venv/env`），给出类型、入口、解释器与命令建议，并在添加页以“识别结果”呈现，全部字段可改。

识别只是建议：有 `index.html` 也可能需要 HTTP 服务，有 `main.py` 也不一定该直接执行；界面上以警告文案明确说明。

### 3. 重复路径检测

`paths::compare_key()`：先 `canonicalize`（解析符号链接、`/private/var` 与 `/var` 归一），再小写化并去掉结尾斜杠，因此 `~/Project`、`~/Project/`、符号链接指向同一目录都会被判定为重复。

### 4. 应用内嵌终端（真实执行，不跳转外部窗口）

点击运行后，后端会：

1. 校验项目目录、工作目录、入口文件、解释器、端口占用；
2. 在 `runs/<id>/` 生成 `task.sh`（单引号转义所有路径，显式 `cd`，注入登录 shell 的 PATH 与环境变量）；
3. 用 `portable-pty` 在应用内开一个真实 pty，`/bin/bash task.sh` 作为子进程运行，前端用 xterm.js 渲染；
4. 读取线程把输出**同时**写入 `task.log` 与 `run://output` 事件（base64），前端实时渲染，支持 ANSI 颜色与交互输入；
5. 子进程退出后发 `run://exit`，前端刷新状态；脚本仍写入 `task.pid` / `task.exit`，供重启后推导状态。

静态页面例外：运行方式是「静态 HTML」的配置不走进程，直接用默认浏览器打开文件，不产生运行记录（主按钮文案为「打开」）。

交互能力：终端可接收键盘输入（如 `vite` 换端口、`Django` 创建超级用户的提示），窗口大小变化会同步 `resize` 给 pty。
打开历史任务时从 `task.log` 回放输出，只读不可输入。

状态语义：`已请求启动 → 正在启动 → 运行中 → 已结束 / 运行失败（退出码）/ 已停止 / 状态未知`。进程不存在且没有退出码时显示「状态未知」，不会伪造运行中。

### 5. 进程树停止

停止时先用 `ps -axo pid=,ppid=` 递归收集子进程，对整棵树发 `SIGTERM`，等待 2 秒后对残留进程发 `SIGKILL`，避免只杀父进程而留下 `npm`/`node` 子进程继续占用端口。

### 6. 安全边界

- 前端不能执行任意命令，只能通过 `commands.rs` 暴露的受控接口；
- 自定义命令必须先在运行配置中保存，执行前会展示完整命令行；
- 所有路径参数使用单引号转义传递，不做字符串拼接；
- 文件树读取限制在已注册项目目录内（`is_within` 校验）；
- 不使用 `sudo`，不自动安装依赖，不修改 shell 配置文件；
- 不静默删除：移除项目只删数据库记录，并明确提示磁盘文件不受影响。

### 7. 数据模型

`categories` / `projects` / `tags` / `project_tags` / `launch_configurations` / `run_history` / `app_settings`，用 `PRAGMA user_version` 做顺序迁移（当前 v2），升级不会丢项目记录。

## 六、已知限制

- **端口占用检测是启动前快照**：无法阻止命令启动后才被其他进程抢占。
- **长期服务的健康检查**：只判断进程是否存活，不探测 HTTP 是否可用；服务内部崩溃但进程未退出时仍显示「运行中」。
- **终端会话不跨重启**：应用退出时内嵌 pty 关闭，子进程收到 SIGHUP 结束；重启后只能回放日志，无法继续交互。
- **终端仅在打开的任务上渲染**：切到别的页面时输出仍写入日志，但不会保留在终端缓冲里（回来看会重新回放）。
- **不支持系统级快捷键/菜单栏常驻**，也未做多窗口。
- **运行历史不会自动清理**（设置页可一键清空），日志文件会持续累积。
- **每次重新构建都要重新授权文件夹**：应用使用 Tauri 默认的 ad-hoc 签名，每次构建的签名指纹都不同，
  而 macOS 的「文件与文件夹」授权是按签名身份记录的，所以每次换新构建都会再问一次。定版后只问一次。
  - 误点了「不允许」：系统设置 → 隐私与安全性 → 文件与文件夹 → 项目台 → 勾选「文稿」；
  - 或者执行 `tccutil reset SystemPolicyDocumentsFolder com.nathan.projectdesk` 让系统重新询问。
- **重复启动**：已用 single-instance 保护，第二次打开只会唤起已有窗口（此前两个实例抢 SQLite 会闪退）。
- **仅适配 macOS**，目录挑选与 Finder 集成为 macOS 实现。
- 依赖安装、虚拟环境创建需要用户自己在终端完成——这是刻意的边界。


