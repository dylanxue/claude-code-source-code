# dclaw

`dclaw` 是一个严格参考 Claude Code 通用能力边界设计的终端优先通用 agent 项目。

当前仓库中的 `dclaw/` 目录正在从 `v0.1` 收尾切换到 `v0.2` 主线。当前重点不再是继续追 `v0.1` 的零散收口项，而是转向阶段 8-10：上下文管理 / 自动压缩、Plan / Task、以及 Memory；`v0.1` 剩余的工具与会话体验打磨统一转入 backlog，`DCLAW.md` 深化、权限系统继续收口，以及更广的上下文压缩 / persistence 打磨已下调到 `v0.3`。

## 当前范围

- 先做通用 agent 核心
- 严格对齐 Claude Code 已体现的通用能力
- 不提前加入 Claude Code 源码中没有的产品能力
- `coding` 能力单独后置为场景增强阶段

## 文档索引

推荐先读这 3 份主文档：

- [01-总体方案](./docs/01-总体方案.md)
- [02-MVP设计](./docs/02-MVP设计.md)
- [03-扩展设计](./docs/03-扩展设计.md)

详细专题索引见：

- [docs/README.md](./docs/README.md)

## 当前目录

```text
dclaw/
├── docs/
├── scripts/
├── src/
└── test/
```

`src/` 已按后续实现阶段预建模块目录，便于按文档直接进入开发。

## 开发原则

1. 核心抽象优先：消息、工具、权限、会话、记忆、任务、代理、扩展。
2. 通用能力优先：不要把 coding 逻辑写死进核心模块。
3. 可恢复优先：所有长生命周期能力都应支持持久化与恢复。
4. 文档先行：每个核心模块在编码前先固定职责与边界。
5. 严格向claude code靠拢：所有决策，都优先参考本项目目录的claude code源码实现，不要凭空想象

## 建议的实现顺序

1. CLI 与运行入口
2. Query Engine 与消息协议
3. System Prompt 与指令装配
4. DCLAW.md 指令系统
5. Tool 协议与基础工具
6. 权限模式与 Hooks
7. Session 与恢复
8. 上下文压缩
9. Plan / Task
10. Memory
11. 多代理与 Worktree
12. MCP / Skills / Plugins / Remote
13. Coding 场景增强

## 当前状态

- 方案文档已初始化
- 目录骨架已建立
- TypeScript 基础工程已初始化
- CLI 与最小 Query Engine 已可运行
- Prompt / `DCLAW.md` 基础链路已接入
- 已接入真实 `Anthropic / OpenAI` provider，并支持基础 streaming / SSE
- Tool registry 与基础工具链路已接入，并进入语义收紧阶段
- `Read / Edit / Write / Bash / Glob / Grep / WebFetch / AskUserQuestion` 已有最小可用实现
- 4 种 `permission mode` 已真正接入 tool 执行链路，并支持 CLI / 用户级 / workspace 级配置
- session store / transcript 持久化 / `resume` 恢复链路已打通
- `interactive` 已推进到真正可用的 REPL，并补上首批本地 slash commands
- model limits 已接入 provider 配置与首段 model-aware `tool result budget`
- 当前主线已切换到 `v0.2`，重点进入 `compact / autocompact`、Plan / Task、Memory；`v0.1` 剩余的工具与 session 收尾项已转入 backlog
- 阶段 8 当前已完成最小 manual compact、消息级 compact boundary、模型生成 compact summary、autocompact，以及首轮 post-compact 文件/plan/task 恢复；下一步优先进入 partial/reactive compact

## 测试

当前已接入一套基础自动化测试，覆盖：

- `Read`
- `Edit / Write`
- `Bash`
- `Glob / Grep`
- `WebFetch / AskUserQuestion`
- `Anthropic / OpenAI` provider
- `queryLoop` 下的 permission mode 集成行为
- `session / resume / REPL commands`

当前测试也覆盖了一批关键边界：

- `Edit.replace_all`
- `Write` 对 partial read 的拦截
- `Read` 的 missing file / empty file / offset 越界
- `Bash` 的 read-only 分类与 permission mode 差异
- `Bash` 对 `pwd` 和常见只读 `git` 命令的自动放行

常用命令：

```bash
npm run check
npm test
```

## LLM 配置

当前 `dclaw` 已支持：

- `stub`
- `anthropic`
- `openai`

LLM 相关配置已经统一切到结构化配置文件，不再通过 provider/model 环境变量驱动。

配置分三层：

- `llm.providers`
  负责连接信息，例如 `apiKey / baseURL / apiStyle`
- `llm.runtimes`
  负责 `primary + imageFallback`
- `llm.modelCatalogOverrides`
  负责局部修正模型能力与 token limit

其中：

- 用户级配置：`~/.dclaw/config.json`
- workspace 级配置：`.dclaw/config.json`
- workspace 配置不能写 provider `apiKey`

CLI 入口也已经收口到：

- `--runtime <name>`

不再使用 `--provider`，也不再支持 `--model`。

### 配置示例

参考 [config.json.example](./config.json.example)。

一个最常见的用户级配置示例：

```json
{
  "llm": {
    "defaultRuntime": "default",
    "providers": {
      "openai-default": {
        "type": "openai",
        "apiKey": "your-openai-api-key",
        "baseURL": "https://api.openai.com/v1",
        "proxyURL": "http://127.0.0.1:7890",
        "apiStyle": "responses"
      },
      "anthropic-default": {
        "type": "anthropic",
        "apiKey": "your-anthropic-api-key",
        "baseURL": "https://api.anthropic.com"
      }
    },
    "runtimes": {
      "default": {
        "primary": {
          "providerRef": "openai-default",
          "model": "gpt-5.4"
        },
        "imageFallback": {
          "providerRef": "anthropic-default",
          "model": "claude-sonnet-4-6"
        }
      }
    },
    "modelCatalogOverrides": {
      "gpt-5": {
        "contextWindow": 900000,
        "maxOutputTokens": 96000,
        "maxOutputTokensUpperLimit": 128000
      },
      "claude-opus-4.7": {
        "supportsPdfInput": true
      }
    }
  }
}
```

### 模型能力目录

模型能力信息来自：

1. 内置的 [src/llm/modelCatalog.json](./src/llm/modelCatalog.json)
2. `llm.modelCatalogOverrides`
3. 全局 token 环境覆盖：
   - `DCLAW_MAX_CONTEXT_TOKENS`
   - `DCLAW_MAX_OUTPUT_TOKENS`
   - `DCLAW_MAX_OUTPUT_TOKENS_UPPER_LIMIT`

当前的内置 model catalog 是全局目录，不再按 provider 分桶。

这意味着：

- transport provider 只负责“怎么发请求”
- model id 决定命中哪条能力配置

`match` 规则是：

- 前缀匹配
- 多个命中时取最长前缀

例如：

- `gpt-5.4-pro-preview` 会优先命中 `gpt-5.4-pro`
- `anthropic/claude-opus-4.7` 会先规范化，再命中 `claude-opus-4-7`

### Canonical Model Id

为了兼容不同平台的模型命名差异，`dclaw` 会先对模型名做 canonicalization，再查能力目录。

当前已实现的例子：

- `claude-opus-4.6` -> `claude-opus-4-6`
- `anthropic/claude-opus-4.7` -> `claude-opus-4-7`
- `anthropic/claude-sonnet-4.6` -> `claude-sonnet-4-6`

这样做的结果是：

- `modelCatalog.json` 里只维护一份 canonical id
- 不需要为同一个 Claude 模型重复配置 dotted/hyphenated 两套条目
- `modelCatalogOverrides` 里写 dotted key 也能正常生效

### 图片与 PDF

当前运行时只为图片设计模型兜底：

- 主模型支持图片：直接处理
- 主模型不支持图片但配置了 `imageFallback`：走受控 side query
- 两者都不满足：返回结构化“无法处理图片”结果，不会等到 provider 调用时报错

对于 `pdf`：

- 主模型支持 `pdfInput`：`Read / WebFetch` 可直接附加 PDF
- 主模型不支持：统一收口到 unsupported + skill-first

对于 `docx / xlsx / 其他复杂文档`：

- `Read / WebFetch` 不做隐式提取
- 返回结构化 unsupported 结果
- 由模型决定切到 `pdf / doc / spreadsheet` skill 或 Bash

### Doctor

可以用下面的命令查看当前解析结果：

```bash
npm run start -- --doctor
npm run start -- --doctor --runtime default
```

`doctor` 当前会显示：

- `runtime / runtime source`
- `provider ref / provider`
- `resolved model / model source`
- `canonical model`
- `catalog match`
- `supportsImageInput / supportsPdfInput`
- `contextWindow / maxOutputTokens`
- `imageFallback`
- `max retries / request timeout / stream watchdog / stream idle timeout`

如果某个具体模型和你的实际接入能力不一致，优先在 `llm.modelCatalogOverrides` 里显式覆盖，而不是依赖全局环境变量。

## Streaming 与 SSE

`dclaw` 现在默认启用基础流式返回：

- 默认行为：直接输出文本增量
- `--no-stream`：关闭流式输出，等待最终响应
- `--output-format sse`：按 SSE 事件格式输出
- 真实 provider 默认还会补几层稳定性保护：
  - 默认重试次数：`DCLAW_LLM_MAX_RETRIES=10`
  - 默认退避策略：`500ms` 起步的指数退避，最大 `32s`，附加最多 `25%` 抖动
  - 请求超时：`DCLAW_LLM_TIMEOUT_MS`，默认 `600000`
  - 流式 idle watchdog：`DCLAW_ENABLE_STREAM_WATCHDOG=true`
  - 流式 idle 超时：`DCLAW_STREAM_IDLE_TIMEOUT_MS=90000`
- 如果流式请求在收到首个 SSE 事件前就挂起、提前结束或无法形成有效流内容，当前会保守回退到 non-streaming 请求；一旦已经开始出流，则不会自动重放，避免重复文本和重复 tool call

SSE 模式下当前会输出：

- `assistant.delta`
- `tool.use`
- `tool.result`
- `response.complete`

示例：

```bash
npm run start -- --print --runtime default --output-format sse "Reply with exactly: ok"
```

## Interactive / REPL

`interactive` 入口现在已经不是“单次 prompt 占位”，而是一个最小可用的 REPL。

支持的方式：

- 直接进入 REPL：

```bash
npm run start
```

- 先执行初始 prompt，再继续留在 REPL：

```bash
npm run start -- "summarize this repo"
```

- 恢复一个已有 session 后继续在 REPL 中交互：

```bash
npm run start -- resume <session-id>
```

当前内建 REPL commands 包括：

- `/help`
- `/session` / `/info`
- `/history`
- `/doctor`
- `/runtime [name|list]`
- `/permissions [mode]`
- `/config`
- `/transcript [N]`
- `/resume [session-id]`
- `/compact [instructions]`
- `/clear`
- `/cls`
- `/exit` / `/quit`

其中几个和 Claude Code 对齐时容易混淆的语义是：

- `/clear`
  - 清空当前会话上下文，并启动一个新的空 session
- `/cls`
  - 只清屏，不影响当前 session
- `/resume`
  - 带 `session-id` 时切到该会话
  - 不带参数时显示最近的 sessions，便于继续恢复
- `/runtime`
  - 不带参数时显示当前 runtime 解析结果，并列出当前可用 runtimes
  - `list` 时只显示当前可用 runtimes
  - 带 `name` 时切整套 runtime，不会只改主模型

当前这条 session / resume 链路还包含：

- session 元信息持久化：`meta.json`
- transcript 消息持久化：`messages.jsonl`
- `history` 视图中的最近会话摘要
- `resume` 时的 transcript 预览与继续交互
- persisted tool result 的基础记录与展示

当前这部分已经从“最小恢复链路”推进到“基础可持续使用”，但仍未完成完整会话管理体验；后续重点仍是更完整的 history / transcript 恢复视图、最近会话选择，以及更统一的 slash command 框架。

## Permission Mode 配置

当前 `dclaw` 已支持 4 种 `permission mode`：

- `default`
- `accept-edits`
- `plan`
- `bypass-permissions`

`permission mode` 现在支持 CLI、用户级配置和 workspace 级配置三层来源，优先级如下：

1. CLI `--permission-mode`
2. 用户级配置：`~/.dclaw/config.json`
3. workspace 配置：`<workspace>/.dclaw/config.json`
4. 内置默认值：`default`

如果设置了 `DCLAW_HOME`，用户级配置路径会改为：

- `<DCLAW_HOME>/config.json`

## Iteration 上限配置

当前 `dclaw` 主查询循环支持可配置的最大迭代上限，优先级如下：

1. CLI `--max-iterations`
2. 环境变量 `DCLAW_MAX_ITERATIONS`
3. 用户级配置：`~/.dclaw/config.json`
4. workspace 配置：`<workspace>/.dclaw/config.json`
5. 内置默认值：`128`

配置文件里可以写两种形式：

- `maxIterations`
- `DCLAW_MAX_ITERATIONS`

例如：

```json
{
  "maxIterations": 128
}
```

达到上限后，当前行为是直接停止本轮 agentic loop，并输出一条明确的终止消息；不会再额外补发一次 LLM 请求做兜底收口。

配置文件目前支持：

```json
{
  "permissionMode": "plan",
  "maxIterations": 128,
  "MODEL_PROVIDER": "openai-compatible",
  "DCLAW_QUERY_TRACE": true,
  "OPENAI_MODEL": "kimi-k2.5",
  "OPENAI_API_STYLE": "chat-completions"
}
```

除 `permissionMode` 之外，`config.json` 现在也可以承载一批运行时配置，主要包括：

- `DCLAW_*`
- `OPENAI_*`
- `ANTHROPIC_*`
- `LLM_PROVIDER`
- `MODEL_PROVIDER`

例如：

- `maxIterations`
- `DCLAW_MAX_ITERATIONS`
- `MODEL_PROVIDER`
- `DCLAW_LLM_MAX_RETRIES`
- `DCLAW_LLM_TIMEOUT_MS`
- `DCLAW_ENABLE_STREAM_WATCHDOG`
- `DCLAW_STREAM_IDLE_TIMEOUT_MS`
- `DCLAW_QUERY_TRACE`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_BASE_URL`
- `OPENAI_API_STYLE`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`

另外，`config.json` 当前仍然不能设置：

- `DCLAW_HOME`

可以用下面的命令查看当前实际生效的 `permission mode` 及其来源：

```bash
npm run start -- --doctor
```
