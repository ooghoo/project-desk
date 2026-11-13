# launcher.json 生成规范（AI 生成用）

项目台通过读取**项目根目录下的 `launcher.json`** 识别运行方式。本文是生成这份文件时必须遵守的规范。

> **这份规范写给谁**：主要用于让 AI 在生成脚本、网页或小工具时，顺手产出一份合规的 `launcher.json`。
> AI 写的脚本越来越多、也越来越难管理，项目台靠这份文件把「怎么跑」固化下来：
> 添加项目时自动读取为初始运行配置，省去手工填写；同时用下面的字段约束和硬性校验，
> 挡住 AI 最容易犯的错（猜端口、把参数拼进 `command`、相对路径逃出项目根目录）。
> 人手写配置时同样适用。背景与配套约定见 [`README.md`](../README.md) 的「背景」「与 AI 协作」两节。

---

## 一、最小可用示例

```json
{
  "schemaVersion": "1.0.0",
  "project": {
    "name": "项目名称",
    "type": "web"
  },
  "defaultConfig": "dev",
  "configurations": [
    {
      "id": "dev",
      "name": "运行项目",
      "type": "service",
      "runtime": "command",
      "workingDirectory": ".",
      "command": "npm",
      "args": ["run", "dev"],
      "url": null,
      "startupTimeout": 30,
      "stopStrategy": "process_tree"
    }
  ]
}
```

放在项目根目录，与 `package.json` 同级。**不递归搜索子目录**。

---

## 二、字段规范

### 顶层

| 字段 | 必填 | 类型 | 规则 |
| --- | --- | --- | --- |
| `schemaVersion` | ✅ | string | 当前固定 `"1.0.0"`。写 `"2.x"` 会被拒绝并提示不兼容 |
| `project` | — | object | 项目元信息 |
| `defaultConfig` | — | string | 默认运行配置的 `id`。**必须引用真实存在的 id**，否则报错。省略时自动取第一个 |
| `configurations` | ✅ | array | **至少一个**元素 |

### project

| 字段 | 必填 | 类型 | 规则 |
| --- | --- | --- | --- |
| `name` | — | string | 显示名称，**不影响磁盘文件夹名** |
| `type` | — | string | `web` / `script` / `application` / `other`。省略按 `other` 处理 |

> `description`、`version` 等自定义字段**允许存在**，会被忽略，不会报错。

### configurations[]

| 字段 | 必填 | 类型 | 规则 |
| --- | --- | --- | --- |
| `id` | ✅ | string | 唯一标识。**重复即报错** |
| `name` | ✅ | string | 项目台里显示的名称 |
| `type` | ✅ | string | `open` / `task` / `service`（含义见下表） |
| `runtime` | — | string | `open` / `static_web` / `command` / `terminal`。**省略会按其他字段推断**（见第五节） |
| `workingDirectory` | — | string | 相对项目根或绝对路径。省略 = 项目根。**相对路径不得逃出项目根目录** |
| `command` | 视 runtime | string | 要执行的程序。相对路径以 `workingDirectory` 为基准 |
| `args` | — | array | 参数数组，无参数写 `[]`。**不要把参数拼进 command 字符串** |
| `url` | — | string \| null | 访问地址。**动态端口填 `null`**，不要猜端口 |
| `startupTimeout` | — | number | 启动超时（秒） |
| `stopStrategy` | — | string | `none` / `process` / `process_tree`。省略按 `process_tree` |
| `entry` | — | string | 入口文件（`open` / `static_web` 用），相对项目根 |
| `port` | — | number | 显式端口。省略时若 `url` 里带端口会自动提取 |

### type 与 runtime 的含义

| type | 含义 | 项目台行为 |
| --- | --- | --- |
| `open` | 直接打开文件或应用 | 用系统默认程序打开 |
| `task` | 一次性任务，执行完退出 | 跑完显示退出码 |
| `service` | 持续运行的服务 | 管理启动、停止、状态 |

| runtime | 含义 |
| --- | --- |
| `open` | 直接打开，不启动命令 |
| `static_web` | **由项目台提供静态 HTTP 服务**，不需要自己写启动命令 |
| `command` | 在应用内嵌终端执行命令 |
| `terminal` | 同上（兼容旧写法；现在统一在应用内终端执行，不再跳转 macOS 终端窗口） |

两者组合示例：

- 服务 + `command` → 自己启动 Web 服务（最常见）
- 服务 + `static_web` → 项目台帮你起静态服务，适合纯前端项目
- 任务 + `command` → 跑一次脚本就结束
- 打开 + `open` → 直接开文件

---

## 三、生成时的硬性要求

以下情况**整个配置文件不可用**，项目台会回退到自动识别并提示错误：

| 错误 | 说明 |
| --- | --- |
| JSON 语法错误 | 文件无法解析 |
| `schemaVersion` 不是 `1.x` | 版本不兼容 |
| `configurations` 为空 | 至少要有一个运行配置 |
| 缺少 `id` 或 `name` | 必填字段 |
| `id` 重复 | 唯一性校验 |
| `defaultConfig` 指向不存在的 id | 引用校验 |
| `type` / `runtime` / `stopStrategy` 取值非法 | 枚举校验 |
| `runtime` 是 `command`/`terminal` 但没有 `command` | 命令必填 |
| `workingDirectory` 或 `entry` 不存在 | 路径校验 |
| **相对路径逃出项目根目录** | 安全校验，硬性拒绝 |

**建议写法**：宁可多写字段也别省略。`runtime`、`stopStrategy`、`startupTimeout` 虽可省略，但显式写出来更清晰。

---

## 四、常见错误写法

### ❌ 把参数拼进 command

```json
{ "command": "python3 src/cli.py serve --port 8080" }
```

问题：含空格或引号的路径会被错误切分，无法正确处理特殊字符。

### ✅ args 分开写

```json
{ "command": "python3", "args": ["src/cli.py", "serve", "--port", "8080"] }
```

### ❌ 猜端口

```json
{ "command": "npm", "args": ["run", "dev"], "url": "http://localhost:3000" }
```

问题：项目实际端口可能不是 3000，猜错会导致占用检测误判、浏览器打开空白页。

### ✅ 动态端口填 null

```json
{ "command": "npm", "args": ["run", "dev"], "url": null }
```

项目台不会自行猜测端口，运行状态与实际地址由项目台记录，不回写到本文件。

### ❌ 相对路径逃出根目录

```json
{ "workingDirectory": "../shared" }
```

### ✅ 只用项目内路径

```json
{ "workingDirectory": "src" }
```

---

## 五、runtime 省略时的推断规则

不写 `runtime` 不会报错，项目台按现有字段推断，并给出提醒：

| 条件 | 推断为 |
| --- | --- |
| 有 `command` | `command` |
| 无 `command`，有 `entry` | `open` |
| 无 `command` 无 `entry`，`type` 是 `service` | `static_web` |
| 其余（一次性任务） | `command` |

所以「有 command 就够用」是安全的。但为了让别人一眼看懂，**推荐显式写 `runtime`**。

---

## 六、优先级：谁说了算

```
用户在项目台保存的项目级设置  ＞  launcher.json  ＞  自动识别结果
```

- 配置文件里的 `project.name` 会覆盖自动识别出的项目名
- 配置文件里的运行配置会作为项目台的初始运行方式
- 你在项目台里手动改过的配置标记为「手动」，**重新同步配置文件时不会被覆盖**
- 运行状态、日志、实际访问地址由项目台管理，**不会回写到 launcher.json**

修改了 `launcher.json` 后，在项目详情里点「重新同步配置」即可生效；手动配置不受影响。

---

## 七、校验清单

生成完对照检查：

- [ ] 文件在项目**根目录**，不是子目录
- [ ] `schemaVersion` 是 `"1.0.0"`
- [ ] JSON 语法正确（不要有尾逗号、注释）
- [ ] 每个配置都有唯一 `id` 和非空 `name`
- [ ] `type` 取值合法
- [ ] `defaultConfig` 指向真实存在的 `id`
- [ ] `runtime` 显式填写（推荐）
- [ ] `command` 与 `args` 分开写
- [ ] 参数放 `args`，没拼进 `command`
- [ ] 动态端口的 `url` 填 `null`，不猜
- [ ] `workingDirectory` / `entry` 确实存在
- [ ] 没有相对路径逃出项目根目录
- [ ] `command` 指向的文件真实存在（`.command` 脚本要先 `chmod +x`）

---

## 八、完整示例（多配置）

```json
{
  "schemaVersion": "1.0.0",
  "project": {
    "name": "我的服务",
    "type": "web"
  },
  "defaultConfig": "dev",
  "configurations": [
    {
      "id": "dev",
      "name": "开发模式",
      "type": "service",
      "runtime": "command",
      "workingDirectory": ".",
      "command": "npm",
      "args": ["run", "dev"],
      "url": null,
      "startupTimeout": 30,
      "stopStrategy": "process_tree"
    },
    {
      "id": "preview",
      "name": "预览构建产物",
      "type": "service",
      "runtime": "static_web",
      "workingDirectory": "dist",
      "entry": ".",
      "url": "http://127.0.0.1:4173",
      "port": 4173,
      "stopStrategy": "process"
    },
    {
      "id": "build",
      "name": "执行构建",
      "type": "task",
      "runtime": "command",
      "workingDirectory": ".",
      "command": "npm",
      "args": ["run", "build"],
      "url": null,
      "startupTimeout": 120,
      "stopStrategy": "none"
    },
    {
      "id": "report",
      "name": "生成报告",
      "type": "task",
      "runtime": "terminal",
      "workingDirectory": ".",
      "command": "./scripts/report.sh",
      "args": [],
      "url": null,
      "startupTimeout": 60,
      "stopStrategy": "process"
    }
  ]
}
```

---

## 九、Python 项目典型配置

```json
{
  "schemaVersion": "1.0.0",
  "project": {
    "name": "数据处理工具",
    "type": "script"
  },
  "defaultConfig": "serve",
  "configurations": [
    {
      "id": "serve",
      "name": "启动本地服务",
      "type": "service",
      "runtime": "command",
      "workingDirectory": ".",
      "command": "python3",
      "args": ["src/cli.py", "serve", "--port", "8080"],
      "url": "http://127.0.0.1:8080",
      "startupTimeout": 30,
      "stopStrategy": "process_tree"
    },
    {
      "id": "once",
      "name": "执行一次",
      "type": "task",
      "runtime": "command",
      "workingDirectory": ".",
      "command": "python3",
      "args": ["src/cli.py", "run-once"],
      "url": null,
      "startupTimeout": 600,
      "stopStrategy": "process"
    }
  ]
}
```
