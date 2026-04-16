# dclaw

`dclaw` 是一个严格参考 Claude Code 通用能力边界设计的终端优先通用 agent 项目。

当前仓库中的 `dclaw/` 目录已经进入 `v0.1` 后半段，当前重点是收口通用 agent 的 MVP 主链路，继续把 CLI、Query Engine、Prompt、`CLAUDE.md`、Tool、Permission 与 Session/Resume 往可持续使用的状态推进。

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
4. CLAUDE.md 指令系统
5. Tool 协议与基础工具
6. 权限模式与 Hooks
7. Session 与恢复
8. 上下文压缩
9. Plan / Task / Todo
10. Memory
11. 多代理与 Worktree
12. MCP / Skills / Plugins / Remote
13. Coding 场景增强

## 当前状态

- 方案文档已初始化
- 目录骨架已建立
- TypeScript 基础工程已初始化
- CLI 与最小 Query Engine 已可运行
- Prompt / `CLAUDE.md` 基础链路已接入
- Tool registry 与基础工具链路已接入，并进入语义收紧阶段
- 最小 permission mode 已接入 tool 执行链路
- 最小 session store / transcript 持久化 / `resume` 恢复链路已打通
- 当前仍处于 `v0.1` 收尾阶段，REPL、history、compact、memory、多代理、MCP / skills / plugins 等能力尚未进入完成态

## 测试

当前已接入一套基础自动化测试，覆盖：

- `Read`
- `Edit / Write`
- `Bash`
- `Glob / Grep`
- `WebFetch / AskUserQuestion`
- `queryLoop` 下的 permission mode 集成行为
- `session / resume`

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

## Provider 与模型配额

当前 `dclaw` 已支持：

- `stub`
- `anthropic`
- `openai`

运行时配置现在按更接近 Claude Code 的分层来解析：

- `provider selection`：CLI `--provider` 优先，否则尝试 `DCLAW_PROVIDER` / `LLM_PROVIDER` / `MODEL_PROVIDER`
- `provider config`：按 provider 分别解析 `api key / base url / api style`
- `model selection`：CLI `--model` 优先，否则回退到 provider 默认模型
- `model limits`：最后再按 provider + model 解析 token 配额

真实 provider 会先从当前工作目录加载 `.env`，再加载 `.env.local`，随后再读取当前 shell 环境：

- `ANTHROPIC_API_KEY` / `DCLAW_ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL` / `DCLAW_ANTHROPIC_MODEL`
- `OPENAI_API_KEY` / `DCLAW_OPENAI_API_KEY`
- `OPENAI_MODEL` / `DCLAW_OPENAI_MODEL`
- `OPENAI_BASE_URL` / `DCLAW_OPENAI_BASE_URL`
- `OPENAI_API_STYLE` / `DCLAW_OPENAI_API_STYLE`

其中 `openai` provider 当前同时支持两种请求风格：

- `responses`
- `chat-completions`

默认会优先根据 `OPENAI_API_STYLE` 显式配置判断；未配置时会按 base URL 和 `MODEL_PROVIDER=openai-compatible` 做兼容推断。

模型 token limit 采用“内置默认值 + 覆盖”的方式：

- 全局覆盖：
  - `DCLAW_MAX_CONTEXT_TOKENS`
  - `DCLAW_MAX_OUTPUT_TOKENS`
  - `DCLAW_MAX_OUTPUT_TOKENS_UPPER_LIMIT`
- 模型级覆盖：
  - `DCLAW_MODEL_LIMITS_JSON`
  - `DCLAW_MODEL_LIMITS_FILE`
  - 默认文件路径：`~/.dclaw/model-limits.json`
  - 若设置 `DCLAW_HOME`，则默认文件路径改为 `<DCLAW_HOME>/model-limits.json`

示例：

```json
{
  "providers": {
    "openai": {
      "gpt-5": {
        "contextWindow": 900000,
        "maxOutputTokens": 96000,
        "maxOutputTokensUpperLimit": 128000
      }
    }
  }
}
```

可用以下命令查看当前 provider、默认模型和解析后的 token limit：

```bash
npm run start -- --doctor --provider openai
```

如果不显式传 `--provider`，`doctor` 也会尝试从配置链路推断 provider，并显示：

- `provider source`
- `model source`

这两个 `source` 字段当前可能出现：

- `cli`
- `env`
- `user_config`
- `workspace_config`
- `default`

含义分别是：

- `cli`：来自命令行参数
- `env`：来自当前 shell 环境或 `.env` / `.env.local`
- `user_config`：来自用户级 `config.json`
- `workspace_config`：来自 workspace 级 `config.json`
- `default`：来自内置默认值

当前内置也补了一批兼容模型的默认 limits，`openai` 和 `anthropic` 两侧都可直接使用这些模型名：

- `MiniMax`: `minimax-m2.7`, `minimax-m2.5`, `minimax-m2`
- `Moonshot / Kimi`: `kimi-k2.5`, `kimi-k2`
- `Zhipu / GLM`: `glm-4.5`, `glm-4.5-air`, `glm-4.5-flash`

## Streaming 与 SSE

`dclaw` 现在支持基础流式返回：

- `--stream`：直接输出文本增量
- `--output-format sse`：按 SSE 事件格式输出

SSE 模式下当前会输出：

- `assistant.delta`
- `tool.use`
- `tool.result`
- `response.complete`

示例：

```bash
npm run start -- --print --provider openai --output-format sse "Reply with exactly: ok"
```

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

配置文件目前支持：

```json
{
  "permissionMode": "plan",
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

- `MODEL_PROVIDER`
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
