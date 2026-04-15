# dclaw 阶段规划

## 核心 12 阶段

### 阶段 1：CLI 与运行入口

目标：

- 建立 interactive / headless 双入口
- 支持基础命令解析
- 建立启动初始化流程

交付：

- `dclaw`
- `dclaw --print`
- `dclaw resume`
- `dclaw doctor`

### 阶段 2：Query Engine 与消息协议

目标：

- 建立最小 agent loop
- 统一消息协议
- 支持流式输出、可中断、turn/budget 控制

交付：

- QueryEngine
- 消息标准模型
- 基础模型适配层

### 阶段 3：System Prompt 与指令装配

目标：

- 将 system prompt section 化
- 支持附加 prompt
- 统一上下文注入点

交付：

- system prompt builder
- prompt sections
- context assembler

### 阶段 4：CLAUDE.md 指令系统

目标：

- 支持用户级、项目级、本地级指令
- 支持多路径发现与优先级覆盖
- 支持 include

交付：

- `CLAUDE.md`
- `.claude/CLAUDE.md`
- `.claude/rules/*.md`
- `CLAUDE.local.md`

### 阶段 5：Tool 协议与基础工具集

目标：

- 建立统一 tool contract
- 建立 registry
- 先实现最基础通用工具

交付：

- `Bash`
- `Read`
- `Edit`
- `Write`
- `Glob`
- `Grep`
- `WebFetch`
- `AskUserQuestion`
- `todo_write` 或基础 `task_*`

### 阶段 6：权限模式与 Hooks

目标：

- 让 agent 具备可控执行能力
- 支持 hooks 阻断与反馈

交付：

- permission modes
- tool allow / deny / ask
- session hooks
- function hooks

### 阶段 7：Session、历史与恢复

目标：

- 支持 transcript
- 支持 resume
- 支持会话状态持久化

交付：

- session store
- transcript
- history
- resume

### 阶段 8：上下文管理与自动压缩

目标：

- 解决长会话上下文增长问题
- 支持 compact boundary 与自动总结

交付：

- autocompact
- summary
- boundary

### 阶段 9：Plan / Task / Todo 执行框架

目标：

- 把“计划、执行、跟踪、恢复”做成内核

交付：

- enter / exit plan mode
- task store
- todo store
- 当前步骤跟踪

### 阶段 10：Memory 系统

目标：

- 实现长期记忆能力
- 实现 query-time memory recall

交付：

- file-based memory
- `MEMORY.md`
- memory types
- recall
- team memory sync

### 阶段 11：多代理、Worktree 与协作执行

目标：

- 支持子代理和 coordinator 模式
- 支持隔离执行

交付：

- spawn / send / wait / stop
- coordinator / worker
- worktree isolation
- background agents

### 阶段 12：MCP、Skills、Plugins 与 Remote Bridge

目标：

- 支持扩展生态和远程能力

交付：

- MCP tools / resources
- skill tool
- plugin loader
- structured IO
- remote bridge

## 后置场景阶段

### 阶段 13：Coding 场景增强

目标：

- 把 coding 作为重点场景，而不是核心定义

交付：

- repo/workspace 感知
- 开发工作流增强
- 代码相关 prompt/tool 组合优化

## 推荐版本切分

### v0.1

- 阶段 1-7

### v0.2

- 阶段 8-10

### v0.3

- 阶段 11-12

### v0.4

- 阶段 13
