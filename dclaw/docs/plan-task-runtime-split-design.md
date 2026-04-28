# Plan / Task Runtime Split 设计稿

## 1. 文档目的

这份文档用于固化当前已经确认的 `plan` / `Plan mode` / `task board` / `task list` 语义收敛结果，并作为后续实现的唯一方案记录。

本文档重点回答 3 件事：

1. `plan` 和 `task` 在 runtime 上应该如何拆分
2. `task list` 的创建、执行、终止语义应该是什么
3. 后续代码改造的任务清单和顺序是什么

## 2. 当前结论

经过多轮 review，当前已经确认以下高优先级结论：

### 2.1 总体方向

- 选择 **PlanBoard / TaskBoard 双轨拆分**
- 不再让同一个 board 同时承载 planning 状态和 execution 状态
- `PlanBoard` 与 `TaskBoard` 的生命周期、用途、恢复策略全部不同

### 2.2 Plan 侧语义

- `plan` 和 `Plan mode` 只用于创建计划
- 单纯 planning 阶段不创建任何 task
- `EnterPlanMode / ExitPlanMode` 只服务 planning lock，不服务 task tracking
- `PlanBoard` 可以跨 turn 持续存在
- `PlanBoard` 继续参与 `compact / resume / plan reminder / plan file` 相关链路

### 2.3 Task 侧语义

- `task board` 不是 session 创建时就创建
- `TaskBoard` 只在真正执行时创建
- `TaskCreate` 是 `TaskBoard` 的唯一创建入口
- `TaskBoard` 与 `PlanBoard` 无关，不复用 plan 侧状态
- `TaskBoard` / `task list` 的有效期只有当前一轮 turn
- 当前 turn 结束时，`TaskBoard` 必须终止并从 session 上解绑
- 因为 `TaskBoard` 只活一轮，所以不需要在 `compact / resume` 中做特殊恢复

### 2.4 TaskCreate 语义

- `TaskCreate` 只保留 `tasks[]`
- 彻底删除单任务创建形态
- `TaskCreate.tasks[]` 至少为 `3` 条
- 小于 `3` 条时，不应使用 task 工具
- `TaskCreate` 成功时自动开始执行
- 第 `1` 条任务自动置为 `in_progress`
- 每一轮执行批次都创建一个 fresh `TaskBoard`
- 不继续复用旧 board

### 2.5 TaskUpdate / 状态语义

- 新增终止态 `cancelled`
- 不新增 `TaskCloseBoard`
- board 关闭和任务终止通过 `TaskUpdate + runtime cleanup` 完成
- 同一时刻只允许一个 `in_progress`
- 如果当前已有任务处于 `in_progress`，再尝试将另一条任务置为 `in_progress` 时，直接返回 error
- 不自动切走当前进行中的任务

### 2.6 Turn 结束语义

- `AskUserQuestion` / permission 本身不会天然结束 turn
- 它们只是 turn 内交互
- 只有当前 turn **真正结束** 时，才关闭当前 `TaskBoard`
- turn 结束时：
  - 所有未完成的 `pending / in_progress` 任务统一改成 `cancelled`
  - `TaskBoard` 标记终止
  - `TaskBoard` 从 session detach
- 如果还要继续原工作，下一轮重新创建 fresh `TaskBoard`

### 2.7 Turn 中断与对话交接

- active `TaskBoard` 存在且仍有未终止任务时，不应允许普通聊天式结束当前 turn
- 需要由 runtime `pre-end guard` 先拦截一次
- 允许 turn 结束的豁免条件只看 **最终是否真的把控制权交还给用户**
- 不看“本轮是否中途调用过 AskUserQuestion / permission”

允许结束的典型情况：

- `AskUserQuestion` 最终进入“回到对话继续说明”
- permission 被拒绝，当前工作必须等待用户处理
- 系统级中断，例如：
  - user abort
  - llm error
  - max iterations

不允许结束的典型情况：

- `AskUserQuestion` 收到普通答案后还能继续执行
- permission 已被批准
- 只是做了一半任务后想切回普通解释或总结

## 3. 目标架构

新的 runtime 结构如下：

```text
PlanBoard
  -> 只服务 planning lock / plan file / plan reminder / compact / resume

TaskBoard
  -> 只服务 TaskCreate / TaskList / TaskGet / TaskUpdate
  -> 只活当前 turn
  -> turn end cleanup 后立即 detach
```

建议的高层关系：

```text
SessionMeta
  - planBoardId?
  - taskBoardId?

PlanBoard
  - 跨 turn
  - 与 plan file 绑定

TaskBoard
  - 单 turn
  - 与 execution batch 绑定
```

## 4. 数据模型设计

## 4.1 SessionMeta

当前 `SessionMeta` 只有一个 `taskBoardId`。后续改为：

```ts
type SessionMeta = {
  sessionId: string
  cwd: string
  mode: SessionMode
  runtimeName?: string
  provider: string
  model?: string
  planBoardId?: string
  taskBoardId?: string
  createdAt: string
  updatedAt: string
  persistedToolResults: SessionPersistedToolResultRecord[]
}
```

兼容策略：

- 读取老数据时，保留对旧 `taskBoardId` 的兼容
- 旧字段在迁移阶段视为 `planBoardId` 还是 `taskBoardId`，由实际 board 类型判断

## 4.2 PlanBoard

当前 `dclaw/src/tasks/types.ts` 里的 board 结构，后续应收敛为 `PlanBoard`。

它继续承载：

- `planFilePath`
- `mode`
- `resumePermissionMode`
- `enterRequest / exitRequest`
- plan-mode reminder 所需字段

它不再承载 execution-only 的 `TaskBoard` 语义。

## 4.3 TaskBoard

新增独立执行态模型，建议最小结构如下：

```ts
type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'cancelled'

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

- `TaskBoard` 不再有 `planFilePath`
- `TaskBoard` 不再有 `mode: active/inactive/enter_requested/exit_requested`
- `TaskBoard` 不再有 `resumePermissionMode`
- `TaskBoard` 只表达 execution batch

## 5. Runtime 语义

## 5.1 TaskCreate

`TaskCreate` 后续语义：

- 只接受 `tasks[]`
- `tasks.length >= 3`
- 创建 fresh `TaskBoard`
- 同时创建所有 task
- 自动将第 `1` 条置为 `in_progress`
- 设置：
  - `executionState = active`
  - `currentTaskId = firstTask.id`
  - `currentStep = firstTask.activeForm ?? firstTask.subject`

同时要删除当前语义中的两类行为：

- 单任务创建
- “已有任务数 + 新增任务数 >= 3 即可”的拼接逻辑

## 5.2 TaskUpdate

`TaskUpdate` 后续语义：

- 支持 `cancelled`
- 同一时刻只允许一条 `in_progress`
- 若已有其它 `in_progress` 任务，再尝试设置新任务为 `in_progress`，直接返回 error
- 某任务进入终止态时，同步维护：
  - `currentTaskId`
  - `currentStep`
  - `executionState`

状态维护规则：

- 还有 `pending / in_progress` -> `executionState = active`
- 全部为 `completed` -> `executionState = completed`
- 全部为终止态且存在 `cancelled` -> `executionState = cancelled`

## 5.3 Turn 内 guard

在 query loop 中新增 `pre-end guard`：

- 当 assistant 本轮准备以普通文本结束 turn 时
- 若当前 attached `TaskBoard` 仍处于 `active`
- 且还存在未终止任务
- 且当前 turn 没有命中“最终交接给用户”的豁免条件
- 则不能直接结束 turn

预期行为：

- 注入 repair reminder
- 要求模型继续推进当前 task list
- 继续下一次 iteration

## 5.4 Turn 结束 cleanup

当 turn 真正结束时，统一做 `TaskBoard` cleanup：

- 若所有任务已 `completed`
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
- 将 `taskBoardId` 从 session meta 上解绑

注意：

- 正常路径要 cleanup
- `QueryLoopAbortError` 路径也要 cleanup
- `QueryLoopLlmError` 路径也要 cleanup

## 6. Compact / Resume 策略

`PlanBoard`：

- 继续参与 `compact / resume`
- 继续保留 plan file 恢复与 reminder 注入

`TaskBoard`：

- 不参与 `compact` 恢复
- 不参与 `resume` 恢复
- 不需要 post-compact task attachment
- 不需要 post-compact task reminder carry-over

这意味着后续需要移除 execution-task 相关的特殊处理：

- `Post-Compact Task Board`
- task reminder 的 compact carry-over
- resume 时的 task board 恢复展示

## 7. 非目标与暂缓项

本轮方案明确不做：

- 新增 `TaskCloseBoard`
- 多轮复用同一个 `TaskBoard`
- 在 planning 阶段创建 task list
- 让 task board 参与 compact / resume 的跨 turn恢复
- 自动从 plan 文本反向抽取 execution tasks

本轮暂不在本文档中强行锁死的事项：

- 是否在 `plan mode` 下对 task 工具做绝对不可见 / 不可调用硬封禁

该问题后续可以单独 review，但不影响当前 PlanBoard / TaskBoard 拆分主线。

## 8. 受影响模块

## 8.1 主要新增模块

建议新增：

- `dclaw/src/taskboard/types.ts`
- `dclaw/src/taskboard/store.ts`
- `dclaw/src/taskboard/turnCleanup.ts`

## 8.2 主要改造模块

Plan 侧：

- `dclaw/src/session/store.ts`
- `dclaw/src/tools/builtin/enterPlanMode.ts`
- `dclaw/src/tools/builtin/exitPlanMode.ts`
- `dclaw/src/core/planModeReminder.ts`
- `dclaw/src/tasks/planAttachment.ts`
- `dclaw/src/core/postCompactAttachments.ts`
- `dclaw/src/cli/resume.ts`

Task 侧：

- `dclaw/src/tools/builtin/taskCreate.ts`
- `dclaw/src/tools/builtin/taskUpdate.ts`
- `dclaw/src/tools/builtin/taskList.ts`
- `dclaw/src/tools/builtin/taskGet.ts`
- `dclaw/src/core/queryLoop.ts`
- `dclaw/src/core/queryEngine.ts`
- `dclaw/src/core/taskToolReminder.ts`
- `dclaw/src/types/tool.ts`

## 9. 实施任务清单

以下任务清单按推荐实施顺序排列。

### 阶段 1：拆 session 与 board 语义

1. `SessionMeta` 拆成 `planBoardId` 和 `taskBoardId`
2. 为老 session metadata 增加兼容读取逻辑
3. 将现有 board 结构明确收口为 `PlanBoard`

### 阶段 2：新增独立 TaskBoard

1. 新增 `TaskBoard` 类型与 store
2. 新增 fresh execution board 创建函数
3. 新增 turn-end cleanup helper
4. 新增只读查询函数，用于 query loop / query engine 判断是否存在 active execution batch

### 阶段 3：重写 TaskCreate / TaskUpdate / TaskList / TaskGet

1. `TaskCreate` 删除单任务输入
2. `TaskCreate` schema / parser / validate 统一为 `tasks[] >= 3`
3. `TaskCreate` 成功时自动将第一条任务置为 `in_progress`
4. `TaskUpdate` 增加 `cancelled`
5. `TaskUpdate` 增加“已有 in_progress 时返回 error”的校验
6. `TaskList` / `TaskGet` 输出 schema 对齐 `cancelled`

### 阶段 4：加入 turn 级约束

1. 在 `queryLoop` 增加 `pre-end guard`
2. 在 `queryEngine` 正常路径加入 task cleanup
3. 在 `queryEngine` 异常路径加入 task cleanup
4. 为“最终交接给用户”的情况增加明确 runtime 标记

### 阶段 5：清理 compact / resume 特殊处理

1. 移除 `TaskBoard` 的 post-compact attachment
2. 移除 `TaskBoard` 的 compact task reminder carry-over
3. 移除 resume 时的 execution-task board 恢复展示
4. 保留 `PlanBoard` 侧 compact / resume 链路

### 阶段 6：对齐 prompt / reminder / test

1. `taskCreatePrompt` 对齐新语义
2. `taskUpdatePrompt` 对齐新语义
3. `taskListPrompt` 对齐新语义
4. `taskToolReminder` 从“泛化提醒用 task 工具”改为“继续当前 active batch”
5. 更新或重写相关单元测试

## 10. 测试清单

至少补齐以下覆盖：

1. `TaskCreate` 不再接受单任务形态
2. `TaskCreate` 2 条任务时报错
3. `TaskCreate` 3 条任务成功并自动启动第 1 条
4. active execution board 存在时再次 `TaskCreate` 的行为符合设计
5. 已有 `in_progress` 时再开另一条 `in_progress` 返回 error
6. active board 未完成时，普通聊天式结束被 `pre-end guard` 拦住
7. `AskUserQuestion` 普通回答后继续执行，不允许直接收尾
8. `AskUserQuestion` 最终进入用户对话交接时，允许结束并 cleanup
9. permission denied 时允许结束并 cleanup
10. 正常 turn 结束时 unfinished -> `cancelled`
11. `abort / llm error / max iterations` 路径也会 cleanup
12. compact / resume 不再恢复 execution `TaskBoard`

## 11. 实施策略

推荐采用 **渐进拆分**，而不是第一步就大规模搬文件：

- 先完成逻辑拆分
- 再做目录和命名上的长期收口

原因：

- 改动面更可控
- 便于逐阶段验证行为
- 可以降低一次性重命名造成的回归风险

## 12. 本文档状态

- 状态：`reviewed / approved for implementation planning`
- 含义：
  - 本文档记录的是当前已经达成一致的方案决策
  - 允许据此继续拆分实现任务
  - 具体代码修改仍可按阶段逐项落地与回归验证
