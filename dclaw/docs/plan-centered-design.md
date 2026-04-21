# Plan-Centered 设计

## 1. 目标

这份文档定义 `dclaw` 在 plan / task 体系上的下一阶段方向：

- `plan` 是一等公民
- `plan mode` 不是一等公民
- 系统围绕 `plan` 组织复杂任务生命周期，而不是围绕 `plan mode` 组织会话阶段

这份设计不是否定当前阶段 9 已落地的 `plan mode + plan file + Task*` 主链路，而是要把它从“默认规划入口”收缩为“可选的高约束工作流”，同时保留其在高风险任务中的价值。

一句话总结：

- 旧模型：`plan = plan mode 的产物`
- 新模型：`plan = 长任务真值；plan mode = 某些场景下的 workflow policy`

## 2. 问题定义

当前 `dclaw` 的设计已经较好对齐 Claude Code 当前主路径，但它也继承了几个明显问题：

1. 用户只想要一个计划时，系统容易误入 `plan mode`
2. 一旦进入 `plan mode`，计划交付天然绑定“退出 planning 并开始实施”
3. `plan` 的生命周期被 `plan mode` 绑定得过紧，规划与执行难以自然交织
4. 对复杂 coding 任务而言，真正需要长期持有的是：
   - spec / approach
   - task list
   - current task / current step
   - progress / verification / risk
   而不是“当前是否处于一个特殊 planning mode”

这些问题在“只问方案、不准备实施”的场景下最明显，但在长任务中同样会造成状态模型过重、交互不自然、难以和外部 spec/task 工具协作。

## 3. 设计结论

### 3.1 核心判断

`dclaw` 未来应采用 **plan-centered, not mode-centered** 的状态模型。

具体来说：

- `plan` 是任务真值
- `task board` 是 `plan` 的执行面板
- `approval` 是围绕关键节点的控制能力
- `plan mode` 只是 workflow policy，不再是 planning 的默认宿主

### 3.2 产品语义变化

新的默认语义应是：

- 用户问“计划怎么做”：
  - 直接产出或更新 `plan`
  - 不自动进入 `plan mode`
- 用户问“开始做这个任务”：
  - 可以直接执行
  - 执行过程中持续维护 `plan` 与 `task list`
- 用户问“先规划，别动代码”：
  - 进入 `plan mode`
  - 使用只读探索 + 计划审批流

因此，系统默认路径从：

`EnterPlanMode -> plan file -> ExitPlanMode -> implementation`

切换为：

`PlanCreate/Update -> Task execution -> Approval when needed`

## 4. 设计原则

### 4.1 Plan 是真值，不是聊天附属物

`plan` 必须作为结构化任务对象存在，而不是散落在 transcript 里的普通文本，也不是只在 `plan mode` 内短暂存在的产物。

### 4.2 Execution 围绕 Plan 推进

任务执行的核心状态都应该挂到同一条 `plan` 主线上，包括：

- task list
- current task
- current step
- progress
- verification
- decisions / risks / deviations

### 4.3 Plan Mode 是特例，不是默认

`plan mode` 只适用于高约束场景：

- 用户明确要求“先规划，别执行”
- 需要正式批准后再开工
- 高风险或大范围改动
- 需要只读探索阶段来阻止代理过早执行

### 4.4 规划与执行允许交织

复杂任务往往不是“先完整规划一次，然后只执行”。真实工作流更常见的是：

1. 形成粗 plan
2. 进入执行
3. 发现新信息
4. 回写 plan / task list
5. 继续推进

系统应把这种行为视为主路径，而不是异常。

### 4.5 审批与计划解耦

“交付计划”和“批准实施”是两件事：

- 可以交付 plan 但不进入 implementation
- 可以继续执行但不需要每次重新审批
- approval 应绑定到高风险节点，而不是默认绑定到所有 planning 流程

## 5. 关键概念

### 5.1 Plan

`plan` 是复杂任务的结构化真值，至少包含：

- `goal`
- `context`
- `scope`
- `approach`
- `files`
- `verification`
- `tasks`
- `current focus`

`plan` 可以有 markdown file 表示，但 markdown file 只是其可读载体，不应再隐含“只有在 plan mode 才有效”的语义。

### 5.2 Task Board

`task board` 是 `plan` 的执行视图，用来展示和更新：

- task 列表
- 当前 task
- 当前 step
- 任务状态
- 执行进度

它不再主要回答“当前是否处于 plan mode”，而是回答“当前 plan 正执行到哪里”。

### 5.3 Approval

`approval` 是一个独立能力，用于在关键节点请求用户明确确认，例如：

- 开始高风险实施
- 执行 destructive action
- 采用重大替代方案
- 将草案 plan 升格为 approved plan

### 5.4 Plan Mode

`plan mode` 是一种可选 workflow policy，特征是：

- 只读探索
- plan-file-only write
- 明确禁止实施
- 结束时可以请求 approval

它应被保留，但从核心状态模型中降级。

## 6. 目标用户体验

### 6.1 Plan-only 请求

用户说：

- “如果要做这个，你的计划是什么？”
- “先给我个方案”
- “只讨论思路，不要开工”

系统应：

1. 直接生成或更新 `plan`
2. 在对话中展示 plan 摘要
3. 不自动进入 `plan mode`
4. 不自动创建“批准后开始实施”的闸门

### 6.2 默认复杂任务执行

用户说：

- “把这个功能做完”
- “继续上次那个重构”
- “把登录链路理顺”

系统应：

1. 查找当前 plan 或创建新 plan
2. 建立或更新 task list
3. 进入执行
4. 持续更新 current task / current step / verification
5. 在必要时请求 approval

### 6.3 高约束 planning

用户说：

- “先规划，别写代码”
- “先出一个可审批的方案”
- “先做调研和设计，等我批准再开工”

系统应：

1. 进入 `plan mode`
2. 只读探索
3. 持续更新 plan
4. 最后请求 approval 或继续 planning

## 7. 状态模型

### 7.1 新的中心对象

建议引入或显式收敛到以下对象：

```ts
type Plan = {
  planId: string
  workspaceId: string
  rootSessionId: string
  status: 'draft' | 'active' | 'approved' | 'superseded' | 'completed'
  title: string
  summary?: string
  goal: string
  context?: string
  scope?: string
  approach?: string
  verification?: string
  planFilePath?: string
  createdAt: string
  updatedAt: string
}
```

```ts
type PlanExecutionBoard = {
  boardId: string
  planId: string
  workspaceId: string
  latestSessionId: string
  currentTaskId?: string
  currentStep?: string
  mode?: 'default' | 'plan'
  createdAt: string
  updatedAt: string
  tasks: TaskRecord[]
}
```

```ts
type ApprovalRecord = {
  approvalId: string
  planId?: string
  boardId?: string
  kind:
    | 'plan_review'
    | 'start_implementation'
    | 'high_risk_change'
    | 'destructive_action'
  status: 'pending' | 'approved' | 'rejected'
  summary: string
  createdAt: string
  resolvedAt?: string
}
```

### 7.2 旧状态的处理

当前 `TaskBoard.mode` 中的：

- `inactive`
- `active`
- `enter_requested`
- `exit_requested`

本质上混合了两类语义：

1. 当前是否在 `plan mode`
2. 当前 plan / board 的执行状态

后续应拆开：

- `mode`：只表示 workflow policy
- `plan.status`：表示计划生命周期
- `approval.status`：表示当前审批节点

### 7.3 推荐的 plan 生命周期

```text
draft
  -> active
  -> approved
  -> completed
```

补充：

- `draft`：草案计划，还未成为当前主计划
- `active`：当前正在消费和更新的计划
- `approved`：已通过一次明确审阅或签发
- `completed`：任务完成
- `superseded`：已被新计划替代

`plan mode` 不再直接决定这些状态。

## 8. Workflow 设计

### 8.1 默认工作流

```text
用户提出任务
  -> 查找或创建 plan
  -> 形成初版 task list
  -> 执行
  -> 持续更新 plan / task / current step
  -> 验证
  -> 完成
```

### 8.2 Plan-only 工作流

```text
用户请求方案
  -> 创建或更新 plan
  -> 输出 plan 摘要
  -> 结束
```

不会出现：

- 自动进入 `plan mode`
- 自动请求“批准开始实施”
- 自动物化执行态 task list 并进入 `in_progress`

### 8.3 High-constraint Plan Mode 工作流

```text
用户要求严格 planning
  -> EnterPlanMode
  -> 只读探索
  -> 更新 plan
  -> ApprovalRequest
  -> 批准后退出 plan mode
  -> 回到默认执行流
```

### 8.4 执行中回写规划

```text
执行中发现新信息
  -> 更新 plan
  -> 调整 task list
  -> 必要时请求 approval
  -> 继续执行
```

这里不需要重新进入 `plan mode`，除非用户要求重新回到只读规划阶段。

## 9. Prompt 与 Tool 设计调整

### 9.1 Prompt 总体策略

当前 prompt 中对 planning 的感知过度依赖“当前是不是 plan mode”。后续应改为：

1. 永远注入当前 `plan` 摘要
2. 永远注入当前 `task board` 摘要
3. 仅当 `mode === plan` 时，再额外注入只读约束

也就是说：

- `plan context` 是常驻的
- `plan mode constraint` 是条件注入的

### 9.2 Tool 职责重划

建议逐步收敛到以下职责分层：

- `PlanCreate / PlanUpdate / PlanView`
  - 负责计划创建与维护
- `TaskCreate / TaskList / TaskGet / TaskUpdate`
  - 负责执行面板
- `ApprovalRequest`
  - 负责审批节点
- `EnterPlanMode / ExitPlanMode`
  - 负责高约束 planning workflow

### 9.3 ExitPlanMode 的定位变化

当前 `ExitPlanMode` 同时承担：

1. 计划完成
2. 请求批准
3. 进入实施
4. 从 approved plan 自动 materialize tasks

这四件事耦合过重，后续应拆开。

推荐语义：

- `ExitPlanMode`
  - 仅表示离开高约束 planning workflow
- `ApprovalRequest(kind=plan_review | start_implementation)`
  - 负责真正的审批
- `MaterializeTasksFromPlan`
  - 负责从 plan 生成首版执行任务

### 9.4 意图分流

系统应引入最小意图分流，至少识别：

- `plan_only`
- `implementation`
- `high_constraint_planning`

这个分流不需要一开始做成复杂 classifier，但必须能影响：

- prompt 注入
- 是否鼓励模型调用 `EnterPlanMode`
- 是否在交付 plan 后继续推动执行

## 10. 持久化与恢复

### 10.1 持久化目标

复杂任务的恢复应依赖以下真值：

- 当前 `plan`
- 当前 `board`
- 当前 `task list`
- 当前 `current task / current step`
- 最近 approval 结果

而不是只依赖 transcript 或 `plan mode` 状态。

### 10.2 Plan File 的定位

`plan file` 继续保留，原因有三：

1. 可读
2. 可编辑
3. 适合向用户展示完整方案

但语义应改成：

- `plan file` 是 `plan` 的可读载体
- 不再天然意味着“当前一定处于 plan mode”

### 10.3 Compact / Resume

compact / resume 后，系统应始终能恢复：

- 当前 active plan
- 当前 task board
- 当前 current focus

只有当 `mode === plan` 时，才继续补充 plan-mode reminder。

## 11. 迁移方案

### Phase A：先改 prompt 与意图

目标：

- “给我一个计划”不再默认进入 `plan mode`

动作：

- 在 runtime prompt 中注入 plan-only 与 implementation 的语义边界
- 调整 `EnterPlanMode` prompt，使其从默认建议收缩为高约束建议

### Phase B：拆 approval

目标：

- 允许“交付计划但不开始实施”

动作：

- 将 approval 从 `ExitPlanMode` 语义中拆出
- 支持 `plan review` 与 `start implementation` 两类审批

### Phase C：重塑 task board

目标：

- 让 board 成为 plan 的执行面板，而不是 plan mode 的附属物

动作：

- 引入 `planId`
- 调整 board 的中心语义
- 让 task / current step 成为常驻状态，而非 plan mode 特权

### Phase D：逐步收缩 Plan Mode

目标：

- 没有 `plan mode` 时，系统也能完整工作
- 有 `plan mode` 时，只是在高约束场景下提供额外保护

## 12. 与现有实现的兼容策略

### 12.1 保留已有资产

以下能力应保留：

- plan file
- `Task*`
- compact / resume 恢复
- runtime reminder 基础设施
- `EnterPlanMode / ExitPlanMode`

### 12.2 重解释已有能力

以下能力需要调整定位：

- `plan mode`
  - 从默认 planning 主路径降级为特例
- `task board`
  - 从 mode 容器改为 execution board
- `ExitPlanMode`
  - 从“计划完成 + 批准开工”收缩为“离开高约束 planning”

### 12.3 避免一次性推翻

不建议直接删除当前 `plan mode` 主线。推荐做法是：

1. 先让系统在没有 `plan mode` 的情况下也能完整维护 `plan`
2. 再把 `plan mode` 逐步收缩到少数场景

## 13. 测试与验证

### 13.1 产品语义测试

应新增这些测试场景：

1. 用户只要计划
   - 产出 `plan`
   - 不进入 `plan mode`
   - 不请求批准开工

2. 用户直接要实现
   - 创建或恢复 `plan`
   - 进入执行
   - `task list` 持续更新

3. 用户明确要求先规划
   - 进入 `plan mode`
   - 只读探索
   - 需要 approval 后再开工

4. 执行中发现新信息
   - 更新 `plan`
   - 调整 `task list`
   - 不必强制重新进入 `plan mode`

### 13.2 恢复语义测试

应验证：

- compact 后能恢复 active plan
- resume 后能恢复 current focus
- 只有在 `mode === plan` 时才继续出现 planning-only 提醒

## 14. 非目标

本设计当前不追求：

- 项目级多 plan 总览
- 完整项目管理系统
- 跨 workspace 聚合
- 自动生成复杂 dependency graph
- 替代外部 spec/task 工具

本设计的重点是：

- 让 `dclaw` 内部状态模型与复杂 coding 工作更匹配
- 保留 Claude Code 式高约束 planning 能力
- 同时解决“只想要计划却被带入 plan-mode 审批流”的问题

## 15. 最终结论

`dclaw` 下一阶段不应继续强化“`plan mode` 是 planning 的宿主”这条路线，而应明确收敛到：

- `plan` 是一等公民
- `task board` 是 plan 的执行面板
- `approval` 是独立能力
- `plan mode` 是可选 workflow

当系统做到这一点时：

- 复杂任务有稳定真值
- 用户意图更容易对齐
- 规划与执行可以自然交织
- 现有 `plan mode` 仍然保留价值，但不再主导整个产品语义
