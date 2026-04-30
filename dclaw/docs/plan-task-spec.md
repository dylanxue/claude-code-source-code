# Plan / Task 设计稿

## 1. 目标

这份文档定义阶段 9 的首版落地方案，目标是把 `plan mode`、`task`、`current step`，以及必要的内部 checklist 状态做成可切换、可恢复、可注入 prompt 的执行状态，而不是普通聊天文本。

首版设计遵循两条原则：

- 严格对齐 Claude Code 当前源码表现，不额外扩成项目管理系统
- 先解决单会话执行控制，再考虑更复杂的多任务图和跨会话聚合

## 1.1 最新源码发现

结合平级 `claude-code` 源码，阶段 9 目前需要明确区分 Claude Code 的两层能力：

- V1：`TodoWrite`
  - 是模型可调用 tool，不是用户 slash command
  - 语义是整份 session checklist 覆写
  - 输入项没有稳定 id，核心字段是 `content / status / activeForm`
- V2：`TaskCreate / TaskList / TaskGet / TaskUpdate`
  - 是另一套更结构化的 task 能力
  - 具备 task id，支持按 id 查询和更新

进一步确认后，阶段 9 需要按 Claude Code 当前主路径重新排序：

- `plan mode` 的核心不只是 permission mode，而是：
  - EnterPlanMode / ExitPlanMode 两个带用户确认点的工具
  - plan-mode 专属系统指令
  - compact 后仍会继续出现的 plan-mode reminder / attachment
  - 一个可持续编辑、可恢复、可在审批 UI 中展示的 plan file
- 在 interactive 场景下，Claude Code 当前主路径优先使用 V2 `Task*`
- V1 `TodoWrite` 更像源码参照里的兼容/降级路径，不应再被当成阶段 9 的最终产品形态

因此 `dclaw` 阶段 9 的功能需求应调整为：

1. 先把 `plan mode + plan file + compact/resume 延续` 做完整  
2. 再把 interactive 主路径的任务跟踪对齐到 `TaskCreate / TaskList / TaskGet / TaskUpdate`  
3. `dclaw` 不再保留 `TodoWrite` 与 `/todo`，对外能力收敛到 `plan file + Task*`

结合当前 `dclaw` 已实现部分，还要补一条更细的对齐结论：

- `dclaw` 已具备 plan file 与 prompt runtime 的 planning-state 注入
- `dclaw` 已具备 compact summary 级别的最小 plan-mode carry-over
- 但这还不等同于 Claude Code 当前实现
- Claude Code 还具备两层 `dclaw` 尚未完全接通的能力：
  - 模型侧 `EnterPlanMode / ExitPlanMode`
  - compact 后更完整的结构化 plan-mode reminder / attachment / runtime 恢复语义

因此阶段 9 的近期实现优先级应明确为：

1. 把模型侧 enter / exit flow 做起来
2. 把确认事件落到 transcript 可观察面，并避免把 runtime reminder 混成新的持久化真值
3. 把现有 compact summary 级 carry-over 升级为更完整的结构化 plan attachment / runtime 语义

这里还需要补一条新的对齐结论：

- Claude Code 关于 `Task*` 的“使用时机、顺序、状态流转”并不是主要写在 system prompt 里
- 这些规则主要写在各个 task tool 自己的 prompt 里，并通过 API tool description 发给模型
- 因此 `dclaw` 如果要做到和 Claude Code 一样，不能只做 `Task*` 数据结构和 tool 调用，还需要补 tool prompt 这一层
- 除了 tool prompt，Claude Code 还会在合适时机通过 attachment 发出 task reminder；`dclaw` 当前已收敛到临时 `<system-reminder>` user meta message 这一近似形态
- 同理，Claude Code 的 `plan_mode / plan_mode_exit / plan_mode_reentry` 也是 attachment 驱动；`dclaw` 当前已补上对应的最小临时 `<system-reminder>` user meta message 形态

## 2. 产品边界

首版要解决：

- 用户显式进入 / 退出 `plan mode`
- 模型可发起进入 `plan mode` 请求，但不能静默切换当前主会话状态
- planning 状态下的 plan file、task / current step 持久化
- `resume` / `history` / `/session` 可观察
- prompt runtime context 可消费这些状态
- compact 后仍能保留 planning reminder / attachment
- `Task*` 的模型使用规则能通过 tool prompt 被看到，而不只存在于文档或人类约定中

首版不做：

- 多个 plan board 的项目级总览
- 复杂依赖图、多人协作任务分配
- 自动从自然语言计划文本反向抽取 task graph
- 脱离当前 workspace 的全局任务中心
- teammate / swarm 专属 task prompt 分支

## 3. 对齐 Claude Code 的行为规则

`dclaw` 的 `plan mode` 首版应实现为：

- 模型可以建议进入 `plan mode`
- 模型可以发起进入 `plan mode` 请求
- 当前主会话真正切换到 `plan mode` 前，必须经过用户确认
- 用户显式输入 `/plan` 时可直接进入
- `plan mode` 不只是工具层只读限制，还会改变模型的工作目标，并绑定一个 plan file
- 退出 `plan mode` 并进入实施阶段时，应有明确确认点
- 如果 compact 发生在 `plan mode` 中，后续 session 必须继续收到“仍处于 planning、plan file 是真值、不要直接实施”的提醒
- `dclaw` 当前已经具备最小版：这些提醒会进入 compact summary 文本，并且在 compact 后第一轮 query 强制补一次 full `plan_mode` reminder
- 后续要补的是 Claude Code 更完整的结构化 attachment / runtime 恢复语义，而不是从 0 开始补 reminder

进入 `plan mode` 后，模型的默认工作节奏应切到：

1. 探索代码库
2. 识别已有模式和风险
3. 必要时提出澄清问题
4. 产出结构化 plan / task breakdown
5. 等待批准后进入实施

进入 execution 后，若使用 `Task*`，模型的默认工作节奏应进一步对齐 Claude Code：

1. `TaskList` 看当前任务概览
2. 必要时 `TaskCreate`
3. 开工前 `TaskGet`
4. 开工时 `TaskUpdate(status=in_progress)`
5. 完成后 `TaskUpdate(status=completed)`
6. 再次 `TaskList` 看是否有下一项工作

## 4. 首版存储方案

### 4.1 为什么不直接绑死在 session

如果 `task` 只挂在单个 `sessionId` 上，那么一旦：

- `/compact`
- 同一任务跨 compact 继续推进
- `resume` 到新的实现阶段

就很容易出现状态丢失或重复注入。

因此首版建议引入 **task board** 概念：

- `session` 是对话容器
- `task board` 是当前 planning / execution 状态容器
- 一个 board 可以被多个连续 session 复用

但这里需要补一条重新评估后的要求：

- `task board` 不是 plan 的唯一真值
- 对齐 Claude Code 时，plan 本身应以独立 `plan file` 为真值
- `task board` 更适合承载 mode / current step / task list / request 状态

### 4.2 建议目录

首版建议放在 workspace 级 `.dclaw/` 下：

- `.dclaw/task-boards/<board-id>.json`
- `.dclaw/plans/<plan-id>.md`

同时在 session metadata 中保存：

- `taskBoardId`

这样：

- `resume` 能快速找到当前 board
- `compact` 后同一 session 仍可继续复用同一个 board
- `plan mode` 退出审批时可以直接展示 plan file 内容
- 不需要先做复杂索引系统

补充当前实现边界：

- `dclaw` 现在已经会在 compact 后沿用同一 board，并在 compact 后第一轮通过 runtime 恢复层带回：
  - 最近读过的文件内容
  - `plan file` 内容
  - full `plan_mode` reminder
  - 带 `current task / current step` 的 task reminder
- 这条能力已经不再只是“summary 文本级 carry-over”
- 后续要继续补齐的是更完整的结构化 attachment、resume 展示一致性与更强的 runtime 语义

## 5. 数据模型

## 5.1 Task Board

```ts
type PlanModeStatus = 'inactive' | 'active' | 'enter_requested' | 'exit_requested'

type TaskBoard = {
  boardId: string
  workspaceId: string
  rootSessionId: string
  latestSessionId: string
  planFilePath?: string
  mode: PlanModeStatus
  createdAt: string
  updatedAt: string
  enterRequest?: PlanModeRequest
  exitRequest?: PlanModeRequest
}
```

说明：

- `inactive`：当前不在 `plan mode`
- `enter_requested`：模型已请求进入，等待用户确认
- `active`：已进入 `plan mode`
- `exit_requested`：已请求退出并开始实施，等待用户确认
- `planFilePath` 指向当前 session/board 使用的计划文件

## 5.2 Request

```ts
type PlanModeRequest = {
  requestId: string
  requestedBy: 'user' | 'model'
  createdAt: string
  note?: string
}
```

说明：

- 用户 `/plan` 直接进入时，不一定需要落 `enter_requested`
- 模型发起进入/退出请求时，需要显式记录 request，便于 transcript 和恢复

## 5.3 Task

```ts
type TaskStatus = 'pending' | 'in_progress' | 'completed'

type TaskRecord = {
  id: string
  subject: string
  description: string
  activeForm?: string
  owner?: string
  status: TaskStatus
  blocks: string[]
  blockedBy: string[]
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}
```

说明：

- 这里按 Claude Code 当前 `Task*` 的最小字段集对齐
- `deleted` 不是持久状态，而是 `TaskUpdate` 时的特殊动作
- planning 侧的 `PlanBoard` 不再保存 execution task 或 current step

## 6. 状态机

### 6.1 进入流程

#### 用户显式进入

```text
executing/inactive
  -> /plan
  -> active
```

这条路径不经过模型审批，因为本质是用户直接操作。

#### 模型发起进入请求

```text
inactive
  -> model requests enter
  -> enter_requested
  -> user allow
  -> active
```

如果用户拒绝：

```text
enter_requested
  -> user reject
  -> inactive
```

### 6.2 退出流程

```text
active
  -> /plan exit 或模型请求退出
  -> exit_requested
  -> user allow
  -> inactive
```

如果用户拒绝退出，则回到 `active`。

## 7. 命令设计

补充约束：

- 这些 slash commands 是 `dclaw` 首版 REPL 的本地入口，不应决定最终模型能力形态
- Claude Code 当前 interactive 主路径里，任务跟踪重点是 `Task*` + 持续任务面板，而不是 V1 checklist 命令
- 因此 `dclaw` 当前对外能力只保留 `/plan` 和 `Task*`，不再继续保留 `/todo` 系列命令

### 7.1 `/plan`

语义：

- 当前不在 `plan mode`：进入 `plan mode`
- 当前已在 `plan mode`：显示当前 plan / task 摘要

显示内容建议包括：

- `plan mode: active/inactive`
- `plan file path`
- plan board brief（title / purpose / background / plan / scope / verification）
- 当前 board id

### 7.2 `/plan`（plan mode 已激活时）

作用：

- 展示当前 `plan board` 与 `plan file` 状态

当前语义：

- `plan mode` 只负责规划，不在 board 内创建 task
- execution task 只在 `TaskCreate` 时启动，并进入单独的 execution `TaskBoard`

### 7.3 `/plan exit`

作用：

- 请求退出 `plan mode`
- 若为用户显式操作，可直接退出并将 mode 置为 `inactive`
- 后续若接入 Claude Code 式退出确认 UI，可改成 `exit_requested -> allow`

### 7.4 不再保留 `/todo` 与 `TodoWrite`

说明：

- Claude Code 源码里仍存在 V1 `TodoWrite`
- 但 `dclaw` 阶段 9 对外能力不再保留对应 tool 或 slash command
- `PlanBoard` 现已只保留 `plan mode + plan file + board brief` 这条主路径，不再继续保留内部 task/current step
- 首版继续优先围绕 `Task*` 主路径与 plan file 打磨体验

## 8. Prompt 注入设计

首版不需要把整个 board 原样注入 prompt，只注入受控摘要；但 plan file 路径和 plan-mode 约束必须显式注入。

这里再补一个 compact 相关边界：

- 当前 `dclaw` 已允许通过 compact summary 文本把 planning reminder / plan file / plan board brief 带到 compact boundary 之后的上下文
- 这解决的是“compact 后 planning 语义完全丢失”的问题
- 但它还不等同于 Claude Code 的结构化 attachment / runtime 恢复；后续实现应从“文本 carry-over”继续升级，而不是重复造一套新 reminder

同时需要明确一个边界：

- plan / task 的**状态摘要**，属于 system prompt runtime context
- `TaskCreate / TaskList / TaskGet / TaskUpdate` 的**使用规则**，属于 tool prompt
- 不要把 task tool 的细粒度工作流规则直接塞进 `plan / task context`

建议在 `src/prompt/` 增加专门 section，例如：

- `Plan Mode Context`

注入内容建议：

```text
Current execution state:
- plan mode: active
- plan file: .dclaw/plans/plan_xxx.md
- board plan: implement memory recall and document the migration path

When in plan mode:
- focus on exploration and implementation planning
- do not start mutating files until plan mode is exited
- the plan file is the only file you may edit while planning
- keep task state and pending work summaries updated as the plan evolves
```

### 8.1 planning 状态下注入

当 `mode=active` 时，prompt 应额外提醒：

- 当前处于 planning 阶段
- 目标是提出实施方案，不是直接实现
- 可以读代码、查模式、问澄清问题
- 不应直接进入实施口径

### 8.2 executing 状态下注入

当 `mode=inactive` 但 board 仍存在时，prompt 仍可注入轻量摘要：

- 当前 task
- 当前步骤
- 未完成 todo 数

这样模型在退出 `plan mode` 后，仍能沿着同一任务继续执行。

### 8.3 Task Tool Prompt 对齐方案

为了与 Claude Code 当前源码一致，阶段 9 需要新增一条实现线：

1. `Tool` 基础设施支持长版 `prompt()`
2. 发送给模型的 tool definition 使用 `prompt()` 结果，而不是短 `description`
3. 为 `TaskCreate / TaskList / TaskGet / TaskUpdate` 单独维护 prompt 文件

这 4 个 prompt 的首版应至少覆盖：

- `TaskCreate`
  - 复杂任务 / plan mode / 用户明确要求 todo 时使用
  - 单一 trivial task 不使用
  - 创建前优先 `TaskList` 避免重复

- `TaskList`
  - 看可做任务
  - 完成后再次查看
  - 多个任务可选时按 ID 顺序优先

- `TaskGet`
  - 开始前读取完整描述
  - 开始前确认 `blockedBy` 为空

- `TaskUpdate`
  - 更新前先 `TaskGet`
  - 开工时标 `in_progress`
  - 完成时标 `completed`
  - 未完全完成时不能标完成
  - `deleted` 作为删除动作
  - `addBlocks / addBlockedBy` 用于建立依赖

## 9. Transcript 与恢复语义

首版不应把 task/planning 状态只存成聊天文本。

建议分层：

- transcript：保存用户/assistant/tool 消息，以及 enter/exit plan mode 的确认事件摘要；runtime reminder 不应作为独立持久化真值
- plan file：保存计划正文真值
- task board：保存结构化 task/current step/request 状态，以及必要的 checklist/待办摘要真值

建议进入 transcript 的事件：

- `plan_mode_enter_requested`
- `plan_mode_enter_approved`
- `plan_mode_enter_rejected`
- `plan_mode_exit_requested`
- `plan_mode_exit_approved`
- `plan_mode_exit_rejected`

目的：

- `resume` 后可解释“为什么现在处于这个模式”
- transcript 可读性更强
- 结构化真值仍以 task board 为准

## 10. 首版实现顺序

### 10.1 P0

1. `src/planboard/store.ts`
2. `src/taskboard/types.ts`
3. `src/taskboard/state.ts`
4. workspace `.dclaw/task-boards/` 持久化
5. session meta 挂 `taskBoardId`
6. workspace `.dclaw/plans/` 与 plan file 持久化
7. `/plan` 进入后绑定或创建 plan file
8. prompt 注入最小摘要与 plan-file 约束
9. `TaskCreate / TaskList / TaskGet / TaskUpdate` 作为 interactive 主路径接入
  - 当前已落地最小版本，字段和基础行为按 Claude Code 当前源码对齐
  - 当前范围聚焦单 session task board，不包含 swarm hook / mailbox 这类协作扩展
10. `TaskBoard` 不再包含 `todos`；对外与对内主路径都统一围绕 `Task*`

### 10.2 P1

1. 模型发起 `EnterPlanMode` / `ExitPlanMode` 请求
2. transcript 中的 plan mode 事件
3. `resume` / `history` / `/session` 展示摘要
4. 将当前首版 runtime attachment 继续升级为以 plan 真值恢复为核心的 transcript / attachment / runtime 语义，并继续沿用同一 board 与同一 plan file
5. 与 task 面板或 `/task` 观察入口打通

## 11. 验收标准

首版完成后，应满足：

- 用户可通过 `/plan` 进入 planning 状态
- `plan mode` 下变更型工具仍被权限层拦住
- plan file 在重启、`resume` 与 `compact` 后可延续
- task/current step 在重启或 `resume` 后可恢复
- `compact` 或后续继续任务时，可复用同一 board，并继续收到 plan-mode 指令
- 当前首版已不只依赖 compact summary 文本 carry-over；compact 后第一轮已经会通过 runtime attachment 恢复最近文件、plan file、plan-mode reminder 与 task/current step。阶段 8 已按当前范围收口，主线继续围绕 full compact；`partial compact / reactive compact` 都已像 `TodoWrite` 一样作为非主线路径主动舍弃。后续再继续补齐以 plan 真值恢复和 planning 生命周期为核心的 transcript / attachment / runtime 语义
- prompt 能区分“正在计划”与“正在执行”，并知道 plan file 位置
- 模型在 `plan mode` 下不会默认进入实施口径
- interactive 主路径可使用 `TaskCreate / TaskList / TaskGet / TaskUpdate`
- `dclaw` 不再暴露 `TodoWrite` 或 `/todo`；interactive 主路径统一围绕 `Task*`
