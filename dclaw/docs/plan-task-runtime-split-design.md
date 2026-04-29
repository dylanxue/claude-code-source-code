# Plan / Task Runtime Split 设计与落地记录

截至 `2026-04-29`，`dclaw` 的 `plan` / `Plan mode` / execution `TaskBoard` 语义已经完成一轮较大收敛。本文档用于记录：

1. 当前已经确认的设计结论
2. 当前代码已经落地到什么程度
3. 仍然保留的兼容策略与非目标

> 下一轮 Plan Mode 重构决策已经单独记录在 [plan-mode-session-meta-refactor.md](./plan-mode-session-meta-refactor.md)。本文档继续作为当前已落地实现的状态记录；新文档描述下一步目标态。

## 1. 最新结论

### 1.1 总体方向

- 采用 **PlanBoard / TaskBoard 双轨拆分**
- planning 与 execution 不再复用同一个 board
- `PlanBoard` 是跨 turn 的 planning 容器
- execution `TaskBoard` 是单 turn 的执行批次容器

### 1.2 Plan 侧语义

- `plan` 和 `Plan mode` 只用于创建和交付计划
- planning 阶段不创建 execution task
- `EnterPlanMode / ExitPlanMode` 只服务 planning lock
- `PlanBoard` 继续参与：
  - `plan file`
  - `plan mode reminder`
  - `compact / resume`
  - `history / resume / repl` 的 planning 摘要
- `PlanBoard` 现在是**纯计划容器**
- `PlanBoard` 不再保存：
  - `tasks`
  - `currentTaskId`
  - `currentStep`

### 1.3 Task 侧语义

- execution `TaskBoard` 只在真正开始执行时创建
- `TaskCreate` 是 execution `TaskBoard` 的唯一创建入口
- `TaskCreate` 只接受 `tasks[]`
- `tasks.length` 必须 `>= 3`
- 创建成功后立即开始执行：
  - 第 `1` 条自动置为 `in_progress`
- 同一时刻只允许一条 `in_progress`
- 如果已有其它 `in_progress` 任务，再开新的一条，直接返回 error
- execution `TaskBoard` 只活当前 turn
- turn 真正结束时：
  - 未完成任务统一转为 `cancelled`
  - board 写入结束状态
  - board 从 session 上解绑
- 下一轮如果还要继续，重新创建 fresh execution `TaskBoard`

### 1.4 Turn 结束语义

- `AskUserQuestion` / permission 本身不会天然结束 turn
- 它们只是 turn 内交互
- 只有 turn **真正结束** 时，execution `TaskBoard` 才 cleanup
- active execution `TaskBoard` 且仍有 unfinished task 时，不允许普通聊天式直接结束 turn
- query loop 会先用 `pre-end guard` 拦一次，并注入 repair reminder

允许结束的典型情况：

- 最终明确把控制权交还给用户
- permission 被拒绝，当前工作必须等待用户处理
- 系统级结束：
  - `abort`
  - `llm_error`
  - `max_iterations`

不允许结束的典型情况：

- `AskUserQuestion` 得到普通回答后还能继续执行
- permission 已被批准
- 只是做了一半就想切回普通总结或解释

## 2. 当前架构

### 2.1 SessionMeta

当前 session 元数据已经拆成双链路：

```ts
type SessionMeta = {
  planBoardId?: string
  taskBoardId?: string
  // ...
}
```

说明：

- `planBoardId` 指向 planning 容器
- `taskBoardId` 指向当前 turn 的 execution board
- 读取旧 session 时，仍保留 `taskBoardId -> planBoardId` 的兼容 fallback

### 2.2 PlanBoard

当前 `PlanBoard` 位于 [dclaw/src/tasks/types.ts](/Users/dylan/work/claude-code-source-code/dclaw/src/tasks/types.ts:1)：

```ts
type PlanBoard = {
  boardId: string
  workspaceId: string
  rootSessionId: string
  latestSessionId: string
  planFilePath?: string
  title?: string
  purpose?: string
  background?: string
  plan?: string
  scope?: string
  verification?: string
  mode: 'inactive' | 'active' | 'enter_requested' | 'exit_requested'
  resumePermissionMode?: PermissionMode
  createdAt: string
  updatedAt: string
  planModeReminderCount?: number
  lastPlanModeReminderTurnCount?: number
  hasExitedPlanModeInSession?: boolean
  needsPlanModeExitReminder?: boolean
  enterRequest?: PlanModeRequest
  exitRequest?: PlanModeRequest
}
```

当前 `PlanBoard` 的职责只有：

- planning 状态
- plan file 绑定
- plan brief / purpose / scope / verification
- plan-mode reminder 计数与 re-entry 语义

### 2.3 Execution TaskBoard

当前 execution `TaskBoard` 位于 [dclaw/src/taskboard/types.ts](/Users/dylan/work/claude-code-source-code/dclaw/src/taskboard/types.ts:1)：

```ts
type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'cancelled'

type TaskBoardExecutionState =
  | 'idle'
  | 'active'
  | 'completed'
  | 'cancelled'

type TaskBoard = {
  boardId: string
  workspaceId: string
  rootSessionId: string
  latestSessionId: string
  title?: string
  purpose?: string
  background?: string
  plan?: string
  scope?: string
  verification?: string
  createdAt: string
  updatedAt: string
  executionState: TaskBoardExecutionState
  executionStartedAt?: string
  executionEndedAt?: string
  executionEndReason?:
    | 'completed'
    | 'assistant_handoff'
    | 'permission_denied'
    | 'abort'
    | 'llm_error'
    | 'max_iterations'
  currentTaskId?: string
  currentStep?: string
  tasks: TaskRecord[]
}
```

说明：

- execution `TaskBoard` 与 plan file 无关
- execution `TaskBoard` 不再有 `mode: active/inactive/...`
- execution `TaskBoard` 只表达执行批次

## 3. 已落地实现

### 3.1 Plan 侧

以下已经落地：

- `dclaw/src/tasks/*` 已收成 plan-side 实现目录
- `PlanBoard` 的 task/current-step 模型已移除
- `taskState.ts` 已删除
- `planAttachment.ts` 已删除
- `/plan start` 已移除
- prompt / reminder / resume / history / repl 不再显示：
  - current task
  - current step
  - pending work summary

主要代码入口：

- [dclaw/src/tasks/store.ts](/Users/dylan/work/claude-code-source-code/dclaw/src/tasks/store.ts:1)
- [dclaw/src/core/planModeReminder.ts](/Users/dylan/work/claude-code-source-code/dclaw/src/core/planModeReminder.ts:1)
- [dclaw/src/cli/runtime.ts](/Users/dylan/work/claude-code-source-code/dclaw/src/cli/runtime.ts:1)
- [dclaw/src/cli/replCommands.ts](/Users/dylan/work/claude-code-source-code/dclaw/src/cli/replCommands.ts:1)
- [dclaw/src/session/history.ts](/Users/dylan/work/claude-code-source-code/dclaw/src/session/history.ts:1)
- [dclaw/src/cli/resume.ts](/Users/dylan/work/claude-code-source-code/dclaw/src/cli/resume.ts:1)

### 3.2 Execution 侧

以下已经落地：

- execution `TaskBoard` 已独立到 `dclaw/src/taskboard/*`
- `TaskCreate / TaskList / TaskGet / TaskUpdate` 已切到新 store
- `TaskCreate` 只接受 `tasks[] >= 3`
- `TaskCreate` 成功时自动启动第 `1` 条
- `TaskUpdate` 支持 `cancelled`
- 已有 `in_progress` 时再开另一条会直接报错
- `queryLoop` 已加入 `pre-end guard`
- `queryEngine` 正常和异常结束路径都会 cleanup execution board
- `compact / resume` 不再恢复 execution board

主要代码入口：

- [dclaw/src/taskboard/store.ts](/Users/dylan/work/claude-code-source-code/dclaw/src/taskboard/store.ts:1)
- [dclaw/src/taskboard/turnCleanup.ts](/Users/dylan/work/claude-code-source-code/dclaw/src/taskboard/turnCleanup.ts:1)
- [dclaw/src/tools/builtin/taskCreate.ts](/Users/dylan/work/claude-code-source-code/dclaw/src/tools/builtin/taskCreate.ts:1)
- [dclaw/src/tools/builtin/taskUpdate.ts](/Users/dylan/work/claude-code-source-code/dclaw/src/tools/builtin/taskUpdate.ts:1)
- [dclaw/src/tools/builtin/taskList.ts](/Users/dylan/work/claude-code-source-code/dclaw/src/tools/builtin/taskList.ts:1)
- [dclaw/src/tools/builtin/taskGet.ts](/Users/dylan/work/claude-code-source-code/dclaw/src/tools/builtin/taskGet.ts:1)
- [dclaw/src/core/queryLoop.ts](/Users/dylan/work/claude-code-source-code/dclaw/src/core/queryLoop.ts:1000)
- [dclaw/src/core/queryEngine.ts](/Users/dylan/work/claude-code-source-code/dclaw/src/core/queryEngine.ts:648)

## 4. 当前 runtime 语义

### 4.1 TaskCreate

当前行为：

- 必须传 `tasks[]`
- 必须 `>= 3`
- 如果当前 session 已有 attached execution board，直接报错
- 创建 fresh board
- 第 `1` 条任务自动 `in_progress`
- board 同时写入：
  - `executionState = active`
  - `executionStartedAt`
  - `currentTaskId`
  - `currentStep`

### 4.2 TaskUpdate

当前行为：

- 支持 `pending / in_progress / completed / cancelled`
- 若已有其它 `in_progress`，再设新任务为 `in_progress` 会返回 error
- 当最后一条 unfinished task 进入终止态时：
  - `executionState` 自动收束成 `completed` 或 `cancelled`

### 4.3 Turn guard

当前 `queryLoop` 已实现：

- 当 assistant 准备以普通文本结束 turn
- 如果 attached execution board 仍是 active 且有 unfinished task
- 且没有命中最终 handoff 条件
- 则先注入 repair reminder，而不是直接结束

### 4.4 Turn cleanup

当前 `queryEngine` 已实现：

- 正常 turn 完成后 cleanup
- `QueryLoopAbortError` 路径 cleanup
- `QueryLoopLlmError` 路径 cleanup

cleanup 行为：

- 若全部任务已 `completed`
  - board 记为 `completed`
- 否则
  - 所有 `pending / in_progress` 统一改成 `cancelled`
  - board 记为 `cancelled`
- 清空：
  - `currentTaskId`
  - `currentStep`
- 写入：
  - `executionEndedAt`
  - `executionEndReason`
- 将 `taskBoardId` 从 session 上解绑

## 5. Compact / Resume 策略

### 5.1 PlanBoard

`PlanBoard` 继续参与：

- `compact`
- `resume`
- plan file 恢复
- plan-mode reminder 注入

### 5.2 Execution TaskBoard

execution `TaskBoard` 不再参与：

- post-compact attachment 恢复
- post-compact task reminder carry-over
- resume 时的 board 恢复展示

这部分已经落地，不只是方案目标。

## 6. 兼容策略

当前仍保留两类兼容：

### 6.1 SessionMeta fallback

- 老 session 若只有 `taskBoardId`
- runtime 会在读取时尝试把它解释为 legacy `PlanBoard`
- 然后补写到 `planBoardId`

### 6.2 Legacy completed plan-board 退休逻辑

虽然 `PlanBoard` 自身已经不再有 task 模型，但仍保留了对旧 JSON 的兼容判断：

- 如果旧版 planning board JSON 里还带 `tasks`
- 且这些可见 task 全部 `completed`
- 且 board 处于 `inactive`
- 且超过退休延迟
- 则 `loadPlanBoardForSession()` 会自动把它从 session 上解绑

注意：

- 这只是旧数据兼容
- 新版 `PlanBoard` 不再生成这些字段

## 7. 已移除的 legacy 能力

以下能力已经退休：

- `PlanBoard` 内部 task/current-step 追踪
- `taskState.ts`
- `planAttachment.ts`
- `/plan start`
- `plan -> task materialization`
- execution task 的 compact/resume 恢复链路

## 8. 当前非目标

截至目前，以下事项仍不是当前实现目标：

- 在 `plan mode` 下对 task 工具做绝对不可见 / 不可调用的硬封禁
- 多 turn 复用同一 execution `TaskBoard`
- 在 planning 阶段创建 task list
- 从 plan 文本自动抽取 execution tasks
- 通过额外 `TaskCloseBoard` 工具显式结束 board

## 9. 当前进展总结

如果按最初的分阶段计划看，当前状态可以总结为：

- 阶段 1：`SessionMeta` 与 board 语义拆分，已完成
- 阶段 2：独立 execution `TaskBoard`，已完成
- 阶段 3：`TaskCreate / TaskUpdate / TaskList / TaskGet` 重写，已完成
- 阶段 4：turn guard + turn cleanup，已完成
- 阶段 5：execution task 的 compact/resume 清理，已完成
- 阶段 6：prompt / reminder / test 对齐，已完成
- 后续追加清理：`PlanBoard` 彻底去 task 化，已完成

## 10. 最近验证

这轮设计收敛后的关键验证已经通过：

- `npm --prefix dclaw run typecheck`
- 定向单测覆盖：
  - `task-board`
  - `resume`
  - `history`
  - `session`
  - `plan-mode-reminder`
  - `system-prompt`
  - `repl-commands`
  - `plan-mode-tools`

## 11. 文档状态

- 状态：`implemented / current-source-of-truth`
- 含义：
  - 本文档记录的是当前已经落地后的设计结果
  - 后续如果继续改 plan/task 语义，应先更新本文档再推进代码
