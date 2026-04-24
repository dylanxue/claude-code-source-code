# TaskBoard-Centered 设计

## 1. 最新结论

本文件原先讨论把 `PlanRecord` 作为 runtime 一等对象。经过实际会话验证后，这条路线已收敛：

- 不再引入独立 `PlanRecord`
- 不再提供 `PlanCreate / PlanView / PlanUpdate`
- `TaskBoard` 是当前短生命周期工作的唯一 runtime 状态容器
- 长周期计划、技术方案、路线图应落地为项目文档，例如 `TECHNICAL_SPEC.md`、`ROADMAP.md`

新的核心判断是：

```text
TaskBoard = 当前短周期工作现场
Project docs = 长周期计划和方案
Memory = 稳定事实
Transcript = 历史对话
```

`plan mode` 仍保留，但它只是“先规划、别实施”的高约束工作流，不再意味着系统存在一个长期 runtime plan。

## 2. 为什么不保留独立 Plan

独立 `PlanRecord` 看起来能承载计划，但实际会引入几个问题：

1. 它容易变成对话级全局状态，用户频繁切换话题时会干扰当前意图。
2. 它和 `TaskBoard` 都要描述“当前做什么”，语义重叠。
3. 大型长期目标不适合由隐藏 runtime 状态独占，用户需要能在项目文件里看到和编辑。
4. 如果 `TaskBoard` 已经有目的、背景、计划和验证方式，独立 Plan 的价值会大幅下降。

因此，runtime 只维护短期工作现场；长期计划交给用户可见的文档。

## 3. TaskBoard 语义

`TaskBoard` 是当前会话中一个短生命周期的执行面板。它必须同时包含：

- board brief：说明这轮工作为什么存在、打算怎么做
- task list：说明本轮具体要完成哪些可执行任务
- current task / current step：说明当前推进到哪里

建议结构：

```ts
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

  mode: 'inactive' | 'active' | 'enter_requested' | 'exit_requested'
  planFilePath?: string
  currentTaskId?: string
  currentStep?: string
  tasks: TaskRecord[]
}
```

这里的 `plan` 字段不是独立计划对象，只是当前 board 的执行策略摘要。

## 4. 生命周期

当前会话最多只有一个 active `TaskBoard`。

```text
created
  -> tasks in_progress
  -> all tasks completed
  -> inactive / retired
```

当所有可见 task 都进入终止态后，这个 board 应该失效。后续如果出现新的复杂工作，应创建新的 board，而不是无限扩展旧 board。

这意味着：

- task list 默认是短期的
- 大型项目要拆成多个 task board 批次执行
- 每个 task board 对应一轮清晰的工作目标
- 中断恢复只恢复当前未完成 board

## 5. 长周期工作如何处理

长周期工作不依赖 runtime Plan。它应由项目文档承载，例如：

- `TECHNICAL_SPEC.md`
- `IMPLEMENTATION_PLAN.md`
- `ROADMAP.md`
- `TODO.md`

例如“开发人机对战象棋 MVP”可以有一份 `TECHNICAL_SPEC.md`，但每次实际编码只创建短期 task board：

```text
TaskBoard A: 整理技术方案
TaskBoard B: 初始化项目骨架
TaskBoard C: 实现后端核心
TaskBoard D: 实现前端棋盘
```

这样用户可以共同编辑长期计划，agent 只负责当前批次的执行现场。

## 6. Plan Mode

`plan mode` 短期保留为高约束工作流和权限锁：

- 用户明确要求先规划、不要改代码
- 需要只读探索
- 需要只允许编辑 plan file
- 结束时展示计划并等待用户自然语言指令

`ExitPlanMode` 不再表示 approval，也不自动开始实施。它只表示：高约束 planning 阶段结束，计划已展示给用户。

短期实现上，`EnterPlanMode / ExitPlanMode` 继续保留现有工具名以避免破坏兼容，但它们的语义必须收窄为：

```text
EnterPlanMode = 进入 no-implementation planning lock
ExitPlanMode = 解除 no-implementation planning lock，展示 plan file，等待用户下一步
```

它们不创建 Plan，不结束 Plan，也不代表用户批准实施。`EnterPlanMode` 的成功状态使用 `entered`，不能再使用 `approved`。

## 7. Prompt 规则

默认规则：

- 普通问答不创建 task board
- 单步简单任务不创建 task board
- 多步骤复杂工作创建 task board
- 创建复杂 task board 时应填写 board brief
- `plan_only` 请求直接回复计划，不进入 plan mode
- `implementation_with_planning` 请求可以创建 task board 并直接执行
- 长期方案应建议保存为项目文档

`TaskCreate` 是当前主要入口。第一次创建复杂任务时，可带上 board brief：

```json
{
  "subject": "初始化项目结构",
  "description": "创建后端和前端骨架",
  "board": {
    "title": "象棋项目骨架初始化",
    "purpose": "为后续实现准备目录、依赖和启动方式",
    "background": "用户已确认 Vue + REST API + 单机单局",
    "plan": "先建后端 FastAPI，再建前端 Vite，最后补 README",
    "verification": "依赖安装成功，前后端能启动"
  }
}
```

## 8. 当前实现状态

当前已按该方向调整：

- `TaskBoard` 增加 `title / purpose / background / plan / scope / verification`
- `TaskCreate` 支持可选 `board` brief
- 自动创建 board 时不再生成 `PlanRecord`
- `planId` 只作为 legacy 字段迁移时丢弃
- 默认工具注册表不再包含 `PlanCreate / PlanView / PlanUpdate`
- system prompt 从 `Plan-Centered Workflow` 收敛为 `Task-Board Workflow`

后续若需要展示层，可以优先展示 `TaskBoard` brief + tasks，而不是恢复独立 Plan UI。
