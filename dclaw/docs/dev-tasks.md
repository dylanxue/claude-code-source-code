# 开发任务清单

## 当前迭代

目标：结束 `v0.1` 收尾并切换到 `v0.2` 主线；阶段 8 已按当前范围收口，当前优先推进阶段 9、10，把 Plan / Task 与 Memory 做成新的核心主线。
心智：原则上你的设计要严格对齐 Claude Code 的通用能力（源码在本项目下，跟dclaw目录平级的目录就是claude code的源码)，不额外“加戏”

最近核对结论：
- `compact` 主路径实现与当前文档描述基本一致；manual compact、消息级 boundary/runtime slicing、共享 `contextStats`、dry-run recommendation、最小 autocompact，以及首版 post-compact attachment 恢复均已真实落地
- 当前没有发现“文档已标完成但代码未落地”的重大偏差；阶段 8 已按当前产品范围收口，`partial compact / reactive compact` 都已像 `TodoWrite` 一样明确主动舍弃；阶段 9-2 的 `ExitPlanMode` 审批正文展示与阶段 9-3 的 plan 真值恢复 / planning 生命周期规则也都已收口，当前主线转到阶段 10-2 的 recall 与 prompt 注入，而不是继续把 task board 全量 transcript 化

## Todo

- [x] `P0 / 阶段 10-1`：建立 memory 文件系统骨架，先对齐 Claude Code `memdir` 风格

- [x] 新建 `src/memory/`，先落：
  - `paths.ts`
  - `store.ts`
  - `frontmatter.ts`
  - `manifest.ts`
  - `recall.ts`

- [x] 按 `docs/memory-spec.md` 先实现路径约定：
  - `~/.dclaw/projects/<sanitized-workspace>/memory/`
  - `MEMORY.md`
  - memory 独立 markdown 文件

- [x] 定义 memory frontmatter 最小字段：
  - `name`
  - `description`
  - `type`
  - `updated_at`

- [x] 先把 memory 做成 file-based manifest，不急着做复杂 ranking

- [x] 验证标准：给定一个 workspace，能稳定创建 / 读取 / 枚举 memory 文件与索引

- [ ] `P0 / 阶段 10-2`：实现 query-time recall 与 prompt 注入

- [ ] 在 prompt 装配层增加 memory section，入口统一收敛到 `src/prompt/systemPrompt.ts`

- [ ] 实现首版 recall：
  - 扫描 manifest
  - 基于 query 文本和 description 做轻量筛选
  - 单次最多注入少量 memory

- [ ] 先以 deterministic 规则实现 recall，不依赖额外模型调用

- [ ] 为 injected memory 增加可观察来源，便于 verbose / trace / doctor 排查

- [ ] 验证标准：不同 query 能召回不同 memory，且注入规模受控

- [x] `P0 / bugfix`：收口 `plan mode` 审批重复请求问题，继续向 Claude Code 当前源码靠拢

- [x] 先按 Claude Code 当前主路径重新校正 `EnterPlanMode / ExitPlanMode` 语义：
  - `EnterPlanMode` 不再要求用户批准进入；进入 planning 本身不是 approval step
  - `ExitPlanMode` 才是计划审批点；用户拒绝时应继续留在 `plan mode`

- [x] 修正 `ExitPlanMode` 被拒绝后的模型反馈语义：
  - 不再只返回弱语义的 `status: rejected`
  - 当前已对齐到 Claude Code 的 plan rejection 基础语义，把“计划被拒绝、继续留在 plan mode、附带被拒绝 plan 正文”明确传回模型

- [ ] 不额外引入本地 cooldown / plan hash 去重 / “必须先改文件才能再次批准” 之类策略
  - 在没有 Claude Code 对应实现证据前，不自行加这类 heuristic
  - 当前已先落地源码对齐路径；若仍有重复请求，再继续回到 Claude Code 源码找证据，不先补本地规则

- [ ] 验证标准：
  - 用户拒绝 plan 后，模型不会在未获得新反馈或未先继续 planning 的情况下，立刻原样再次请求批准
  - `EnterPlanMode` 不再出现额外批准弹窗
  - 相关文档口径需同步从“进入 plan mode 需要用户确认”收敛到 Claude Code 当前源码语义

- [ ] `P1 / 阶段 10-3`：明确 memory 写回策略与边界，避免与 `CLAUDE.md` / transcript / todo 混淆

- [ ] 明确首版 memory 写入触发点：
  - 只允许手动写入
  - 还是允许基于规则自动候选

- [ ] 设计去重 / 升级规则，至少覆盖“同名 memory 更新”和“描述相似但文件不同”的处理

- [ ] 明确哪些信息禁止写入 memory：
  - 当前会话短期步骤
  - 已稳定存在于 `CLAUDE.md` 的规则
  - 可从仓库直接读取的代码事实

- [ ] 验证标准：memory 不会退化成 transcript 备份，也不会与 todo store 重叠

- [ ] `P0 / 文档与测试`：补齐 `v0.2` 文档口径与核心回归用例

- [ ] 为阶段 10 增加单测：
  - [x] memory frontmatter 解析
  - [x] recall 筛选
  - [ ] prompt 注入上限

- [ ] 验证标准：`compact / plan / memory` 三条主线均有最小单测护栏

## Deferred

- [ ] backlog：继续细化 `Bash / Glob / Grep` 的统计、分页、结果映射与模型侧结果收口
- [ ] backlog：继续细化 `Read / Grep` 在超大文件、超大命中集和更复杂文件语义下的剩余边界
- [ ] backlog：继续打磨 session 列表展示、最近会话选择和更完整的 history 摘要体验
- [ ] backlog：继续补齐 resume / transcript 的 richer 恢复视图，包括更多 session 元信息与恢复后提示语义
- [ ] backlog：继续扩展 REPL command 面，并逐步收口到更统一的 slash command 体系
- [ ] backlog：为更多 provider 预留统一配置与适配层
- [ ] backlog：继续细化 provider timeout/watchdog/fallback 触发后的恢复策略，包括更细的错误提示和更明确的观测信息
- [ ] backlog：梳理 agentic turn/iteration 上限策略；当前主流程默认 `maxIterations=128`，后续需为 `compact / extractMemories / forkSubagent` 等子流程显式传入各自独立的 `maxTurns/maxIterations`
- [ ] backlog：梳理当前 Tool 协议与文档之间的差距
- [ ] backlog：扩展自动化测试覆盖到更复杂文件语义、provider 边界与其余核心工具结果结构
- [ ] `Bash` 的真 sandbox、AST 级 shell 解析和更细粒度 permission 规则暂缓；当前仅在出现真实 bug 或明确需求时继续下探
- [ ] `v0.3`：继续细化阶段 6 的 permission mode / hooks，包括更明确的 evaluator 位置、更细粒度规则与 tool 执行链路深化
- [ ] `v0.3`：继续推进 `tool result budget / persistence` 的参数化、上下文级 compact，以及 model limits 在更广调度路径上的接线
- [ ] `v0.3`：继续打磨 `CLAUDE.md`，补齐完整 include 语义、优先级细节、frontmatter / managed memory / instruction hooks
- [ ] `v0.2+ / 低优先级`：继续打磨 `WebFetch / AskUserQuestion`，重点放在 `WebFetch` 的权限/安全链路、cache、binary content 与更强的 prompt 处理，以及 `AskUserQuestion` 的 richer host UI、preview 展示与 annotations 采集
- [ ] `v0.2+ / 低优先级`：在已有 provider 重试 / 限流 / 结构化错误基础上，继续细化 `Anthropic` 的更完整错误类型映射、可配置 token 参数与更长等待策略
- [ ] `v0.2+ / 低优先级`：在已补 `verbosity / reasoning.effort / store / previous_response_id / parallel_tool_calls / max_tool_calls / include / truncation / metadata / text.format` 的基础上，继续扩展 `OpenAI Responses API` 的更多 request 参数与更广的事件覆盖
- [ ] `v0.2+ / 低优先级`：将 provider / Responses 的 annotation、specialized output types 与更广事件覆盖继续接到 transcript / verbose / headless 展示层

## Done
- [x] `P1 / 阶段 9-3`：收口 plan 真值恢复与 planning 生命周期规则

- [x] 按 Claude Code 外部主线收窄实现边界：
  - transcript 继续以 `EnterPlanMode / ExitPlanMode` 工具事件与 plan 真值恢复线索为主
  - task board 继续作为 file-backed 执行状态真值，不把“所有 task 状态变更都写入 transcript”当目标
  - 重点收口在 plan file 于 `compact / resume / clear-context` 之后的恢复语义，以及 planning 生命周期规则

- [x] 为 `/clear`、`/resume`、新 session 创建时的 planning 生命周期补齐规则：
  - `/clear` 会开启新 session，并清掉旧 planning runtime / plan file
  - `resume` 仅在 `taskBoard.mode === active` 时恢复 plan mode
  - task-only session 不会凭空 materialize plan file

- [x] 收口 plan file 真值的恢复链路：
  - 不再只依赖本地 `planFilePath`
  - 已对齐到更接近 Claude Code 的 transcript/attachment 恢复思路
  - `resume`、`compact` 后的 plan 延续已有明确可恢复来源

- [x] 保持观察面边界：
  - `resume / history / /session` 继续显示 `plan mode state / plan file / current task / current step`
  - transcript 不镜像 task board 全量状态，只保留 plan 恢复所需的关键信息

- [x] 将 `v0.2` 主线正式切换到阶段 8-10，并同步 README / 状态页 / 阶段文档 / 任务清单的版本口径

- [x] 将阶段 8 的抽象 TODO 下钻为“手动 compact -> 共享统计 -> autocompact”的执行顺序，并与现有 `tool result budget / persistence` 接轨

- [x] `阶段 8-8a / partial compact`：主动舍弃，不再进入主线
  - 这项能力虽然能在 Claude Code 外部源码中看到，但 `dclaw` 当前没有对应的 message selector / rewind 交互入口
  - 若仅为了复用底层能力而保留一套内部 partial compact core，会让 `dclaw` 多出一条没有产品入口、也不会和 auto compact 联动的分叉路径
  - 按“无穷向 Claude Code 源码靠拢、不自己加戏”的规则，当前不再保留 partial compact，实现与任务项都一并回滚
  - 这项取舍与 `TodoWrite` 类似：不是“暂时没做”，而是当前明确主动舍弃

- [x] `阶段 8-8b / reactive compact`：主动舍弃，不再进入主线
  - Claude Code 外部源码当前仅可见调用点与 feature gate，真实实现文件未在当前源码树中提供，且明确是 ant-only
  - 在无法直接对齐 Claude Code 外部主线前，`dclaw` 不自行补一版失败后自动 compact / retry 策略
  - 这项取舍与 `partial compact` 和 `TodoWrite` 一样：属于当前明确主动不做，而不是延后排期

- [x] 阶段 8：按当前范围结束
  - 主路径统一收敛到 `full compact + autocompact + post-compact runtime attachment 恢复`
  - `partial compact / reactive compact` 都不再进入 `dclaw` 当前主线
  - 后续如 Claude Code 外部源码出现新的可对齐主线路径，再重新评估

- [x] `P0 / 阶段 8-1`：建立 `compact` 最小内核的数据结构与目录骨架

- [x] 新建 `src/compact/`，先落 `types.ts / compactSession.ts / compactSummary.ts` 的最小模块边界

- [x] 定义 `compact boundary` 结构，至少覆盖：
  - `boundaryId`
  - `createdAt`
  - `trigger`（`manual` / `auto`）
  - `reason`
  - `messageCountBefore`
  - `summaryMessageId`

- [x] 为 `Message` 扩展 compact boundary metadata，并建立统一 boundary message 形态

- [x] 为 compact summary 规定统一消息形态，避免继续使用随意拼接的普通文本块

- [x] 验证标准：`/compact` 后，当前 session 可明确看出最近一次 compact boundary

- [x] `P0 / 阶段 8-2`：把当前 `/compact` 从占位命令升级成真正的 boundary 流程

- [x] 将 `src/cli/replCommands.ts` 中的 `/compact` 改为调用统一的 compact service，而不是直接拼 transcript 文本

- [x] 在 compact 前生成受控 summary 输入，只消费有限 transcript 视图与必要元信息，避免把全量历史再次塞回新上下文

- [x] 设计 compact 后的消息替换流程：
  - compact 在同一 session 内追加 boundary + summary message
  - 老 transcript 继续保留在同一消息历史中
  - engine 运行时只消费最近一次 compact boundary 之后的上下文

- [x] 在 `session/transcript.ts`、`session/history.ts`、`cli/resume.ts`、REPL `/session` 中增加 compact 边界可观察信息

- [x] 验证标准：history / transcript / resume 都能看出 compact boundary，而不只是看到一条普通 assistant 文本

- [x] `P0 / 阶段 8-3`：把现有 `tool result budget / persistence` 接到 compact 主线

- [x] 梳理 `src/core/toolResultBudget.ts` 与阶段 8 的职责边界，明确“工具结果落盘”与“上下文 compact”各自负责什么

- [x] 在 `queryLoop` 或其前置层补统一的上下文统计结构，至少包含：
  - 当前 message 数
  - 最近 tool result 替换数
  - 估算上下文字符数 / token 预算占比
  - 模型 limits 派生阈值

- [x] 先实现手动 compact 所依赖的共享统计，不直接一步做到完整 autocompact

- [x] 验证标准：后续 autocompact 可以直接复用这套统计，而不是再起一套独立预算逻辑

- [x] `P1 / 阶段 8-4`：接入最小 autocompact 触发链路

- [x] 定义 autocompact 触发条件，首版优先使用保守阈值：
  - 以模型 limits 派生的 effective context window / auto-compact threshold / blocking limit 为主
  - 当前实现已改为对齐 Claude Code 的 token-threshold 语义

- [x] 在真实触发前保留 dry-run / trace 输出，先证明判定逻辑稳定

- [x] 复用手动 compact 的 summary 与 boundary 流程，不单独复制一套自动压缩实现

- [x] 为 autocompact 失败路径补安全回退：压缩失败时不丢消息，只继续按原链路请求

- [x] 验证标准：在小模型 / 长会话下可稳定触发一次自动 compact，并保留可恢复边界

- [x] `P0 / 阶段 8-5`：把 compact summary 从“本地 transcript 重组”升级为“模型生成 summary”

- [x] 明确当前实现边界：
  - 现有 `compactSummary` 仍主要承载受控 transcript 视图，不等同于 Claude Code 的 compact summarize call
  - 现有 `instructionText / contextStats` 可继续作为模型 summary 的输入材料；具体恢复信息应逐步转移到 post-compact runtime attachment，而不是继续塞进 summary

- [x] 为 compact 建立独立的 summarization prompt / call path：
  - 手动 compact 走同一条 summarize path
  - autocompact 复用同一条 summarize path
  - 避免手动 / 自动各自维护两套摘要逻辑

- [x] 失败路径要求：
  - summarize call 失败时保留原消息，不丢上下文
  - 首版不急着补所有 retry 策略，但要保留后续接 reactive compact 的接口

- [x] 验证标准：
  - compact summary 不再只是 transcript 行列表
  - summary 能稳定保留当前工作、最近决策、关键文件与用户要求

- [x] `P0 / 阶段 8-6`：把 compact boundary 从 session meta 扩展到消息级 runtime 语义

- [x] 建立消息级 compact boundary 结构，而不只是在 `SessionMeta` 上记录 source / target

- [x] 明确模型可见上下文的切片规则：
  - query 前只消费最近一次 compact boundary 之后的上下文
  - compact boundary 成为 runtime context slicing 的协议，而不只是 history 展示信息

- [x] 梳理 transcript / resume / history 的关系，避免“观察面 boundary”和“模型实际看到的 boundary”语义分叉

- [x] 验证标准：
  - compact boundary 既可观察，也真正参与模型上下文裁剪

- [x] `P1 / 阶段 8-7`：补 post-compact 结构化 attachment 恢复（首版）

- [x] compact 后第一轮已具备最小 planning/task carry-over：
  - 当前最近文件、`plan file`、`current task / current step` 与 first-turn `task reminder` 已通过 runtime message 恢复
  - 当前 compact 后第一轮若仍处于 `plan mode`，会强制补一次 full `plan_mode` reminder

- [x] 已把首版恢复重心从 summary 文本转向结构化 runtime attachment：
  - 最近读过的关键文件恢复
  - plan file 恢复
  - plan mode 恢复
  - task 摘要恢复
  - current step 摘要恢复

- [x] 验证标准：
  - compact 后首轮模型仍知道最近文件、planning 状态与当前任务焦点

- [x] `P0 / 阶段 9-1`：建立 plan / task / todo 的最小存储内核

- [x] 先按 `docs/plan-task-spec.md` 的首版方案落地：引入 `task board`，由 session meta 挂接 `taskBoardId`

- [x] 新建 `src/tasks/`，先落：
  - `types.ts`
  - `store.ts`
  - `taskState.ts`

- [x] 定义最小数据结构：
  - `planMode` 会话状态
  - `task`（id、title、status、createdAt、updatedAt）
  - `currentStep`

- [x] 先采用本地文件持久化，保持与 session store 同风格，优先支持恢复而不是复杂查询

- [x] 明确 task board 与 session 的关联方式：首版采用 `task board` 真值 + session meta 挂接 `taskBoardId`，允许连续 session 复用同一 board

- [x] 验证标准：重启后可恢复 plan mode、当前 task 和当前步骤

- [x] 已完成最小会话衔接：`/compact` 后会继承 `taskBoardId`，`/session` 可显示当前 board 与 plan 状态

- [x] 已完成 Claude Code 源码重新评估：
  - Claude Code 存在 V1 `TodoWrite` 与 V2 `TaskCreate / TaskList / TaskGet / TaskUpdate` 两层能力
  - Claude Code 当前 interactive 主路径已偏向 `Task*`
  - `plan mode` 的核心不只是权限限制，还包括 plan file 与 compact/resume 后的持续指令
  - `dclaw` 当前已补上模型侧 `EnterPlanMode / ExitPlanMode`、compact 后首轮的 plan-mode reminder / attachment，以及 `resume/history/transcript` 的首版 planning 观察面；与 Claude Code 的剩余差异已收敛到审批展示和更完整的 transcript / attachment 语义

- [x] 已决定不再保留 `TodoWrite` tool 与 `/todo` 命令：
  - V1 checklist 路径只作为 Claude Code 源码参照，不再作为 `dclaw` 产品面能力
  - 对外主线路径统一收敛到 `/plan` 与 `Task*`

- [x] 复用现有 `permissions/evaluator.ts` 中“plan 模式禁止变更工具”的语义，补齐首版 plan mode 状态来源：当前已由 task board + REPL `/plan` 管理基础状态

- [x] 为 CLI / REPL 设计最小入口：
  - `/plan`
  - `/plan start`
  - `/plan exit`

- [x] 设计 `/plan` 的交互语义：
  - 不在 plan mode 时：进入 plan mode
  - 已在 plan mode 时：显示当前 plan / task 摘要
  - `/plan exit`：请求退出 plan mode 并开始实施

- [x] 新增 `P0 / 阶段 9-2a`：接入 Claude Code 当前主路径的 `Task*`
  - `TaskCreate`
  - `TaskList`
  - `TaskGet`
  - `TaskUpdate`
  - 按 id 更新
  - 以 interactive 为默认场景
  - 当前已对齐的最小字段：
    - `TaskCreate`：`subject / description / activeForm / metadata`
    - `TaskList`：`id / subject / status / owner / blockedBy`
    - `TaskGet`：`id / subject / description / status / blocks / blockedBy`
    - `TaskUpdate`：`subject / description / activeForm / status / owner / metadata / addBlocks / addBlockedBy`
  - 当前已实现 `status=deleted` 的删除语义，并同步清理其他 task 上的 `blocks / blockedBy`

- [x] compact 后的 runtime 恢复现已覆盖最小 planning/task 上下文：
  - 当前 plan file 路径
  - 当前 task / current step 摘要
  - “继续 planning、不要直接实施”的 reminder

- [x] `P0 / 阶段 9-2b`：把 `Task*` 的模型提示方式对齐到 Claude Code
  - `dclaw` 现在会向模型发送各 tool 的长版 `prompt()`
  - `TaskCreate / TaskList / TaskGet / TaskUpdate` 已接入独立 prompt 文件
  - `src/tools/types.ts` 已扩展支持 `prompt()`
  - `src/core/queryLoop.ts` 已按长版 tool prompt 组装 `Task*` definitions
  - `QueryEngine` 已补上最小 runtime task reminder
  - `TaskUpdate` 已补上更接近 Claude Code 的完成态引导

- [x] `P0 / 阶段 9-2`：把 `ExitPlanMode` 审批收口到完整 plan file 正文展示
  - 已按 Claude Code 外部主线把退出审批从“只给 preview”收口到“直接展示完整 plan file 正文”
  - `ExitPlanMode` 审批选项现在传递完整 plan file 内容，而不是只传首行 `planPreview`
  - 终端 question host 已接通 `preview` 展示，用户可在批准前直接审阅完整 plan 正文
  - 保持范围克制：不扩写新的 plan-mode 产品设计，只收口审批展示本身
  - 验证结果：
    - plan mode 下模型仍能看到 plan file 路径、task 摘要和当前步骤
    - 变更型工具仍被权限层拦住
    - 模型不会在未退出 plan mode 的情况下直接进入实施口径
    - 发给模型的 `Task*` tool definition 仍保持长版 task tool prompt
    - 用户在批准退出 plan mode 前，已能直接看到完整 plan file 正文，而不只是 preview

- [x] `P0 / 阶段 9-2` 已完成的最小 plan mode 主路径：
  - 已完成阶段 9 主线调整：移除 `TodoWrite` 与 `/todo`，对外主线统一收敛到 `Task*` 与 plan file
  - 已移除 `/todo` 相关命令与 `TodoWrite` tool，避免继续保留偏离 Claude Code 当前主路径的 checklist 入口
  - 已接入模型侧 `EnterPlanMode / ExitPlanMode`
  - 当前已按 Claude Code 当前源码收口：`EnterPlanMode` 直接进入 planning，`ExitPlanMode` 仍是唯一 plan approval step
  - 用户显式输入 `/plan` 可直接进入 plan mode
  - 已为常规 interactive turn 接入 `plan_mode / plan_mode_exit / plan_mode_reentry` reminder
  - 已为 post-compact 第一轮补齐强制 full `plan_mode` reminder
  - 已为 plan mode 注入最小 runtime 语义：优先探索 / 澄清 / 写 plan file，避免直接进入实施口径
  - 已在 prompt runtime context 中注入当前 plan mode / plan file / task / current step 摘要，让模型知道“正在计划”还是“正在执行”
  - 已让 `resume / history / /session / transcript` 具备首版统一的 planning 观察面：
    - `resume / history / /session` 均可看到 `plan mode state / plan file / current task / current step`
    - transcript 已可读方式呈现 `EnterPlanMode / ExitPlanMode` 的 request / approval / rejection 语义
  - 已按 Claude Code 外部主线收敛 transcript 语义：保留 `EnterPlanMode / ExitPlanMode` 工具事件与 plan file 真值持久化，不再把 `plan_mode / plan_mode_exit / plan_mode_reentry` runtime reminder 单独写入 transcript

- [x] 为阶段 9 增加单测：
  - task board store 持久化
  - plan mode 进入 / 退出与 reminder 恢复
  - plan mode 下权限限制

- [x] `P0 / 文档与测试` 已完成部分：
  - 已更新 `README / project-status / phases / architecture / work-log` 中阶段 8-10 的实现状态与边界
  - 已为阶段 8 增加单测：
    - compact boundary 持久化
    - `/compact` 后 same-session boundary 追加
    - autocompact dry-run / fallback

- [x] 初始化 `dclaw/` 目录结构
- [x] 初始化 TypeScript 基础工程
- [x] 初始化 `README.md`
- [x] 编写总体方案文档
- [x] 编写 MVP 设计文档
- [x] 编写扩展设计文档
- [x] 编写 Prompt / Tool / Memory / Agent / Skill / MCP 专题文档
- [x] 建立文档编号版入口
- [x] 定义 CLI 命令结构
- [x] 实现参数解析模块
- [x] 实现 interactive 入口
- [x] 实现 headless `--print` 入口
- [x] 实现 `doctor` 入口
- [x] 实现 `resume` 入口占位
- [x] 增加 `package.json` 运行脚本
- [x] 跑通最小命令调用
- [x] 实现最小消息类型
- [x] 实现最小 LLM client/provider 抽象
- [x] 实现最小 QueryEngine
- [x] 拆出 `queryLoop`
- [x] 将 QueryEngine 接入 interactive/headless 入口
- [x] 实现最小 prompt context / system prompt 装配层
- [x] 实现基础 `CLAUDE.md` 加载器
- [x] 将基础 `CLAUDE.md` 接入 prompt 链路
- [x] 支持向上发现多层 `CLAUDE.md`
- [x] 支持 `.claude/CLAUDE.md`
- [x] 支持 `.claude/rules/*.md`
- [x] 支持基础 `@include` 指令
- [x] 为 `CLAUDE.md` 加载加入去重与循环保护
- [x] 修正代码块中的 include 误提取
- [x] 验证 HTML 注释中的 include 不被提取
- [x] 验证带转义空格和 `#fragment` 的 include 可解析
- [x] 增加 `CLAUDE.md` 加载顺序的可观察性
- [x] 抽出可复用的 `CLAUDE.md` 加载顺序格式化工具
- [x] 明确当前 `CLAUDE.md` 未覆盖的边界
- [x] 实现最小 Tool 协议
- [x] 实现 tool registry
- [x] 将默认工具名与 Claude Code 对齐为 `Read / Edit / Write / Bash / Glob / Grep`
- [x] 将最小 tool loop 接入 QueryEngine
- [x] 实现多轮 assistant->tool->assistant 闭环
- [x] 增加 `glob` / `grep` 两个只读基础工具
- [x] 为 `Bash` 补上基础 timeout、只读识别、`interrupted` 与 `noOutputExpected` 语义
- [x] 为 `Bash` 补上最小 `run_in_background`
- [x] 为 `Bash` 补上最小 `permissionMode` 入口与 `dangerouslyDisableSandbox` 模式约束
- [x] 将最小 permission evaluator 接入 `queryLoop`
- [x] 让 `default / accept-edits / plan / bypass-permissions` 4 种 `permissionMode` 真正作用于工具执行
- [x] 增加 `permissionMode` 的用户级与 workspace 级配置解析：
  - CLI `--permission-mode`
  - `~/.dclaw/config.json`
  - `<workspace>/.dclaw/config.json`
- [x] 明确 `permissionMode` 配置优先级：CLI > 用户级 > workspace > 默认值
- [x] 让 `doctor / interactive / resume / verbose meta` 显示实际生效的 `permissionMode` 及其来源
- [x] 为 `Glob` 补上默认 100 条结果限制与 `truncated`
- [x] 为 `Grep` 补上默认 `head_limit=250` 与 `-A/-B/-C/context/-n/type/multiline` 基础支持
- [x] 为 `Edit / Write` 补上基础 `structuredPatch`
- [x] 为 `Edit / Write` 补上最小 `gitDiff`
- [x] 为 `Read` 补上 `isPartial` 输出标记
- [x] 建立基础自动化测试骨架并接入 `npm test`
- [x] 将自动化测试扩展到 `Glob / Grep / WebFetch / AskUserQuestion`
- [x] 将自动化测试扩展到更多 permission mode 与 `Read / Edit / Write / Bash` 边界场景
- [x] 将 `Bash` 的只读识别扩展到 `pwd` 与常见只读 `git` 命令
- [x] 将 `Bash` 的只读识别扩展到 `timeout / time / nice / stdbuf / nohup` 这类安全 wrapper
- [x] 将 `Bash` 的只读识别扩展到一小组 Claude Code 风格的安全环境变量前缀
- [x] 将带输出重定向的 `Bash` 命令从只读自动放行中排除，并补上对应测试
- [x] 为 `Bash` 补上动态重定向目标与 `cd` + 重定向组合命令的人工审批原因
- [x] 将 `Bash` 的结果持久化收紧为包含 `cwd / exit_code / sandbox_mode / command` 的诊断记录
- [x] 将 `Bash` 的 `sandboxMode` 透出到 trace / transcript / history
- [x] 将 `Bash` 的重定向语义扩展到 `fd duplication / force-clobber / >& file / &> / &>> / 1>>file 2>&1`
- [x] 将 `Bash` 的 command substitution / process substitution 从只读自动放行路径中移出
- [x] 更新 `project-status.md`
- [x] 在 `work-log.md` 记录实现结果
- [x] 为 Tool 执行链路补上 `validate / isEnabled / availableTools` 预留位
- [x] 增加 `WebFetch` 与 `AskUserQuestion` 的最小实现并接入默认工具集
- [x] 为 `WebFetch` 补上更稳的 URL/协议校验、跨 host 重定向提示、HTML/JSON 内容提取与更丰富的结果元信息
- [x] 为 `AskUserQuestion` 补上稳定 question id、唯一性校验、可选 preview/annotations 字段与答案规范化
- [x] 接入第一个真实 LLM provider，替换当前仅有的 `stub` 执行路径
- [x] 优先实现 `Anthropic` provider 的最小非流式 `createMessage` 调用
- [x] 增加真实 LLM 所需的配置读取、API key 校验和错误分层
- [x] 将 CLI `--provider` 扩展为支持 `anthropic`
- [x] 为 `doctor` 增加 `Anthropic` 配置诊断输出
- [x] 接入第二个真实 LLM provider：`OpenAI`
- [x] 为 `OpenAI` provider 实现最小 `Responses API` 调用
- [x] 将 CLI `--provider` 扩展为支持 `openai`
- [x] 增加模型 token limit 配置层，支持内置默认值、环境变量覆盖和外部 JSON 覆盖
- [x] 为 `doctor` 增加解析后 model limits 的诊断输出
- [x] 为 `doctor` 与 REPL `/doctor` 增加 provider reliability 诊断输出：
  - `max retries`
  - `retry backoff`
  - `request timeout`
  - `stream watchdog`
  - `stream idle timeout`
- [x] 为 `OpenAI` provider 增加 `chat/completions` 兼容调用
- [x] 增加 `.env` / `.env.local` 自动加载
- [x] 为 `Anthropic` 与 `OpenAI` provider 补上基础 streaming
- [x] 为 CLI 增加 `--stream` 与 `--output-format sse`
- [x] 为 `OpenAI Responses API` 补上更完整的流式事件兼容，包括 `response.output_text.*`、`response.reasoning_summary_text.*`、`response.function_call_arguments.*`、`response.output_item.*` 与 `response.done` 回退收尾
- [x] 为 `OpenAI Responses API` 补上首批更细 request 参数支持，包括 `text.verbosity`、`reasoning.effort`、`store`、`previous_response_id`、`parallel_tool_calls` 与 `max_tool_calls`
- [x] 为 `OpenAI Responses API` 补上第二批 request 参数支持，包括 `include`、`truncation`、`metadata` 与 `text.format`
- [x] 为 `OpenAI Responses API` 补上基于 message item 的流式文本回退路径，避免只依赖 `response.output_text.*`
- [x] 为 `OpenAI Responses API` 补上 `response.content_part.*` 与 `response.refusal.*` 事件兼容，并接到实时文本增量回调
- [x] 为 `OpenAI Responses API` 补上 `output_text.annotations` 与 `response.output_text.annotation.added` 兼容，并将 annotation 保留到 `text` 内容块
- [x] 为 `Anthropic` 与 `OpenAI` provider 补上基础重试、限流处理与指数退避
- [x] 将默认 provider 重试次数与退避上限对齐 Claude Code：
  - 默认 `DCLAW_LLM_MAX_RETRIES=10`
  - 默认退避为 `500ms` 起步的指数退避，最大 `32s`，附加最多 `25%` 抖动
- [x] 让 provider 重试优先尊重 `x-should-retry` 与 `Retry-After`
- [x] 为 `Anthropic 429` 优先接入 `anthropic-ratelimit-unified-reset`
- [x] 将流式请求的自动重试限制为“收到首个 SSE 事件前”
- [x] 为 `Anthropic` 与 `OpenAI` provider 补上最小请求超时：
  - `DCLAW_LLM_TIMEOUT_MS`
- [x] 为 `Anthropic` 与 `OpenAI` provider 补上最小流式 idle watchdog：
  - `DCLAW_ENABLE_STREAM_WATCHDOG`
  - `DCLAW_STREAM_IDLE_TIMEOUT_MS`
- [x] 为 provider 错误补上结构化分类：`auth / rate_limit / overloaded / bad_request / server_error / network / unknown`
- [x] 为 CLI 补上结构化 provider 错误格式化与 `response.error` SSE 事件输出
- [x] 将 `main.ts` 收紧为仅在直接执行时自启动，避免导入测试时副作用执行
- [x] 为 CLI 失败路径补上子进程级集成测试，覆盖普通 stderr 与 SSE `response.error`
- [x] 为 `MiniMax / Kimi / GLM` 补上内置 model limits
- [x] 用本地 provider 配置完成基础 smoke test
- [x] 为 `Read` 补上明确 input schema，并兼容 `path` 作为 `file_path` 别名
- [x] 将 Tool 协议收紧为轻量版 `buildTool` 形态，并补上默认 `validate / isEnabled / isReadOnly`
- [x] 为默认 builtin tools 补齐显式 `outputSchema`
- [x] 将 tool result 分为“内部输出”和“模型侧输出”，并在 transcript 中保留 `rawOutput`
- [x] 将 `outputSchema` 接入 `queryLoop` 运行时校验，拦截不合法的工具输出
- [x] 为 Tool 协议补统一的结果体积元信息：`maxResultSizeChars`
- [x] 在 `queryLoop` 发请求前增加统一的 tool result budget / persistence 层
- [x] 基于 resolved model limits 为 `queryLoop` 派生模型感知的 `tool result budget`
- [x] 为超大 tool result 设计统一的“落盘 + 文件引用 + preview”模型侧替换格式
- [x] 为单条消息中的多个 `tool_result` 增加 aggregate budget，避免并行工具结果叠加后整体过大
- [x] 将 `Read` 的输出形态收紧到更明确的 `type / file / didReadToEnd / warning` 结构
- [x] 将 `Edit / Write` 的直接 `call` 语义收紧到必须完整读取且拒绝 stale read 覆盖
- [x] 为 `Write` 补上 `create / update / noop` 结果区分、`didWrite` 与 `userModified`
- [x] 为 `Glob / Grep` 补上更明确的统计与边界字段，包括 `totalFiles / totalMatches / truncated`
- [x] 为 `Glob / Grep` 补上 `searchRoot / engine / durationMs` 等结果元信息
- [x] 为 `Bash` 补上 `executionMode / stdoutTruncated / stderrTruncated / persistedOutputSize`
- [x] 收紧 `Read` 的默认读取边界，阻止超大文件在未指定 `limit` 时整段直接进入模型
- [x] 为 `Grep / Glob` 与 fallback 搜索补上第一轮默认排除目录，并在显式目标路径下允许继续搜索这些目录
- [x] 建立最小 session store：
  - `src/session/paths.ts`
  - `src/session/store.ts`
  - `src/session/resume.ts`
- [x] 让 `interactive / --print / resume` 接入最小 session 持久化与恢复链路
- [x] 让 `resume` 从占位输出推进到可在恢复历史消息后继续执行新的 prompt
- [x] 将 `QueryEngine` 扩展为支持从恢复的 `initialMessages` 继续执行
- [x] 把 `interactive` 从“单次 prompt 入口”推进到真正的 REPL 交互循环
- [x] 为 REPL 增加首批本地 slash commands：
  - `/help`
  - `/session` / `/info`
  - `/history`
  - `/doctor`
  - `/model [model]`
  - `/permissions [mode]`
  - `/config`
  - `/transcript [N]`
  - `/resume [session-id]`
  - `/compact [instructions]`
  - `/clear`
  - `/cls`
  - `/exit` / `/quit`
- [x] 为 session / resume 增加自动化测试：
  - `test/unit/session.test.ts`
- [x] 调整 headless / interactive 运行时最大 tool loop 轮数，减少过早回退到原始 tool result JSON

## 阶段跟踪

- 阶段 1：CLI 与运行入口 `completed`
- 阶段 2：Query Engine 与消息协议 `completed`
- 阶段 3：System Prompt 与指令装配 `in progress`
- 阶段 4：`CLAUDE.md` 指令系统 `in progress`
- 阶段 5：Tool 协议与基础工具 `in progress`
- 阶段 6：权限模式与 Hooks `in progress`
- 阶段 7：Session、历史与恢复 `in progress`
- 阶段 8：上下文管理与自动压缩 `completed`
- 阶段 9：Plan / Task `in progress`
- 阶段 10：Memory `in progress`
- 阶段 11：多代理、Worktree 与协作执行 `not started`
- 阶段 12：MCP、Skills、Plugins 与 Remote Bridge `not started`
- 阶段 13：Coding 场景增强 `not started`

## 使用约定

- `Todo`：当前迭代明确要做
- `In Progress`：本轮正在做
- `Done`：已完成并确认
- `阶段跟踪`：当前各阶段的总体状态快照
