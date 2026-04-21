# dclaw 阶段规划

## 当前快照

- 当前处于 `v0.3` 准备阶段
- 当前主线结论：阶段 8-10 已按当前范围收口；`v0.3` 只聚焦 subagent 与 skills，其它未完成项统一后置到 `v0.4`
- 当前已知进展：
  - 阶段 1-2 已基本完成
  - 阶段 3-5 已打通最小主链路并持续收紧语义
  - 阶段 6 已接入最小 permission evaluator
  - 阶段 7 已接入 session store、`resume`、history 与基础 REPL commands
  - 阶段 8 已按当前范围收口：主路径为 manual compact、共享 `contextStats`、模型生成 compact summary、最小 autocompact 与 post-compact 恢复
  - 阶段 9 已按当前范围收口：task board、plan file、`Task*`、plan-mode runtime 提醒、审批展示、plan 真值恢复、approved-plan task materialization 与 completed board retire 均已完成
  - 阶段 10 已按当前范围收口：`MEMORY.md` 常驻注入、side-query recall、自动 extraction、去重/升级、写回边界与非阻塞 drain 均已完成

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
- 当前阶段 8 已按当前范围收口，主路径统一围绕“整段 compact 到 boundary + summary”以及 autocompact / post-compact 恢复
- `microcompact / session memory compact / context collapse` 这类更深层上下文调度当前不进入最近主线，避免阶段 8 过早发散
- 最近一次代码/文档核对结论：`compact` 主路径实现与本阶段文档描述基本一致；当前没有发现“已完成项只是文档口径、代码未真正落地”的重大偏差。按当前产品取舍，`partial compact / reactive compact` 都已像 `TodoWrite` 一样主动舍弃，不再保留没有用户入口或没有外部源码实现可对齐的内部能力；阶段 8 因此按当前范围结束

阶段 8 收口结论：

1. 主路径保留 `full compact + autocompact + post-compact runtime attachment 恢复`
2. `partial compact / reactive compact` 都不进入 `dclaw` 当前主线
3. 后续仅在 Claude Code 外部源码出现新的可对齐主线路径时再重新评估

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
- 当前 `ExitPlanMode` 获批后，若 task board 仍为空，会立刻按 approved plan materialize 首版 task list，避免把“拆 task”拖到实施阶段临时进行
- 当前已补齐 Claude Code 风格的 completed task list 生命周期：当执行板 `inactive` 且可见 task 全部 `completed` 超过 `5s`，当前 session 会自动 retire 该 board，避免后续新请求继续追加到旧列表
- 当前 `Task*` 也已按 Claude Code 方式接入 tool prompt：
  - `Tool` 支持 `prompt()`
  - `queryLoop` 向模型发送长版 task tool prompt
  - `TaskCreate / TaskList / TaskGet / TaskUpdate` 已有独立 prompt 文件
  - 执行态提示已额外收紧到“优先消费 approved plan 的既有 task list”；若发现重大新增工作，应在当前轮结束时回到用户对齐，而不是静默扩张当前计划
- 当前也已接入最小 runtime task reminder：
  - 当 task board 已存在且最近几轮未使用 `TaskCreate / TaskUpdate` 时
  - 当前轮会临时注入 Claude Code 风格的 task-tool reminder
  - 提醒形态已调整为临时 `<system-reminder>` user meta message，而不是拼接到 system prompt
  - `TaskUpdate` 在完成任务后会明确引导调用 `TaskList`
- 当前也已接入最小 attachment-style plan-mode reminder：
  - `plan_mode`
  - `plan_mode_exit`
  - `plan_mode_reentry`
  - 当前以临时 `<system-reminder>` user meta message 近似；这些 reminder 仅作为当轮 runtime 注入，不再单独持久化到 transcript
  - compact 后第一轮若仍处于 `plan mode`，会强制补一次 full `plan_mode` reminder
- 已接通 compact 后最小 plan-mode carry-over：
  - 当前已不只依赖 compact summary 文本
  - compact 后第一轮会通过 runtime attachment 恢复最近文件、plan file、full `plan_mode` reminder，以及带 `current task / current step` 的 task reminder
- 当前这部分已进入首版结构化 runtime attachment 形态，并已接通 `resume / history / transcript` 的 planning 观察面；阶段 9-2 的 `ExitPlanMode` 审批正文展示与阶段 9-3 的 plan 真值恢复路径 / planning 生命周期规则都已收口，而不是把 task board 全量状态写进 transcript
- 按 `v0.2` 当前范围，这一阶段已收口；swarm / teammate 相关的 task hook 扩展后置到 `v0.4`

阶段边界补充：

- `/plan` 不只是“查看有哪些计划”，而是 planning 状态的人机入口
- `plan mode` 不只是工具层只读限制，还要改变模型的工作节奏：
  - 先探索代码库
  - 必要时澄清问题
  - 产出结构化 plan / task breakdown
  - 等待批准后再退出并实施
- `EnterPlanMode` 直接进入 planning；进入 planning 本身不是审批点。`ExitPlanMode` 才是唯一的计划审批点；用户显式 `/plan` 也可直接进入
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

当前阶段进展补充：

- 已完成 `10-1` 的 file-based memory 骨架，对齐 Claude Code `memdir` 风格落地最小目录与模块边界
- 当前已新增 `src/memory/paths.ts / frontmatter.ts / store.ts / manifest.ts / recall.ts`
- 当前已落地：
  - `~/.dclaw/projects/<sanitized-workspace>/memory/`
  - `MEMORY.md`
  - 独立 memory markdown 文件
  - `name / description / type / updated_at` 最小 frontmatter
  - 基于 frontmatter 的 file-based manifest
- 当前已接通：
  - `MEMORY.md` 常驻 system prompt
  - side-query recall 与 query-time prompt 注入
  - turn-end automatic extraction
  - memory-only scoped `Read / Edit / Write`
  - 去重 / 升级护栏与 `WHAT_NOT_TO_SAVE_SECTION` 写回边界
  - 非阻塞后台写回与退出软 drain
- 当前已补 memory 单测护栏，覆盖 frontmatter、路径、store、manifest、recall 选择/回退、prompt 注入上限、写回去重/升级、后台 extraction 与写回边界提示

阶段边界补充：

- memory 继续以文件系统与 `MEMORY.md` 入口为主，不扩成通用知识库或 transcript 备份
- `MEMORY.md` 只做短索引，不直接承载整段 memory 正文
- 自动写回只分析最近新增对话，不顺手探索代码库
- team memory sync、跨端同步与更复杂 ranking 继续后置

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
- 当前结论：
  - 上下文管理与自动压缩
  - Plan / Task 执行框架
  - Memory 系统
  - 已按当前产品范围收口，可进入 `v0.3`

### v0.3

- 阶段 11 的 subagent 主路径
- 阶段 12 的 skills 主路径

### v0.4

- 阶段 11 的 `worktree / coordinator / 多 worker` 剩余项
- 阶段 12 的 `MCP / plugins / remote bridge` 剩余项
- 阶段 13
- 以及前序阶段中已明确后置的深化项：
  - `CLAUDE.md` 指令系统深化
  - 权限模式 / hooks 继续收口
  - `tool result budget / persistence` 与更广上下文压缩打磨
