# 02-MVP设计

## 1. MVP 目标

MVP 的目标不是一次做成“成熟完整的 Claude Code”，而是先做出一个可工作的通用 agent 主链路。

MVP 应该满足：

- 可以在终端中多轮交互
- 可以在 headless 模式运行
- 可以调用基础工具
- 可以读项目级指令
- 可以保存并恢复会话

## 2. MVP 范围

纳入：

- CLI
- Query Engine
- System Prompt 装配
- `DCLAW.md` 基础加载
- 基础工具集
- permission mode
- session / resume

不纳入：

- compact
- memory recall
- 多代理
- MCP
- plugin / skill
- remote bridge
- coding 场景增强

## 3. MVP 目录焦点

MVP 只需要重点实现这些目录：

- `src/cli/`
- `src/core/`
- `src/llm/`
- `src/prompt/`
- `src/tools/`
- `src/permissions/`
- `src/session/`
- `src/types/`
- `src/utils/`

## 4. MVP 模块拆分

### 4.1 CLI

负责：

- interactive 入口
- `--print` 入口
- `resume`
- `doctor`

当前实现状态补充：

- `interactive` 已不是占位入口，而是最小可用 REPL
- 已支持首批本地 REPL commands，包括 `/help / session / history / doctor / model / permissions / config / transcript / resume / compact / clear / cls / exit`
- `resume` 已不再只是占位入口，而是支持恢复 transcript 后继续进入同一套 REPL
- REPL 内的 `/resume` 在不带参数时会显示最近 sessions，便于继续恢复
- session 元信息与 transcript 已分别持久化到 `meta.json` 与 `messages.jsonl`

### 4.2 Query Engine

负责：

- 消息循环
- tool_use 检测
- tool_result 回填
- streaming
- abort / maxTurns

与之配套的近期任务：

- 保留当前 `stub` provider 作为联调通道
- 接入第一个真实 LLM provider
- 优先实现 `Anthropic` 的最小消息调用

### 4.3 Prompt Assembler

负责：

- 默认 system prompt
- runtime context 注入
- `DCLAW.md` 注入
- 自定义 system prompt 追加

### 4.4 Tools

首批工具建议：

1. `Read`
2. `Edit`
3. `Write`
4. `Glob`
5. `Grep`
6. `Bash`
7. `WebFetch`
8. `AskUserQuestion`

### 4.5 Permissions

MVP 模式建议：

- `default`
- `accept-edits`
- `plan`
- `bypass-permissions`

当前实现补充：

- 这 4 种模式均已接入工具执行链路
- 当前还没有 hooks 和更细粒度规则

### 4.6 Session

建议存储：

```text
默认: ~/.dclaw/sessions/<session-id>/
若设置 DCLAW_HOME: <DCLAW_HOME>/sessions/<session-id>/
  meta.json
  messages.jsonl
```

## 5. MVP 开发顺序

建议顺序：

1. CLI 与参数解析
2. LLM client 抽象
3. Query Engine
4. Prompt Assembler
5. 基础工具与 registry
6. 权限模式
7. Session / Resume

## 6. MVP 验收标准

1. 能跑通一次完整的 tool-use 循环。
2. `--print` 模式可独立运行。
3. 支持恢复 session，并在恢复后继续执行新的 prompt。
4. 能读取项目级 `DCLAW.md`。
5. 危险工具可被权限系统拦截。

## 7. 详细参考

- 详细设计见 [mvp-tech-design.md](./mvp-tech-design.md)
- Tool 协议见 [tool-spec.md](./tool-spec.md)
- Prompt 设计见 [prompt-system.md](./prompt-system.md)
