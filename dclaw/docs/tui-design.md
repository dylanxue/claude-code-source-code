# DCLAW TUI 设计文档

## 1. 目标

本文档定义 `dclaw` 的新一代终端交互界面（TUI）设计，目标是：

- 在交互体验上尽量接近 `Codex` 当前 TUI 风格
- 在技术实现上采用 `Ink + React`
- 保持 `dclaw` 现有 `QueryEngine / session / tools / permissions / plan-task` 主链路不变
- 将当前线性 `readline + stdout` REPL 升级为“事件驱动 + 全屏渲染”的终端界面
- 让消息区、底部输入区、阻塞式交互三者分层清晰

本文档聚焦 UI 运行时，不重新设计 agent 核心能力。

## 2. 设计原则

### 2.1 总原则

`非阻塞信息进入消息流，用户输入进入底部，阻塞式决策进入浮层。`

### 2.2 体验原则

1. 主界面本质上是一条不断向下生长的工作时间线，而不是聊天气泡墙。
2. 用户的大部分注意力应停留在消息流和底部输入区，不依赖侧栏。
3. 输入、轻量选择、命令建议尽量停留在底部 dock 内完成。
4. 只有必须由用户立刻决策的内容才弹出阻塞式浮层。
5. 任务状态变化时展示“完整任务表快照”，而不是只展示增量日志。

### 2.3 工程原则

1. 保留现有 `QueryEngine`、`tool`、`permission`、`session` 语义。
2. 将“事件生产”和“文本渲染”拆开，避免继续把 TUI 逻辑写死在 `stdout` 输出里。
3. 新 TUI 与当前 `interactive/headless/print` 模式共享同一套核心事件。
4. 优先支持键盘交互，不依赖鼠标。

## 2.4 技术选型

首版 TUI 框架明确采用：

- `Ink`
- `React`

理由如下：

1. `dclaw` 的目标不是只渲染静态文本，而是要稳定承载输入框、滚动消息流、建议菜单、bottom sheet、dialog、焦点切换与流式更新。
2. 这类状态管理如果继续基于 `readline + ANSI` 直接拼装，短期可行，但中期很容易变成不可维护的状态机堆叠。
3. `Ink + React` 更适合承载我们这里定义的三层结构：`Transcript / Bottom Dock / Overlay`。
4. `dclaw` 当前就是 `Node + TypeScript` 项目，采用 `Ink + React` 不会引入新的语言栈切换成本。

明确不采用的方向：

- 继续基于当前 `readline` 直接堆复杂 UI
- 自行维护低层 ANSI 布局系统作为首版主路径
- 为首版 TUI 单独引入更重的终端窗口管理框架

## 3. 非目标

当前设计不包含：

- 常驻右侧任务栏
- 顶部长期状态栏
- 复杂 dashboard
- 聊天气泡式角色头像体系
- 图形化窗口管理

这些能力可以后续补充，但不应影响首版 TUI 主路径。

## 4. 总体信息架构

整个 TUI 固定为 3 层：

1. `Transcript`
   向下无限延展的主时间线，是唯一主舞台。
2. `Bottom Dock`
   固定底部，承载输入、命令建议、轻量选择、当前运行上下文。
3. `Overlay`
   只处理阻塞式决策与需要用户确认的结构化交互。

### 4.1 结构示意

```text
+--------------------------------------------------------------+
|                                                              |
|  Transcript                                                  |
|  - user prompt band                                          |
|  - assistant prose                                           |
|  - activity group                                            |
|  - structured card                                           |
|  - task snapshot                                             |
|                                                              |
+--------------------------------------------------------------+
|  Bottom Dock                                                 |
|  [ › Ask DCLAW or type / for commands                    ]   |
|  gpt-5.4 xhigh · default · ~/work/dclaw                      |
+--------------------------------------------------------------+
|  Overlay / Bottom Sheet / Dialog (when needed)               |
+--------------------------------------------------------------+
```

## 5. Transcript 设计

## 5.1 定义

`Transcript` 不是聊天消息列表，而是一份不断向下生长的工作文档。

它承载：

- 对话请求
- 助手过程说明
- 工具活动归并结果
- 结构化状态输出
- 任务列表快照
- 回合耗时与系统提示

### 5.2 核心规则

1. 凡是不要求用户立刻选择的内容，都进入 `Transcript`。
2. 进入 `Transcript` 不等于都渲染成同一种文本块。
3. Transcript 内至少支持“段落 / 活动分组 / 卡片 / 任务快照 / 分隔线”几种不同视觉语法。
4. Transcript 默认自动跟随底部。
5. 当用户手动向上滚动时，暂停自动跟随；回到底部后恢复。

## 5.3 Transcript Item 类型

建议首版支持 8 类块：

1. `tip_banner`
2. `user_prompt_band`
3. `user_command_inline`
4. `assistant_note`
5. `activity_group`
6. `structured_card`
7. `task_list_snapshot`
8. `time_separator`

下面逐一说明。

### 5.3.1 `tip_banner`

用于展示顶部提示、版本提示、功能提示。

示例：

```text
Tip: GPT-5.5 is now available in Codex...
```

规则：

- 使用普通文档流，不需要边框
- 字级略小于正文或保持与正文一致
- 不参与 turn 聚合

### 5.3.2 `user_prompt_band`

普通用户输入渲染为一整行浅灰背景条。

示例：

```text
› 好的继续
```

规则：

- 左侧固定轻量前导符，建议用 `›`
- 整行浅灰背景
- 不显示头像
- 仅用于普通 prompt，不用于 slash 命令

### 5.3.3 `user_command_inline`

slash 命令不走灰条，而是单独高亮成一行。

示例：

```text
/status
```

规则：

- 用强调色渲染
- 原样显示命令文本
- 与普通 prompt 明确区分

### 5.3.4 `assistant_note`

助手正文、commentary、解释、结论，都显示为“文档段落块”。

示例：

```text
• 我继续把方案落到文件级别，给你一版能直接拆实现任务的改造蓝图。
```

规则：

- 左侧使用圆点前导 `•`
- 不加聊天 bubble
- 保留 markdown 列表与段落结构
- 同一轮中的 prose 应尽量连续，不要被细碎日志打断

### 5.3.5 `activity_group`

工具活动不直接刷原始事件，而是聚合成语义分组。

示例：

```text
• Explored
  └ Read repl.ts, loop.tsx, controller.ts
  └ Search writeOutput\(
```

首版建议支持的组名：

- `Explored`
- `Edited`
- `Ran`
- `Checked`
- `Planned`
- `Delegated`

建议映射：

- `Read / Glob / Grep / FileSearch` -> `Explored`
- `Edit / Write / StructuredPatch` -> `Edited`
- `Bash` -> `Ran`
- `WebFetch / GitDiff` -> `Checked`
- `Task* / EnterPlanMode / ExitPlanMode` -> `Planned`
- `Agent` -> `Delegated`

规则：

- 一个 turn 内同类活动尽量合并
- 活动展示语义摘要，不回显原始 JSON
- streaming assistant 正文不进入 activity

### 5.3.6 `structured_card`

结构化命令输出渲染为卡片。

适用内容：

- `/status`
- `/session`
- `/runtime`
- `/config`
- 环境诊断摘要
- 结构化计划摘要

示例：

```text
+------------------------------------------------------------+
| > DCLAW (vX.Y.Z)                                           |
| Model:        gpt-5.4                                      |
| Directory:    ~/work/dclaw                                 |
| Permissions:  default                                      |
| Session:      ...                                          |
| Context:      81% left (60K / 258K)                        |
+------------------------------------------------------------+
```

规则：

- 使用单独边框块
- 标题行 + key/value 布局
- 支持单独链接行
- 不适合普通 prose 与普通工具日志

### 5.3.7 `task_list_snapshot`

任务状态变化时，不仅显示增量变更，而是渲染完整任务列表快照。

示例：

```text
Tasks · 2/5 completed

[x] 1. 梳理现有 REPL 输入流
[x] 2. 抽离 transcript presenter
[~] 3. 设计 bottom dock 状态机
[ ] 4. 接入 slash suggestion menu
[ ] 5. 设计 overlay 行为
```

状态建议：

- `[ ]` `pending`
- `[~]` `in_progress`
- `[x]` `completed`
- `[!]` `blocked`
- `[-]` `cancelled`

设计原则：

1. 任务表是“当前计划状态”的权威展示。
2. 每次真实变化时追加一份完整快照。
3. 不只显示 `task #3 -> completed` 这种增量事件。
4. 最新快照默认展开，较旧快照可折叠为一行摘要。

建议触发时机：

- `TaskCreate`
- `TaskUpdate`
- `TaskList` 导致当前视图更新
- 计划内容重排或标题修改
- 进入/退出 `plan mode` 导致当前任务板变化
- `resume` 恢复后当前板状态与前次快照不同

### 5.3.8 `time_separator`

用于提示明显工作阶段完成。

示例：

```text
─ Worked for 1m 54s ─────────────────────────
```

适用时机：

- 一个回合完成后
- 一段明显工具活动结束后
- 长时间运行后输出 final prose 前

## 5.4 Transcript 聚合规则

一个 turn 内不应机械地产生“每个事件一行消息”。建议采用聚合式呈现：

1. 普通用户输入先产生 `user_prompt_band` 或 `user_command_inline`
2. assistant prose 累积为 `assistant_note`
3. 工具调用与结果按类别合并进一个或多个 `activity_group`
4. slash 命令若返回结构化信息，则生成 `structured_card`
5. 任务状态变化则追加 `task_list_snapshot`
6. 回合收尾可追加 `time_separator`

这会比“toolUse 一条、toolResult 一条、assistant 一条”的流水账更接近 Codex 风格。

## 6. Bottom Dock 设计

## 6.1 定义

底部区不是单一输入框，而是一个整体 `Bottom Dock`。

它默认由两部分组成：

1. `Input Surface`
2. `Meta Line`

必要时还会在同一区域内部展开：

- `Suggestion Menu`
- `Bottom Sheet`

## 6.2 默认结构

```text
[ › Ask DCLAW or type / for commands                         ]
gpt-5.4 xhigh · default · ~/work/dclaw
```

### 6.2.1 `Input Surface`

规则：

- 整块浅灰背景，不使用细边框 box
- 左侧固定轻量提示符，建议使用 `›`
- 支持多行输入
- placeholder 低对比度
- 与 Transcript 之间只保留很小空隙

默认 placeholder：

```text
Ask DCLAW or type / for commands
```

忙碌时 placeholder：

```text
Queue a prompt while DCLAW is working
```

浮层接管时：

```text
Complete the active dialog to continue
```

### 6.2.2 `Meta Line`

底部输入框下方显示当前轻量运行上下文。

显示项固定为：

- 当前 `runtime / model / effort`
- 当前 `permission mode`
- 当前目录 `cwd`

建议样式：

```text
gpt-5.4 xhigh · default · ~/work/dclaw
```

规则：

- 只显示值，不做过重标签
- 使用低对比度文本
- 用 `·` 分隔
- `cwd` 过长时折叠为 `.../project/subdir`

## 6.3 Bottom Dock 状态

建议首版采用 4 态：

1. `default`
   输入框 + meta line
2. `suggesting`
   输入框 + slash/参数建议列表
3. `sheet_open`
   输入框 + 底部展开的大型结构化选择面板
4. `blocked`
   输入框只读，阻塞式 dialog 接管焦点

## 6.4 Slash 建议菜单

当输入以 `/` 开头时，底部不弹 modal，而是在输入框下方直接展开建议列表。

示意：

```text
[ › /ru                                                     ]

/runtime      show or switch runtime
/resume       resume a saved session
/rules        manage project rules
```

规则：

- 输入 `/` 即触发候选
- 按命令名、别名、描述做过滤
- 默认高亮第一项
- 左列显示命令名，右列显示描述
- 高亮项使用强调色，不使用大面积反白

交互：

- `Up/Down`：移动高亮
- `Tab`：补全当前候选
- `Enter`：选中候选
- `Esc`：关闭建议菜单

## 6.5 Bottom Sheet

对于 `/model`、`/permissions` 这类结构化选项，不使用中心弹窗，而是从底部 dock 向上展开一个大型 `Bottom Sheet`。

示意：

```text
Select Runtime
Choose runtime profile and effort.

1. main-openai (default)      balanced coding profile
2. local-fast                 fastest iteration
3. research                   larger context, slower

Press Enter to select, or Esc to dismiss.
```

适合进入 `Bottom Sheet` 的场景：

- `/model`
- `/runtime`
- `/permissions`
- 其它有限集合、分层结构清晰的本地配置命令

规则：

- 与输入框共享同一视觉系统
- 顶部有标题与说明
- 中间为编号列表
- 当前项高亮
- 底部有操作提示

## 6.6 Bottom Dock 交互键位

建议首版约定：

- `Enter`：发送或确认选择
- `Shift+Enter`：换行
- `Esc`：关闭建议或退出 sheet
- `Up/Down`：移动候选或选项
- `Tab`：补全 slash 命令

## 7. Overlay 设计

## 7.1 分类

并不是所有弹出层都一样。建议拆成 3 类：

1. `Suggestion Menu`
   轻量下拉建议，挂在输入框下方
2. `Bottom Sheet`
   底部展开的大型结构化选择面板
3. `Blocking Dialog`
   真正阻塞当前流程、必须立刻用户决策的对话框

### 7.1.1 只有这些内容应进入 `Blocking Dialog`

- 权限确认
- `AskUserQuestion`
- 需要审阅确认的 diff
- 危险操作确认

规则：

- 同一时刻只允许一个阻塞 dialog 处于焦点
- 关闭后焦点返回到底部输入框

## 8. 任务列表设计

任务列表是消息区中的一种特殊结构化块，不属于普通 `activity`。

## 8.1 设计目标

1. 让用户一眼看到全局进度
2. 避免只显示增量更新，要求用户在脑内拼装整张任务表
3. 让 `resume`、`plan mode`、多轮执行更容易恢复上下文

## 8.2 任务列表快照规则

1. 一旦任务表有真实变化，消息流追加完整快照
2. 快照显示完成数与总数
3. 每个任务都显示当前状态
4. 当前任务可额外标注 `(current)`
5. 历史快照保留，但旧快照可折叠

示例：

```text
Tasks · 2/5 completed

[x] 1. 梳理现有 REPL 输入流
[x] 2. 抽离 transcript presenter
[~] 3. 设计 bottom dock 状态机  (current)
[ ] 4. 接入 slash suggestion menu
[ ] 5. 设计 overlay 行为
```

## 9. 事件模型

## 9.1 目标

当前 `interactiveSession.ts` 仍然直接把事件格式化成文本输出。新 TUI 需要改成：

```text
QueryEngine events -> UI event reducer -> Transcript / Bottom Dock / Overlay
```

## 9.2 推荐的 UI 事件类型

建议首版至少抽出这些 UI 事件：

- `turn_started`
- `turn_interrupted`
- `assistant_text_delta`
- `assistant_progress_message`
- `assistant_final_message`
- `tool_use_started`
- `tool_result_received`
- `slash_command_invoked`
- `structured_status_ready`
- `task_board_updated`
- `permission_requested`
- `permission_resolved`
- `questionnaire_requested`
- `dialog_closed`
- `queue_count_changed`
- `session_resumed`
- `conversation_compacted`

## 9.3 事件到 UI 的映射

建议映射如下：

- `onTextDelta` -> 更新当前 `assistant_note` 草稿
- `onAssistantMessage` -> 追加或封口 `assistant_note`
- `onToolUse` -> 累积进当前 `activity_group`
- `onToolResult` -> 累积或完成当前 `activity_group`
- `/status /session /runtime /config` -> `structured_card`
- `TaskCreate / TaskUpdate / TaskList` -> `task_list_snapshot`
- 权限请求 -> `Blocking Dialog`
- `AskUserQuestion` -> `Blocking Dialog`
- 队列变化 -> Bottom Dock 队列提示
- `resume / compact / interrupt` -> `system event` 或 `assistant_note`

## 10. 实现映射

## 10.1 当前代码中的保留部分

以下能力应尽量保留：

- `src/cli/repl.ts`
  已有排队、中断、busy prompt 等 REPL 语义
- `src/cli/interactiveSession.ts`
  已有 streaming / progress / tool result 主路径
- `src/core/queryLoop.ts`
  已有 `onTextDelta / onReasoningDelta / onToolUse / onToolResult` 等事件
- `src/cli/replCommands.ts`
  已有 slash 命令体系
- `src/permissions/evaluator.ts`
  已有权限判定逻辑
- `src/tasks/*`
  已有 task board、task state、plan file 语义

## 10.2 推荐的 TUI 分层

建议新增 TUI 层，而不是继续在 `interactiveSession.ts` 中直接 `stdout.write`：

- `src/tui/`
  - `state/`
  - `reducer/`
  - `presenters/`
  - `components/`
  - `views/`

推荐职责：

- `TurnPresenter`
  将 query loop 事件转为 UI 事件
- `UiReducer`
  维护 transcript、bottom dock、overlay 状态
- `TranscriptView`
  渲染消息流
- `BottomDockView`
  渲染输入框、meta line、suggestions、sheet
- `DialogView`
  渲染权限、提问、diff 等阻塞交互

## 10.3 Ink + React 集成约束

采用 `Ink + React` 后，建议遵守以下边界：

1. `QueryEngine`、`tool`、`permission`、`session` 不直接依赖 `Ink` 组件。
2. `Ink` 只存在于 `src/tui/` 及交互入口适配层，不向 `core/` 反向渗透。
3. `TurnPresenter` 负责把底层事件翻译成 UI state，`Ink` 组件只消费状态，不直接拼业务语义。
4. `headless / print` 模式继续保留纯文本 renderer，不要求依赖 `Ink`。

这意味着整体结构应保持为：

```text
QueryEngine / tools / tasks
  -> TurnPresenter / UiReducer
  -> Ink + React views
```

而不是：

```text
QueryEngine
  -> 直接调用 Ink 组件
```

## 10.4 兼容策略

建议同时保留两种渲染器：

1. `LineRenderer`
   服务现有线性 CLI / print / headless 输出
2. `TuiRenderer`
   服务新交互式全屏界面

这样可避免一次性替换所有终端输出路径。

## 10.5 依赖建议

由于首版 TUI 已明确采用 `Ink + React`，实现阶段应确保 `dclaw` 自身依赖显式声明至少包括：

- `ink`
- `react`
- `@types/react`（如类型检查需要）

如果后续要在 `dclaw` 子项目内独立开发和发布，这一步不要只依赖外层仓库的间接安装结果。

## 11. 状态持久化边界

需要区分“会话真值”和“TUI 临时状态”。

### 11.1 应持久化到 session/transcript 的内容

- 用户 prompt
- assistant 正文
- 工具调用与工具结果
- 任务板状态变更
- 结构化状态输出对应的真实事件

### 11.2 不应持久化的 TUI 局部状态

- 当前焦点
- 输入框内容
- 建议菜单高亮项
- 滚动位置
- overlay 打开/关闭状态
- 当前是否处于自动跟随

## 12. MVP 范围

首版 TUI 建议只做以下能力：

1. 全屏 Transcript
2. Bottom Dock
3. Slash 建议菜单
4. `/model`、`/runtime`、`/permissions` 的 Bottom Sheet
5. 权限确认 Dialog
6. `AskUserQuestion` Dialog
7. `activity_group`
8. `structured_card`
9. `task_list_snapshot`

暂不纳入：

- 常驻侧栏
- 多面板布局
- 高级搜索跳转
- 复杂 diff 浏览器
- 鼠标优先交互

## 13. 实施阶段与任务清单

本节用于指导后续直接开工实现。

总体策略：

1. 先抽离事件与状态层，再做 Ink 渲染层。
2. 先做可工作的主路径，再补结构化卡片、任务快照和阻塞 dialog。
3. 迁移期间保留 legacy REPL 作为回退路径，直到 TUI 交互主线稳定。

### 13.1 阶段 0：入口与依赖骨架

目标：

- 为 `Ink + React` TUI 建立最小运行入口
- 让新 TUI 与 legacy REPL 可并行存在
- 为后续 `src/tui/` 目录打下基础

建议交付：

- `interactive` 模式可进入新的 TUI 路径
- 保留 legacy REPL 回退入口
- `dclaw` 子项目显式声明 TUI 依赖

任务清单：

- [x] 在 `dclaw/package.json` 显式声明 `ink`、`react`、必要的类型依赖
- [x] 为 `interactive` 模式增加运行时分流
- [x] 迁移期同时保留 `--tui` 显式进入新壳与 `--legacy-repl` 强制回退
- [x] 在 `src/cli/` 新增 TUI 入口适配层，命名为 `runInteractiveTui`
- [x] 新建 `src/tui/` 目录骨架，至少包含：
  - `src/tui/App.tsx`
  - `src/tui/state/`
  - `src/tui/presenters/`
  - `src/tui/components/`
  - `src/tui/views/`
- [x] 约定：迁移完成前，`runInteractive` 负责在 TUI 与 legacy REPL 之间做一次选择

建议改动文件：

- `dclaw/package.json`
- `dclaw/src/cli/main.ts`
- `dclaw/src/cli/parseArgs.ts`
- `dclaw/src/cli/types.ts`
- `dclaw/src/cli/interactive.ts`
- `dclaw/src/tui/*`

测试任务：

- [x] CLI 参数解析新增 `--tui / --legacy-repl` 的单测
- [x] interactive 入口能正确选择 TUI 或 legacy REPL 的单测
- [x] 非 TTY 场景仍按现有逻辑处理的回归测试

阶段验收：

- `interactive` 入口已能稳定进入一个最小 Ink 应用
- legacy REPL 仍可回退使用
- 没有破坏 `print / resume / doctor / history` 主路径

当前实现状态补充：

- 当前阶段 0 已完成
- 当前默认 interactive 路径仍为 legacy REPL
- 用户可通过 `--tui` 显式进入新的 Ink 壳
- `--legacy-repl` 已作为显式回退入口保留
- 当前 Ink 壳仍是 phase 0 skeleton，只展示最小 Transcript 与 Bottom Dock，不承接真实 turn loop

### 13.2 阶段 1：抽离 Turn Presenter 与 UI Reducer

目标：

- 把 `interactiveSession.ts` 中“事件 -> 文本”的逻辑抽离为“事件 -> UI state”
- 建立 TUI 真正的状态中枢

建议交付：

- UI 事件协议
- Transcript/Bottom Dock/Overlay 的状态模型
- 可复用的 reducer

任务清单：

- [x] 从 `src/cli/interactiveSession.ts` 中抽离 turn 级事件消费逻辑
- [x] 定义首批 `UiEvent` 类型并接入主 turn 流：
  - `turn_started`
  - `assistant_text_delta`
  - `assistant_progress_message`
  - `tool_use_started`
  - `tool_result_received`
  - `system_notice`
  - `turn_completed`
  - `turn_interrupted`
- [x] 定义 `TranscriptItem`、`BottomDockState`、`OverlayState`
- [x] 实现 `UiReducer`
- [x] 让 line renderer 与后续 TUI renderer 共用同一套 turn presenter
- [x] 明确 assistant streaming draft、activity draft 的 reducer 更新路径
- [ ] 在后续阶段继续补齐这些事件族：
  - `task_board_updated`
  - `permission_requested`
  - `questionnaire_requested`
  - `session_resumed`
  - `conversation_compacted`

建议改动文件：

- `dclaw/src/cli/interactiveSession.ts`
- `dclaw/src/tui/state/types.ts`
- `dclaw/src/tui/state/reducer.ts`
- `dclaw/src/tui/presenters/turnPresenter.ts`
- `dclaw/src/tui/renderers/lineRenderer.ts`

测试任务：

- [x] reducer 对 `assistant_text_delta` 的聚合单测
- [x] `toolUse -> toolResult` 合并为 activity draft 的单测
- [x] presenter 在当前 `stream / non-stream / verbose` 主路径下保持现有交互测试通过
- [ ] interrupt 后 partial turn 状态一致性的独立 reducer/presenter 单测

阶段验收：

- 不依赖 `stdout.write`，也能把 turn 跑成一组稳定 UI 状态
- LineRenderer 能继续跑通当前交互与测试主线

当前实现状态补充：

- 当前阶段 1 核心已完成
- `interactiveSession` 的主 turn 流已通过 `turnPresenter + lineRenderer` 收口
- `UiReducer` 已能表达当前最关键的 transcript 语义：用户输入、assistant draft、assistant note、activity group
- `permission / questionnaire / task snapshot / session resume / compact` 等事件族仍留待后续阶段补齐

### 13.3 阶段 2：Ink App Shell 与 Bottom Dock 默认态

目标：

- 建立第一个真正可交互的 Ink 界面
- 落地 Transcript 容器与 Bottom Dock 默认态

建议交付：

- Ink 根组件
- Transcript 可滚动主区
- 灰底输入框
- Meta Line

任务清单：

- [x] 实现 `TuiApp`
- [x] 实现 `TranscriptPane`
- [x] 实现 `BottomDock`
- [x] 接入输入框、placeholder 的最小静态表现
- [x] 接入 `runtime / permissions / cwd` 的 Meta Line
- [x] 保留现有 busy/queue 语义，并映射到底部状态
- [ ] 接入自动跟随与手动滚动暂停跟随
- [x] 为 interrupt、queued prompt、busy 状态提供底部文案

建议改动文件：

- `dclaw/src/cli/interactive.ts`
- `dclaw/src/cli/repl.ts`
- `dclaw/src/tui/App.tsx`
- `dclaw/src/tui/views/TranscriptPane.tsx`
- `dclaw/src/tui/views/BottomDock.tsx`
- `dclaw/src/tui/hooks/useAutofollow.ts`
- `dclaw/src/tui/hooks/useComposer.ts`

测试任务：

- [x] 初始渲染显示 placeholder 与 meta line
- [ ] busy 时 placeholder 切换正确
- [ ] queue count 状态更新正确
- [ ] interrupt 后 Bottom Dock 状态恢复正确

阶段验收：

- 可以在 Ink 中输入 prompt 并触发一次完整 turn
- 底部能稳定展示当前 runtime、permissions、cwd

当前实现状态补充：

- 当前阶段 2 主闭环已打通：TUI 可以编辑输入、提交 prompt、显示 transcript、展示 busy 与 queue 状态
- 本地 slash 命令已接入 TUI，输出会先缓冲再回流到 transcript，避免与 Ink 重绘互相污染
- `Ctrl+C`、`/exit`、`/interrupt`、`/cls` 已在 TUI 路径下具备基础行为
- 这一阶段仍未覆盖 slash suggestion menu、bottom sheet、overlay、scrollback/autofollow

### 13.4 阶段 3：Transcript Item 渲染系统

目标：

- 将消息区从“纯文本堆叠”升级为文档式块渲染
- 实现第一批稳定的消息语法

建议交付：

- `user_prompt_band`
- `user_command_inline`
- `assistant_note`
- `activity_group`
- `structured_card`
- `time_separator`

任务清单：

- [x] 为普通 prompt 渲染浅灰横条
- [x] 为 slash 命令渲染单行高亮文本
- [x] 为 assistant prose 渲染文档段落块
- [x] 实现 `activity_group` 渲染器
- [x] 实现 `structured_card` 渲染器
- [x] 实现 `time_separator` 渲染器
- [x] 约定并编码工具到 activity group 的归类规则
- [x] 让 streaming assistant 正文只进入 prose，不进入 activity
- [x] 本地 slash 命令结果增加“展示元数据”，决定它走 card、activity、还是 prose

建议改动文件：

- `dclaw/src/cli/replCommands.ts`
- `dclaw/src/cli/verboseEvents.ts`
- `dclaw/src/tui/views/items/*`
- `dclaw/src/tui/presenters/replCommandPresenter.ts`
- `dclaw/src/tui/presenters/activityPresenter.ts`

测试任务：

- [x] 普通 prompt 与 slash 命令渲染分流正确
- [x] `/session`、`/runtime`、`/permissions` 这类结构化命令渲染为 card 的单测
- [x] `/help`、`/doctor` 这类本地命令仍可进入 activity/prose 的单测
- [ ] assistant streaming 文本不混入 activity 的单测

阶段验收：

- Transcript 已不再是线性 stdout 文本，而是具备基本视觉语法的工作文档

当前实现状态补充：

- 当前阶段 3 主目标已完成：Transcript 现在支持 `user_prompt_band`、`user_command_inline`、`assistant_note`、`activity_group`、`structured_card`、`time_separator`
- 本地 slash 命令已具备基础展示元数据，当前 `/session`、`/runtime`、`/permissions`、`/config` 会渲染为 card
- `/help` 等长文本命令仍走 prose，符合“结构化输出进 card，普通说明进文档段落”的分层原则
- tool activity 已按工具类别映射到 `Explored / Edited / Ran / Checked / Planned / Delegated`
- `scrollback/autofollow`、更细的 card 布局、task snapshot 与 richer command presentation 仍留待后续阶段

### 13.5 阶段 4：Slash Suggestion Menu 与 Bottom Sheet

目标：

- 完成底部 dock 的轻量选择交互
- 把 slash 命令真正变成可选、可补全、可配置的 UI

建议交付：

- slash 候选列表
- 参数元数据
- `/model / runtime / permissions` 的 bottom sheet

任务清单：

- [ ] 从 `replCommands` 生成 slash 候选源
- [ ] 为命令定义补充 UI 元数据：
  - `displayName`
  - `description`
  - `argumentHint`
  - `argKind`
  - `presentationKind`
- [ ] 实现 `/` 输入后的建议列表
- [ ] 支持命令过滤、高亮、上下移动、Tab 补全、Enter 确认
- [ ] 对枚举型参数实现 `Bottom Sheet`
- [ ] 首批完成这些命令的底部结构化交互：
  - `/runtime`
  - `/permissions`
  - `/model`（如后续补入本地命令体系）
- [ ] 保持自由文本参数命令继续在输入框中输入

建议改动文件：

- `dclaw/src/cli/replCommands.ts`
- `dclaw/src/tui/views/SlashSuggestionMenu.tsx`
- `dclaw/src/tui/views/BottomSheet.tsx`
- `dclaw/src/tui/hooks/useSlashSuggestions.ts`
- `dclaw/src/tui/hooks/useBottomSheet.ts`

测试任务：

- [ ] slash 建议过滤单测
- [ ] Tab 补全行为单测
- [ ] Enter 确认命令单测
- [ ] `/runtime`、`/permissions` bottom sheet 选择行为单测

阶段验收：

- slash 命令选择已不需要用户记忆全部命令文本
- `/runtime / permissions` 等命令已具备结构化底部交互

### 13.6 阶段 5：Blocking Dialog 与提问宿主统一

目标：

- 将权限确认、`AskUserQuestion` 等阻塞式交互统一到 Overlay
- 摆脱当前 `readline` 直问方式

建议交付：

- `DialogManager`
- Permission Dialog
- AskUserQuestion Dialog

任务清单：

- [ ] 实现 `DialogManager`
- [ ] 把 `interactiveQuestionHost` 扩展为可挂接 TUI dialog host
- [ ] 权限请求进入统一的 Permission Dialog
- [ ] `AskUserQuestion` 进入统一的 Question Dialog
- [ ] 支持单选、多选、preview、annotations、`finish_plan_interview`
- [ ] dialog 关闭后焦点自动返回输入框
- [ ] 非 TUI 路径继续保留原有 `readline` fallback

建议改动文件：

- `dclaw/src/cli/interactiveQuestionHost.ts`
- `dclaw/src/cli/askUserQuestions.ts`
- `dclaw/src/permissions/evaluator.ts`
- `dclaw/src/tools/builtin/askUserQuestion.ts`
- `dclaw/src/tui/views/dialogs/*`
- `dclaw/src/tui/state/dialog.ts`

测试任务：

- [ ] 权限允许/拒绝主路径单测
- [ ] `AskUserQuestion` 单选、多选单测
- [ ] `respond_to_agent / finish_plan_interview / submit_answers` 分支单测
- [ ] dialog 关闭后焦点恢复单测

阶段验收：

- 权限与用户问题交互已从消息流中分离出来，进入统一阻塞式交互层

### 13.7 阶段 6：Task Snapshot 与计划态可视化

目标：

- 将任务状态变化稳定地呈现在消息流中
- 让 plan/task 成为可视化真值，而不是零散日志

建议交付：

- `task_list_snapshot`
- 最新快照展开，旧快照可折叠
- plan/task 与 transcript 的稳定联动

任务清单：

- [ ] 定义 `task_list_snapshot` 的数据结构
- [ ] 当任务表真实变化时，追加完整快照而不是只追加增量日志
- [ ] 渲染每个任务的完成状态
- [ ] 渲染当前任务 `(current)` 标记
- [ ] 最新快照默认展开，旧快照可折叠为摘要
- [ ] 将 `/plan`、`Task*`、plan mode 相关本地命令结果与 snapshot 对齐
- [ ] 保证 `resume / compact` 后快照展示不重复、不丢失、不与旧状态冲突

建议改动文件：

- `dclaw/src/tasks/store.ts`
- `dclaw/src/tasks/taskState.ts`
- `dclaw/src/tasks/observability.ts`
- `dclaw/src/cli/replCommands.ts`
- `dclaw/src/tui/presenters/taskSnapshotPresenter.ts`
- `dclaw/src/tui/views/items/TaskListSnapshot.tsx`

测试任务：

- [ ] `TaskCreate` 后生成完整 snapshot 的单测
- [ ] `TaskUpdate` 后重新渲染整表的单测
- [ ] `resume` 恢复后 snapshot 不重复追加的单测
- [ ] `compact` 后计划状态仍一致的单测

阶段验收：

- 任务列表变化时，用户能在 transcript 中一眼看到完整当前任务表

### 13.8 阶段 7：兼容收口、切默认与稳定性加固

目标：

- 让新 TUI 成为默认 interactive 路径
- 保证关键主线稳定

建议交付：

- TUI 作为默认 interactive UI
- legacy REPL 作为回退开关
- 主链路稳定的测试护栏

任务清单：

- [ ] 将新 TUI 设为默认 interactive 路径
- [ ] 保留 `--legacy-repl` 直到若干版本后再评估移除
- [ ] 收口 resize、scrollback、exit cleanup、background drain
- [ ] 收口 `resume / compact / queue / interrupt / permissions / task snapshot` 一致性
- [ ] 为文档补充截图、已知限制与操作说明
- [ ] 根据实际实现同步更新 `docs/dev-tasks.md` 和 `project-status.md`

建议改动文件：

- `dclaw/src/cli/main.ts`
- `dclaw/src/cli/interactive.ts`
- `dclaw/src/tui/**/*`
- `dclaw/docs/dev-tasks.md`
- `dclaw/docs/project-status.md`

测试任务：

- [ ] startup smoke test
- [ ] resize/scroll/autofollow 行为测试
- [ ] queue/interruption 一致性测试
- [ ] `resume / compact / permissions / task updates` 回归测试
- [ ] legacy fallback 仍可工作的回归测试

阶段验收：

- 默认 interactive 主路径已切到 TUI
- legacy fallback 可作为兜底
- 当前文档中的 MVP 能力全部可用

### 13.9 推荐 PR 切分

建议按以下顺序切 PR，降低 review 和回归风险：

1. `PR-1`：入口、依赖、`src/tui/` 骨架、legacy fallback
2. `PR-2`：turn presenter、UI reducer、line renderer 兼容
3. `PR-3`：Ink app shell、Transcript 基础、Bottom Dock 默认态
4. `PR-4`：Transcript item 渲染、activity group、structured card
5. `PR-5`：slash suggestions、bottom sheet、命令元数据
6. `PR-6`：permission dialog、AskUserQuestion dialog
7. `PR-7`：task snapshot、plan/task transcript 联动
8. `PR-8`：默认切换、稳定性加固、文档与测试收口

## 14. 当前建议开工顺序

如果我们下一步要直接动手，建议严格从这里开始：

1. `阶段 0` 已完成，下一步直接进入 `阶段 1`
2. 优先抽离 `interactiveSession.ts` 里的 turn presenter 与 reducer
3. 不要先做对话框，不要先做花哨布局
4. 第一个可见里程碑应是：
   - Ink 界面能启动
   - 能输入 prompt
   - 能在 Transcript 里看到 `user_prompt_band + assistant_note + activity_group`

## 15. 验收标准

满足以下条件即可认为 TUI 主路径成立：

1. 普通 prompt、slash 命令、任务更新都能在消息区获得合适呈现
2. 工具活动不再直接以原始 stdout 流水账展示，而能归并成 `activity_group`
3. `/status`、`/runtime` 等结构化命令可以渲染为 `structured_card`
4. 任务状态变化会追加完整 `task_list_snapshot`
5. 输入区支持 placeholder、slash 建议、底部状态展示
6. 权限确认和 `AskUserQuestion` 不再打断主消息流格式，而走统一阻塞式交互

## 16. 总结

这套设计的核心不是“把 REPL 做复杂”，而是把当前 `dclaw` 已有的 agent 能力重新组织成更稳定的交互语法：

- Transcript 是工作文档
- Bottom Dock 是输入与轻量选择中心
- Overlay 只处理阻塞式决策
- Task Snapshot 是计划状态真值

整体风格应尽量接近 Codex：视觉上简单、结构上克制、内部状态清晰。
