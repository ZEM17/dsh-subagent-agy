# @dsh-external/dsh-subagent-antigravity

把任务直接委托给本机的 **Google Antigravity CLI（`agy`）**——一个独立的
Gemini 编程智能体——从 DeepSeek Harness 里直接使用。**不需要任何 API key**：
agy 使用你的 Antigravity 登录态（系统凭据 / Google 登录）完成认证。

> English version: [README.md](README.md) · 源码: [github.com/ZEM17/dsh-subagent-agy](https://github.com/ZEM17/dsh-subagent-agy)

---

## 安装

### 前置要求

1. **安装 `agy`**：`irm https://antigravity.google/cli/install.ps1 | iex`
   （Windows）。插件会自动定位它（PATH → `AGY_BIN` → `%LOCALAPPDATA%\agy\bin`
   → `~/.local/bin` → `~/.gemini/bin` → `~/go/bin`）。
2. **登录一次 `agy`**：在终端运行 `agy` 完成登录。之后如果遇到
   "authentication required"，插件会自动弹出交互式登录窗口。
3. **DeepSeek Harness**：标准 web profile 即可（自带 `dsh-subagent`、
   `dsh-subprocess`、`dsh-tools`、`dsh-jobs`）。

### 安装插件

**从 GitHub 安装**（推荐）：

```bash
dsh plugin --profile web add github:ZEM17/dsh-subagent-agy
```

**从安装包安装**：到
[Releases 页面](https://github.com/ZEM17/dsh-subagent-agy/releases) 下载
`dsh-external-dsh-subagent-antigravity-0.2.0.tgz`，然后：

```bash
dsh plugin --profile web add /path/to/dsh-external-dsh-subagent-antigravity-0.1.0.tgz
```

装完即用，无需重启。任何会话里的模型都能调用 `antigravity` 系列工具。

---

## 使用方法

你只需要提需求，模型会自动调用工具；也可以明确指定：

| 用途 | 工具 | 说明 |
|---|---|---|
| 新任务 | `antigravity` | 把独立任务委托给 agy（新对话）；返回 `task` 键 |
| 续聊 | `antigravity_followup` | 通过 `task` 键继续之前的 agy 对话——上下文完整延续 |
| 任务列表 | `antigravity_tasks` | 列出运行中 + 最近完成的任务；`task` 键在 DSH 重启后仍然有效 |
| 取消任务 | `antigravity_cancel` | 用 `task` 键停止一个运行中的任务（终止 agy 进程树） |
| 登录 | `antigravity_login` | 弹出 agy 交互式登录窗口（认证失败时也会自动弹出） |

示例：

> "用 agy 把 `D:\projects\my-project` 的 README 重写一遍，列出改动。"
>
> "用 antigravity 优化这个项目的页面"

### 识图

agy 的模型是多模态的——把图片路径写进 prompt，它就能描述/分析图片：

> "用 antigravity 识别这张图片：`C:\projects\screenshots\ui.png`"
>
> "Use agy to describe this image: `C:\projects\design\mockup.png`"

工作区内的图片直接可用；工作区之外的图片，需要把图片所在目录传给工具的
`dirs` 参数（或配置 `addDirs`）。

- **任务目标在会话工作区之外**时，需要把目标目录传给工具的 `dirs` 参数
  （你把路径告诉模型，它会自动带上）。
- **长任务**：模型会自动用 `background: true` 后台运行——期间向你实时汇报
  进度，完成后给出最终结果。
- **继续之前的任务**：告诉模型用上次返回的 `task` 键续聊。
- **找回任务键**：`antigravity_tasks` 列出运行中和最近完成的任务——任务键
  记录在 `~/.dsh/agy-conversations.json`，DSH 重启后依然存在，随时可以找回
  用于续聊。
- **停止任务**：用运行中任务的键调用 `antigravity_cancel`（后台任务也可用
  `job_kill`）。

---

## 配置

所有字段都可选，默认值见下表。通过插件的设置区配置（如
`$DSH_HOME/settings.yaml`）：

```yaml
dsh-subagent-antigravity:
  model: gemini-3.1-pro-high   # agy models 里的模型；留空 = agy 默认
  effort: high                 # low | medium | high
  printTimeoutMs: 300000       # 前台任务上限（5 分钟）
  backgroundTimeoutMs: 3600000 # 后台任务上限（1 小时）
  skipPermissions: true        # 自动批准 agy 的工具调用（无头模式必需）
  addDirs: []                  # 加入 agy 工作区的绝对路径（--add-dir）
  proxy: ""                    # 代理 URL；回退到 AGY_PROXY 环境变量，再回退 ~/.dsh/agy-proxy.txt
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `providerName` | `antigravity` | `ctx.subagents` 注册名 |
| `toolName` | `antigravity` | 新任务工具名 |
| `followupToolName` | `antigravity_followup` | 续聊工具名 |
| `loginToolName` | `antigravity_login` | 登录窗口工具名 |
| `tasksToolName` | `antigravity_tasks` | 任务列表工具名 |
| `cancelToolName` | `antigravity_cancel` | 取消任务工具名 |
| `command` | `agy` | 可执行文件（PATH 名或绝对路径） |
| `model` | `''` | `--model <slug>`（见 `agy models`）；留空 = agy 默认 |
| `effort` | `''` | `--effort low\|medium\|high`；留空 = 不传 |
| `agent` | `''` | `--agent <name>`；留空 = 不传 |
| `printTimeoutMs` | `300000` | 前台任务上限（`--print-timeout`） |
| `backgroundTimeoutMs` | `3600000` | 后台任务上限（1 小时） |
| `watchdogMarginMs` | `60000` | agy 卡死时、超时上限之外强制终止的余量 |
| `skipPermissions` | `true` | `--dangerously-skip-permissions`（自动批准 agy 工具调用） |
| `sandbox` | `false` | `--sandbox`（agy 终端沙箱限制） |
| `avoidBrowser` | `true` | 在 prompt 中追加"不要用浏览器工具"说明（部分机器上无头浏览器会卡死） |
| `avoidLargeReads` | `true` | 在 prompt 中追加"超过 1 MB 的文件用 grep/sed 读取"说明（agy 读取工具有 4 MB 上限） |
| `outputFormat` | `json` | 输出格式（`json` 或 `text`）；后台模式自动优先 `stream-json` |
| `extraArgs` | `[]` | 追加在生成参数之后的原始 argv |
| `cwd` | `''` | 工作目录覆盖；留空 = 会话工作区 |
| `addDirs` | `[]` | 加入 agy 工作区的绝对路径（`--add-dir`）——目标在会话工作区之外时必需 |
| `env` | `{}` | 环境变量覆盖（在 Harness 凭据清理之后合并） |
| `proxy` | `''` | 代理 URL；回退 `AGY_PROXY`，再回退 `~/.dsh/agy-proxy.txt`（每次调用重读） |
| `registryPath` | `''` | 续聊注册表文件；留空 = `~/.dsh/agy-conversations.json` |
| `disposeGraceMs` | `5000` | 进程树终止宽限（SIGTERM → SIGKILL） |
| `autoLoginWindow` | `true` | 认证失败时自动弹出交互式登录窗口 |
| `loginWindowMinimized` | `true` | 登录窗口最小化启动（只在任务栏显示图标） |

---

## 工作原理（简述）

每次任务都会在会话工作区里拉起一个全新的 `agy -p <任务>` 进程，返回最终
回答。运行使用 `--output-format json`，其回复携带 agy 的
`conversation_id`；插件把它记入持久化注册表（`~/.dsh/agy-conversations.json`），
`antigravity_followup` 通过 `--conversation <id>` 恢复同一对话。后台运行
使用 `stream-json` 提供实时进度，并接入 DSH 的任务系统（`job_output` /
`job_kill`）。本地看门狗会终止卡死的运行——**任何情况下都不会无限等待**。

`antigravity_tasks` 展示持久注册表（重启安全）和实时运行中的任务，
`antigravity_cancel` 可以停止某个运行中的任务。注册表自带自愈：损坏的
文件会先备份一次（`*.corrupt`）再重置，绝不会被静默覆盖；所有注册表
写入都是串行化的，并发运行不会互相丢失记录。

---

## 故障排查

| 现象 | 解决办法 |
|---|---|
| `authentication required` | 在自动弹出的登录窗口里完成登录（或调用 `antigravity_login`），然后重试 |
| `User location is not supported` | 配置代理（`proxy` 或 `~/.dsh/agy-proxy.txt`） |
| `timeout waiting for response` | 调大 `printTimeoutMs` / `backgroundTimeoutMs`，或改用 `background: true` |
| `agy exited 0 but produced no stdout` | 已知的 agy 非 TTY 输出丢失 bug；默认的 `--output-format json` 可规避——仍出现就升级 agy |
| `cannot resolve "agy"` | 设置 `AGY_BIN` 指向 agy 可执行文件 |
| 任务卡在浏览器工具上 | `avoidBrowser`（默认开启）已阻止；确实需要浏览器预览时才设 `false` |
| `file size (…) exceeds limit` | agy 读取工具上限 4 MB；`avoidLargeReads`（默认开启）已让 agy 改用 grep/sed——或瘦身该文件 |
| 注册表损坏 | 插件会把损坏的文件备份一次到 `*.corrupt` 再重置注册表——历史记录绝不会被静默覆盖 |

---

## 开发

```bash
bash scripts/build.sh            # 从 DSH 运行时 junction 链接 @deepseek-ai 依赖，然后 tsc 编译 src/ → lib/
npm run selftest                 # 离线自检：agy 存在性、参数探测、注册表往返
npm run selftest:e2e             # + 真实 PONG 双轮对话（需要已登录 agy）
```

本地 DSH 开发流程（超级模组注入器）：`dev_build_plugin`（构建+打包）→
`dev_inject_plugin`（免重启运行时注入）；日常迭代用 `dev_build_plugin` →
`dev_reload_package`。
