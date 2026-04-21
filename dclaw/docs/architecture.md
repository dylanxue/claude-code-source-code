# dclaw 总体架构

## 1. 目标

`dclaw` 的目标是实现一个终端优先、工具驱动、支持长期会话、支持多代理协作、可扩展的通用 agent。

这个目标严格参考 Claude Code 在源码中已经体现出的通用能力边界：

- CLI / interactive / headless 双入口
- query engine 与消息循环
- system prompt 装配
- `CLAUDE.md` 指令系统
- tool 协议与工具注册
- permission mode 与 hooks
- session / history / resume
- compact / autocompact
- plan / task
- memory 与 relevance recall
- subagent / coordinator / worktree
- MCP / skills / plugins / remote bridge

## 2. 分层结构

### 2.1 CLI 层

职责：

- 接收用户输入
- 解析命令行参数
- 区分 interactive 与 headless 模式
- 组织初始化流程

对应目录：

- `src/cli/`

### 2.2 Core 层

职责：

- 维护 agent loop
- 管理消息流
- 管理模型调用
- 控制 turn、budget、abort、streaming

对应目录：

- `src/core/`
- `src/llm/`
- `src/types/`

### 2.3 Prompt 层

职责：

- 组装 system prompt
- 注入系统 section
- 加载 `CLAUDE.md` 指令
- 注入 memory、hooks、MCP、输出风格等上下文

对应目录：

- `src/prompt/`

### 2.4 Tool 层

职责：

- 定义统一 tool contract
- 注册 builtin tools
- 统一执行、校验、渲染、权限判定
- 适配 MCP tools

对应目录：

- `src/tools/`

### 2.5 Execution Control 层

职责：

- permission mode
- hook 执行与阻断
- task / plan 状态管理
- session 生命周期管理

其中阶段 9 首版建议引入 `task board` 作为 planning / execution 状态容器：

- session 负责消息历史
- task board 负责 `plan mode`、task、current step 真值
- session meta 通过 `taskBoardId` 挂接 task board

详细结构见 [plan-task-spec.md](./plan-task-spec.md)。

对应目录：

- `src/permissions/`
- `src/hooks/`
- `src/tasks/`
- `src/session/`

### 2.6 Long Context 层

职责：

- compact / summary / boundary
- memory 存储与召回
- 长会话上下文治理

对应目录：

- `src/compact/`
- `src/memory/`

### 2.7 Agent Coordination 层

职责：

- 子代理创建与继续
- coordinator / worker 分工
- worktree 隔离
- 异步后台任务

对应目录：

- `src/agent/`

### 2.8 Extensibility 层

职责：

- MCP
- skills
- plugins
- remote bridge

对应目录：

- `src/mcp/`
- `src/skills/`
- `src/plugins/`
- `src/remote/`

## 3. 核心数据流

### 3.1 主执行流

```text
User Input
  -> CLI
  -> QueryEngine
  -> Prompt Assembler
  -> LLM
  -> assistant response
  -> tool_use?
     -> Tool Registry
     -> Tool Execution
     -> tool_result
     -> QueryEngine loop
  -> final assistant output
  -> Session Persistence
```

### 3.2 指令装配流

```text
Default System Prompt
  + CLI/System Prompt Overrides
  + CLAUDE.md Instructions
  + Memory Prompt
  + Hooks Prompt
  + MCP Prompt
  + Output Style / Language
  -> Final System Prompt
```

### 3.3 长期上下文流

```text
Session History
  + Compact Summaries
  + Memory Recall
  + Current Turn Messages
  -> Query Context
```

## 4. 核心边界

### 4.1 当前明确纳入核心的能力

- 终端交互
- 工具驱动执行
- 权限控制
- 会话持久化
- memory
- plan/task
- 多代理
- MCP / skill / plugin / remote

### 4.2 明确后置的能力

- coding repo/workspace 优化
- 开发场景专用 prompt
- 代码工作流增强

这些能力放到 `src/scenarios/coding/`，不进入核心主架构。

## 5. 非目标

当前不作为主线目标的内容：

- 云端托管平台
- Web UI
- 团队后台管理系统
- Claude Code 源码中未体现的额外产品能力

## 6. MVP 截止点

建议 `v0.1` 截止到以下能力：

- CLI 与 headless
- Query Engine
- Prompt Assembler
- `CLAUDE.md`
- 基础工具
- Permission Mode
- Session / Resume

达到这个点后，`dclaw` 已经是一个可工作的通用 agent 外壳。
