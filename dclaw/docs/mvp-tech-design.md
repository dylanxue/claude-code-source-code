# dclaw MVP 技术设计

## 1. MVP 范围

MVP 只覆盖以下能力：

- CLI 与 headless
- Query Engine
- System Prompt 装配
- `DCLAW.md` 基础加载
- 基础 tools
- permission mode
- session / resume

暂不进入 MVP 的能力：

- compact
- memory recall
- 多代理
- MCP
- plugins
- remote bridge
- coding 场景增强

## 2. MVP 用户价值

MVP 应满足：

- 用户可以在终端中与 agent 多轮交互
- agent 可以调用本地工具
- agent 可以修改文件
- agent 可以在退出后恢复会话
- agent 能读取项目级指令

## 3. MVP 模块

### 3.1 CLI

文件：

- `src/cli/main.ts`
- `src/cli/parseArgs.ts`
- `src/cli/interactive.ts`
- `src/cli/headless.ts`

职责：

- 解析参数
- 初始化运行时
- 选择交互模式

### 3.2 LLM 抽象

文件：

- `src/llm/client.ts`
- `src/llm/providers/anthropic.ts`

职责：

- 标准化模型请求
- 标准化 streaming

当前实现状态：

- 已有 `stub`、`Anthropic`、`OpenAI` 三类 provider
- `Anthropic` 与 `OpenAI` 已支持基础 streaming
- `OpenAI` 已支持 `responses / chat-completions`

### 3.3 Query Engine

文件：

- `src/core/queryEngine.ts`
- `src/core/queryLoop.ts`

职责：

- 驱动消息循环
- 检测 `tool_use`
- 调用 tool registry
- 将 `tool_result` 回填消息流

### 3.4 Prompt Assembler

文件：

- `src/prompt/systemPrompt.ts`
- `src/prompt/sections.ts`
- `src/prompt/contextAssembler.ts`

职责：

- 组装最终 system prompt
- 注入 runtime context

### 3.5 DCLAW.md

文件：

- `src/prompt/dclawMd.ts`

MVP 只实现：

- 默认用户级 `DCLAW.md`：`~/.dclaw/DCLAW.md`
- 若设置 `DCLAW_HOME`，则用户级 `DCLAW.md` 改为 `<DCLAW_HOME>/DCLAW.md`
- `<project>/DCLAW.md`
- `<project>/DCLAW.local.md`

完整 include 和规则目录留到后续阶段。

### 3.6 Tools

文件：

- `src/tools/types.ts`
- `src/tools/registry.ts`
- `src/tools/builtin/*`

MVP 工具顺序：

1. `Read`
2. `Edit`
3. `Write`
4. `Glob`
5. `Grep`
6. `Bash`
7. `WebFetch`
8. `AskUserQuestion`

### 3.7 Permissions

文件：

- `src/cli/permissionModeConfig.ts`
- `src/permissions/evaluator.ts`

MVP 模式：

- `default`
- `accept-edits`
- `plan`
- `bypass-permissions`

当前实现补充：

- 这 4 种模式均已接入工具执行链路
- 当前仍缺 hooks 与更细粒度规则

### 3.8 Session / Resume

文件：

- `src/session/store.ts`
- `src/session/resume.ts`
- `src/session/paths.ts`
- `src/session/history.ts`
- `src/session/transcript.ts`
- `src/cli/repl.ts`
- `src/cli/replCommands.ts`

存储建议：

```text
默认: ~/.dclaw/sessions/<session-id>/
若设置 DCLAW_HOME: <DCLAW_HOME>/sessions/<session-id>/
  meta.json
  messages.jsonl
```

## 4. MVP 主流程

```text
启动 CLI
  -> 初始化配置
  -> 创建或恢复 session
  -> 组装 system prompt
  -> 读取 DCLAW.md
  -> 写入 user message
  -> 调用 LLM
  -> 若出现 tool_use 则执行工具
  -> 回填 tool_result
  -> 得到最终 assistant 响应
  -> 持久化 session
```

## 5. MVP 验收标准

1. 能完成一次完整的文件读取、编辑、总结闭环。
2. `exec` 模式可独立工作。
3. session 可恢复。
4. 项目级 `DCLAW.md` 可注入。
5. 危险工具可被权限系统拦截。

## 6. MVP 之后的首批扩展

MVP 后优先做：

1. 完整 `DCLAW.md` 发现与 include
2. compact / 更广上下文压缩
3. 更完整的 history / resume / slash command 体系
4. task / plan mode
5. memory
