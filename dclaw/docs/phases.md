# dclaw 阶段规划

## 当前快照

- 当前处于 `v0.2` 启动阶段
- 当前主线：推进阶段 8、9、10，把上下文管理 / 自动压缩、Plan / Task、Memory 做成新的核心主线
- 当前已知进展：
  - 阶段 1-2 已基本完成
  - 阶段 3-5 已打通最小主链路并持续收紧语义
  - 阶段 6 已接入最小 permission evaluator
  - 阶段 7 已接入 session store、`resume`、history 与基础 REPL commands
  - 阶段 8 已从首段 model-aware `tool result budget` 推进到 manual compact、共享 `contextStats`、模型生成 compact summary 与最小 autocompact
  - 阶段 9 已接入 task board、plan file、最小 `Task*` 与基础 plan mode runtime 摘要
  - 阶段 10 仍处于设计完成、尚未编码的状态

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

当前实现补充：

- 已支持 `default / accept-edits / plan / bypass-permissions`
- 已接入 CLI、用户级与 workspace 级配置解析

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

当前实现补充：

- 已支持最小 session 持久化
- 已支持恢复历史消息后继续执行 prompt
- `interactive` 已推进到 REPL，并补上 `/history / resume / transcript / clear / compact` 等本地命令

### 阶段 8：上下文管理与自动压缩

目标：

- 解决长会话上下文增长问题
- 支持 compact boundary 与自动总结

交付：

- autocompact
- summary
- boundary

当前实现补充：

- 已接入首段 query-loop 级 `tool result budget / persistence`
- 已开始基于 resolved model limits 派生模型感知预算
- 已建立 manual compact 的 boundary / summary 最小内核，并切到 same-session compact 语义
- 已建立共享 `contextStats` 与 Claude Code 风格的 auto-compact threshold / percent-left recommendation
- 已接通 dry-run recommendation 到 REPL、verbose 与 query trace
- 已接通最小 autocompact 触发与失败回退链路，自动压缩可复用同一套 summary / boundary 流程
- 已完成首版 post-compact attachment 恢复：首轮 query-time runtime message 现可恢复最近读过的文件内容、plan file 内容、full `plan_mode` reminder，以及带 `current task / current step` 的 task reminder

当前差距补充：

- 当前已补齐消息级 compact boundary 与 runtime slicing 协议，compact 不再依赖 session-level source / target 元数据
- 当前 compact 后的上下文恢复已开始从 summary 文本 carry-over 转向 query-time runtime attachment；最近文件、plan file、plan mode、current task / current step 与 task reminder 已可通过首轮恢复层注入
- 当前仍只有“整段 compact 到 boundary + summary”的主路径；partial compact、recent tail preservation、reactive compact 仍未接入
- `microcompact / session memory compact / context collapse` 这类更深层上下文调度当前不进入最近主线，避免阶段 8 过早发散

阶段 8 下一步优先级：

1. 补齐 post-compact attachment 恢复，优先覆盖最近文件、plan file、plan mode、task/runtime 摘要
2. 再推进 partial compact 与 reactive compact
3. 更深的多层压缩策略继续下调到后续阶段

### 阶段 9：Plan / Task 执行框架

目标：

- 把“计划 -> 批准 -> 实施 -> 跟踪 -> 恢复”做成内核
- 将 planning 做成显式会话状态，而不是普通聊天文本
- 对齐 Claude Code 当前主路径：`plan mode + plan file + Task V2`

交付：

- enter / exit plan mode
- plan file
- task list store
- 当前步骤跟踪
- compact / resume 后的 planning state 延续

当前阶段进展补充：

- 已落地 `task board` 作为 planning / execution 状态容器
- 已接通最小 REPL 入口：`/plan`、`/plan start`、`/plan exit`
- 已移除 `TodoWrite` tool 与 `/todo` 系列命令，避免继续放大 Claude Code V1 checklist 路径
- 重新评估后确认：Claude Code 当前 interactive 主路径是 `TaskCreate / TaskList / TaskGet / TaskUpdate`
- 已接通 plan file 与 prompt runtime 摘要
- 已接通 Claude Code V2 最小 `Task*`：
  - `TaskCreate`
  - `TaskList`
  - `TaskGet`
  - `TaskUpdate`
- 当前 `Task*` 已按源码接入核心字段和按 id 更新语义；`TaskBoard` 也已收敛为 `plan mode + plan file + task/current step` 主路径，不再保留 `todos` 字段
- 当前 `Task*` 也已按 Claude Code 方式接入 tool prompt：
  - `Tool` 支持 `prompt()`
  - `queryLoop` 向模型发送长版 task tool prompt
  - `TaskCreate / TaskList / TaskGet / TaskUpdate` 已有独立 prompt 文件
- 当前也已接入最小 runtime task reminder：
  - 当 task board 已存在且最近几轮未使用 `TaskCreate / TaskUpdate` 时
  - 当前轮会临时注入 Claude Code 风格的 task-tool reminder
  - 提醒形态已调整为临时 `<system-reminder>` user meta message，而不是拼接到 system prompt
  - `TaskUpdate` 在完成任务后会明确引导调用 `TaskList`
- 当前也已接入最小 attachment-style plan-mode reminder：
  - `plan_mode`
  - `plan_mode_exit`
  - `plan_mode_reentry`
  - 当前以临时 `<system-reminder>` user meta message 近似，不写回 transcript
  - compact 后第一轮若仍处于 `plan mode`，会强制补一次 full `plan_mode` reminder
- 已接通 compact 后最小 plan-mode carry-over：
  - compact summary 中会带上 plan-mode reminder
  - 可带回 plan file 路径、current step 与 pending work 摘要
- 当前这部分仍只是“summary 文本级延续”，不是 Claude Code 那种更完整的结构化 attachment / runtime 语义
- 仍未接入 swarm / teammate 相关的 task hook 扩展

阶段边界补充：

- `/plan` 不只是“查看有哪些计划”，而是 planning 状态的人机入口
- `plan mode` 不只是工具层只读限制，还要改变模型的工作节奏：
  - 先探索代码库
  - 必要时澄清问题
  - 产出结构化 plan / task breakdown
  - 等待批准后再退出并实施
- 真正切换当前 session 到 `plan mode` 时，应有明确的用户确认点；用户显式 `/plan` 可直接进入
- `plan mode` 需要有专门的 plan file 作为计划真值，而不只是靠聊天文本或结构化状态
- `task / current step` 必须是可恢复的会话状态，并在 `resume / history / /session` 中可观察
- `compact` 后如果仍在 `plan mode`，模型必须继续收到 plan-mode 指令，避免压缩后丢失 planning 语义
- 严格区分 Claude Code V1 与 V2：
  - V1 `TodoWrite` 是 Claude Code 源码里的 checklist tool，但 `dclaw` 已决定不再保留对应对外能力
  - V2 `TaskCreate / TaskList / TaskGet / TaskUpdate` 才是当前 interactive 主路径下的结构化 task 能力

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
- 剩余零散收尾项进入 backlog，不再继续阻塞版本切换

### v0.2

- 阶段 8-10
- 当前主线：
  - 上下文管理与自动压缩
  - Plan / Task 执行框架
  - Memory 系统

### v0.3

- 阶段 11-12
- 以及前序阶段中已明确后置的深化项：
  - `CLAUDE.md` 指令系统深化
  - 权限模式 / hooks 继续收口
  - `tool result budget / persistence` 与更广上下文压缩打磨

### v0.4

- 阶段 13
