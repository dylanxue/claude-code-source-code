# Plan Mode Session Meta Refactor 技术方案

日期：`2026-04-29`

本文档记录下一轮 `dclaw` Plan Mode 语义调整的已确认决策、目标架构和实施任务。它覆盖的是下一步重构目标；当前已落地现状仍以 [plan-task-runtime-split-design.md](./plan-task-runtime-split-design.md) 为准。

## 1. 背景

当前 `dclaw` 已经完成 Plan / Task 双轨拆分：

- `PlanBoard` 是跨 turn 的 planning 容器
- execution `TaskBoard` 是单 turn 的执行批次容器
- plan 内容主要落在 plan file
- compact / resume 会恢复 plan file 和 plan mode reminder

进一步分析 Claude Code 后，确认当前 `dclaw` 的 `PlanBoard` 已经不再承担独立计划对象的职责。一个 session 当前只会 attach 一个 `PlanBoard`，而 `PlanBoard` 中真正关键的内容主要是 session-local Plan Mode runtime state。因此下一步将去除 `PlanBoard`，把关键字段并入 `SessionMeta`。因为项目没有此事，不考虑兼容问题。

## 2. 已确认决策

### 2.1 Plan Mode 状态只能由用户手动切换

`Plan Mode` 的状态切换不允许由 LLM tool call 直接完成。

允许的手动切换入口：

- `/plan`
- `Shift+Tab`

手动进入和退出只改变当前 session 的 `plan mode` 状态，不隐式做其它动作：

- 不创建 execution task
- 不开始实施
- 不自动批准计划
- 不自动放弃计划
- 不自动清空 plan file
- 不弹出计划确认菜单

LLM 不再拥有 `EnterPlanMode` 这类可直接进入 Plan Mode 的工具能力。`ExitPlanMode` 保留，但它不直接修改 Plan Mode 状态；它只用于在计划完成时由 LLM 发起“退出计划确认流程”。

### 2.2 去除 PlanBoard

废除独立 `PlanBoard` runtime object。

保留的信息并入 `SessionMeta`：

- 当前是否处于 Plan Mode
- plan file 路径
- 进入 Plan Mode 前的 permission mode
- Plan Mode reminder 计数
- re-entry / exit reminder flags
- 最近更新时间

废除 PlanBoard 的非关键信息：

- `title`
- `purpose`
- `background`
- `plan`
- `scope`
- `verification`
- `enterRequest`
- `exitRequest`
- `enter_requested`
- `exit_requested`

完整计划内容只以 plan file 为 source of truth。UI 需要 preview 时从 plan file 读取或截取，不再维护一份 PlanBoard summary。

### 2.3 Exit Plan Mode 流程由 LLM 发起，决策由用户交互完成

LLM 完成计划后，应调用 `ExitPlanMode` 发起退出 Plan Mode 的确认流程。这个 tool call 不直接改变 session 的 Plan Mode 状态，而是让 UI 展示当前 plan file 并给出明确选择：

1. **接受并实施**
   - 退出 Plan Mode
   - 保留当前上下文
   - 将 approved plan 注入下一轮模型上下文
   - 开始 implementation flow

2. **接受且新开 context 实现**
   - 退出 Plan Mode
   - 新开或清空上下文
   - 将 approved plan 作为新的 initial user message 注入
   - 开始 implementation flow

3. **保持 Plan Mode 继续完善**
   - 不退出 Plan Mode
   - 保持 permission mode 为 `plan`
   - 用户可补充修改意见
   - LLM 继续完善 plan file

用户手动 `/plan` 或 `Shift+Tab` 退出 Plan Mode 时，不触发上述确认流程；它只是改变状态。上述三选项只属于 LLM 调用 `ExitPlanMode` 后的计划完成确认流程。

本轮决策不提供“放弃方案并退出 Plan Mode”作为 `ExitPlanMode` 确认选项。放弃语义后续如需要，应单独设计为 `/plan abandon` 或菜单中的独立危险操作。

### 2.4 保留现有权限、compact、resume 语义

以下能力保留：

- Plan Mode 下只允许 read-only tool 和 plan file 写入
- compact 后恢复 plan file 内容
- compact 后如果仍在 Plan Mode，强制注入 full Plan Mode reminder
- resume 后如果 session 仍在 Plan Mode，恢复 permission mode 和 plan file path
- re-entry 时提醒模型先评估旧 plan，不盲目沿用
- LLM 发起 `ExitPlanMode` 且用户接受后，注入一次性 Plan Mode exit reminder

## 3. 目标数据结构

### 3.1 SessionMeta

目标结构：

```ts
type PlanModeState = {
  status: 'inactive' | 'active'
  planFilePath?: string
  resumePermissionMode?: PermissionMode
  reminderCount?: number
  lastReminderTurnCount?: number
  hasExitedInSession?: boolean
  needsExitReminder?: boolean
  updatedAt?: string
}

type SessionMeta = {
  sessionId: string
  cwd: string
  mode: SessionMode
  runtimeName?: string
  provider: string
  model?: string
  planMode?: PlanModeState
  taskBoardId?: string
  createdAt: string
  updatedAt: string
  persistedToolResults: SessionPersistedToolResultRecord[]
}
```

不保留 `planBoardId` 兼容字段。项目尚未上线，本轮按全新数据结构直接切换。

### 3.2 Plan File

每个 main session 使用一个 plan file：

```text
{DCLAW_HOME}/plans/plan_{sessionId}.md
```

不支持历史 PlanBoard plan file 迁移。旧开发期数据可以丢弃或由开发者手动清理。

## 4. Runtime 语义

### 4.1 手动进入 Plan Mode

触发方式：

- `/plan` 菜单选择进入
- `Shift+Tab` 切换进入

行为：

1. 确保 session plan file 存在。
2. 记录当前 permission mode 到 `planMode.resumePermissionMode`。
3. 设置 `planMode.status = 'active'`。
4. 设置 runtime permission mode 为 `plan`。
5. 设置 runtime `planFilePath`。
6. 不向 LLM 追加 tool_result。
7. 不要求 LLM 立即响应，除非用户同时输入了新的 prompt。

### 4.2 Plan Mode 中

保持现有语义：

- permission evaluator 拒绝非 read-only、非 plan file 写入的 mutating tool
- system prompt / transient reminder 注入当前 Plan Mode 约束
- plan file 是唯一计划内容来源
- 不允许创建或更新 execution tasks

### 4.3 手动退出 Plan Mode

触发方式：

- `/plan` 菜单选择退出
- `Shift+Tab` 从 Plan Mode 切出

行为：

1. 设置 `planMode.status = 'inactive'`。
2. 恢复 `resumePermissionMode`，默认 `default`。
3. 清空 runtime `planFilePath`。
4. 不展示计划确认菜单。
5. 不注入 approved plan。
6. 不设置 `needsExitReminder`。
7. 不自动开始实施。

### 4.4 LLM 发起 ExitPlanMode 确认流程

触发方式：

- 当前处于 Plan Mode
- LLM 已经完成 plan file
- LLM 调用 `ExitPlanMode`

行为：

1. 读取当前 plan file 内容。
2. UI 展示 plan 内容或 preview。
3. UI 给出三选项：

```text
1. Accept and implement
2. Accept, clear context and implement
3. Keep planning
```

`ExitPlanMode` 本身不直接改变 `SessionMeta.planMode.status`。状态变化只在用户选择确认选项后发生。

#### Accept and implement

行为：

1. 设置 `planMode.status = 'inactive'`。
2. 恢复 `resumePermissionMode`，默认 `default`。
3. 清空 runtime `planFilePath`。
4. 设置 `needsExitReminder = true`。
5. 将 approved plan 注入当前上下文的下一轮模型输入。
6. 用户侧意图应明确为“按批准计划开始实施”。

注入形式建议使用 transient user reminder 或 synthetic user message：

```text
User has approved the plan. You can now start implementation.

Approved Plan:
{plan file content}
```

#### Accept, clear context and implement

行为：

1. 设置 `planMode.status = 'inactive'`。
2. 恢复 `resumePermissionMode`，默认 `default`。
3. 清空 runtime `planFilePath`。
4. 开新 session 或清空当前 engine messages。
5. 将 approved plan 作为新的 initial user message：

```text
Implement the following approved plan:

{plan file content}
```

6. 新上下文不应携带旧 Plan Mode reminder，但可以携带 plan file reference。

#### Keep planning

行为：

1. 保持 `planMode.status = 'active'`。
2. 保持 permission mode 为 `plan`。
3. 不注入 approved plan。
4. 如果用户填写反馈，把反馈作为普通用户消息送给 LLM。
5. LLM 继续读取和更新 plan file。

## 5. Compact / Resume 策略

### 5.1 Compact 时在 Plan Mode 且有 plan file

注入：

- post-compact plan file 内容
- full Plan Mode reminder

语义：

- 模型知道当前仍处于 Plan Mode
- 模型知道 plan file 当前内容
- 模型仍不能实施
- 模型继续完善 plan file，直到 LLM 发起 `ExitPlanMode` 确认流程并由用户接受，或用户手动切出 Plan Mode

### 5.2 Compact 时不在 Plan Mode 但有 plan file

注入：

- post-compact plan file 内容

不注入：

- Plan Mode reminder

语义：

- 模型可把 plan file 作为历史参考
- 模型不会被约束为 Plan Mode

### 5.3 Resume 时 Plan Mode active

行为：

- 读取 `SessionMeta.planMode`
- 恢复 permission mode 为 `plan`
- 恢复 runtime `planFilePath`
- 如 plan file 缺失，从 transcript-only snapshot 或历史 tool result 恢复
- 首轮继续注入 Plan Mode reminder

### 5.4 Resume 时 Plan Mode inactive

行为：

- 不恢复 permission mode 为 `plan`
- 如果 plan file 存在，可在 compact 后作为 plan file reference 恢复
- 不注入 Plan Mode active 约束

## 6. 删除 PlanBoard 体系

### 6.1 废除 tasks/store plan-side API

旧 `src/planboard/*` 中和 PlanBoard 强绑定的 store API 应逐步替换为 session-level plan mode API。

保留或改造的能力：

- plan file ensure/read/write
- plan snapshot append/recover
- observability lines

删除或停止使用的能力：

- `createPlanBoard`
- `loadPlanBoard`
- `updatePlanBoard`
- `attachPlanBoardToSession`
- `loadPlanBoardForSession`
- `PlanBoardBriefPatch`
- `PlanModeRequest`

### 6.2 不做兼容迁移

项目尚未上线，本轮不保留历史 PlanBoard 数据兼容：

- 不读取 `SessionMeta.planBoardId`
- 不读取 legacy `taskBoardId -> PlanBoard` fallback
- 不迁移旧 `task-boards/*.json`
- 不迁移旧 `plan_{boardId}.md`
- 不保留 legacy completed plan-board retire 逻辑

需要清理旧开发数据时，可以直接删除本地 `.dclaw` / `DCLAW_HOME` 下的旧 sessions、task-boards、plans。

## 7. 实施任务拆分

### Phase 1: SessionMeta planMode 数据模型

- [x] 在 `src/session/store.ts` 增加 `PlanModeState` 类型。
- [x] 在 `SessionMeta` 增加 `planMode?: PlanModeState`。
- [x] 删除 `SessionMeta.planBoardId`。
- [x] 增加 session-level helper：
  - `getSessionPlanMode(sessionId)`
  - `updateSessionPlanMode(sessionId, updater)`
  - `ensureSessionPlanFile(sessionId)`
  - `recoverSessionPlanFile(sessionId, messages)`
- [x] 删除旧 `taskBoardId -> PlanBoard` fallback。

### Phase 2: 调整 LLM Plan Mode 工具入口

- [x] 从默认 tool registry 移除 `EnterPlanMode`。
- [x] 保留 `ExitPlanMode`，但改成“发起退出确认流程”，不直接修改 Plan Mode 状态。
- [x] 更新 tool prompt / system prompt，明确 LLM 不能调用工具进入 Plan Mode，也不能绕过用户确认直接实施。
- [x] 更新单测，确保模型可用工具列表不包含 `EnterPlanMode`。
- [x] 更新单测，确保 `ExitPlanMode` 调用后只有用户选择确认项才会退出 Plan Mode。

### Phase 3: `/plan` 与 Shift+Tab 手动切换

- [x] 重做 `/plan` 为交互菜单：
  - 当前非 Plan Mode：进入 Plan Mode
  - 当前 Plan Mode：退出 Plan Mode，但不展示计划确认菜单
  - 查看 plan file
- [x] 为 `ExitPlanMode` permission/confirmation UI 增加三选项：
  - 接受并实施
  - 接受且新开 context 实现
  - 保持 Plan Mode 继续完善
- [x] 为 TUI 增加对应 bottom sheet / dialog。
- [x] 为非 TUI REPL 增加文本选择 fallback。
- [x] 接入 `Shift+Tab` 同样的裸状态切换语义。

### Phase 4: Plan Mode runtime 改为 SessionMeta

- [x] `planModeReminder.ts` 从 `PlanBoard` 改为读取 `SessionMeta.planMode`。
- [x] `postCompactAttachments.ts` 从 `PlanBoard` 改为读取 session plan file。
- [x] `queryEngine.ts` transient context 加载改为 session-level plan mode。
- [x] `cli/runtime.ts` system prompt resolver 改为使用 `SessionMeta.planMode`。
- [x] `cli/resume.ts` 根据 `SessionMeta.planMode.status` 恢复 permission mode 和 plan file path。
- [x] `permissions/evaluator.ts` 保持现有 plan file mutation 规则，但 source 改为 runtime `planFilePath`。

### Phase 5: Plan file 与 snapshot 改造

- [x] 将默认 plan file path 改为 session scoped。
- [x] `planSnapshots.ts` 从 PlanBoard 依赖改为 session plan file 依赖。
- [x] resume 时如果 session plan file 缺失，从：
  - transcript-only plan snapshot
  - 历史 Write/Edit tool_result
  恢复。
- [x] compact 后继续恢复 plan file 内容，并保留现有预算限制。

### Phase 6: 删除 PlanBoard 观测与 UI 依赖

- [x] `session/history.ts` planning summary 改为 session plan mode summary。
- [x] `tasks/observability.ts` 拆分或改名为 plan mode/session observability。
- [x] TUI `PlanModeSnapshot` 改为基于 session plan mode。
- [x] 删除 PlanBoard brief 展示字段。
- [x] 删除或废弃旧 PlanBoard task/current-step 类型字段。

### Phase 7: 测试与验证

- [x] 更新 plan mode tools 测试为 slash/menu/Shift+Tab 裸切换流程测试。
- [x] 增加 “LLM 不可进入 Plan Mode” 测试。
- [x] 增加 “LLM ExitPlanMode 只发起确认，不直接退出” 测试。
- [x] 增加 “Plan Mode active compact 后恢复 plan file + full reminder” 测试。
- [x] 增加 “Plan Mode inactive compact 后只恢复 plan file，不恢复 plan mode” 测试。
- [x] 增加 resume active/inactive Plan Mode 测试。
- [x] 跑：
  - `npm run typecheck`
  - targeted unit tests
  - full unit tests

## 8. 风险与注意事项

- 退出 Plan Mode 的 “接受并实施” 会改变当前语义：从 “展示计划并等待自然语言下一步” 改为明确 implementation transition。需要确保这只发生在用户菜单选择后。
- 移除 `EnterPlanMode` 会改变模型可见工具集合，相关 prompt 和测试必须同步更新。
- `ExitPlanMode` 从“直接退出工具”改为“确认流程触发工具”，需要避免 tool_result 提前把 session 标记为已退出。
- 不做兼容迁移会破坏旧开发期 session 的 PlanBoard 恢复；这是本轮接受的取舍。
- plan file 是 source of truth，不能再把 plan summary 当作权威计划注入。
- clear context implement 分支要确保不会丢失 approved plan。

## 9. 完成标准

本轮重构完成后，应满足：

- 新 session 不再创建 PlanBoard。
- `SessionMeta.planMode` 是 Plan Mode runtime 状态唯一来源。
- `SessionMeta` 不再包含 `planBoardId`。
- LLM 工具列表中没有可进入 Plan Mode 的工具。
- `ExitPlanMode` 只能发起用户确认流程，不能直接切换状态。
- `/plan` 和 `Shift+Tab` 是手动 Plan Mode 裸切换入口。
- LLM 完成计划后的实施转换必须经过用户三选项。
- compact / resume 的 Plan Mode 和 plan file 恢复能力不退化。
- execution `TaskBoard` 继续保持单 turn 执行批次语义，不参与 planning。
