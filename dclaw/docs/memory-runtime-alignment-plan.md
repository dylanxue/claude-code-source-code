# Memory Runtime Alignment 技术方案

日期：`2026-04-29`

本文档记录下一轮 `dclaw` memory runtime 对齐 Claude Code 的技术方案。当前 `dclaw` 已经具备 file-based memory、`MEMORY.md` 索引、frontmatter manifest、side-query recall、后台 extraction 写回等主骨架；下一阶段重点不是重做 memory，而是补齐运行时体验和长期维护机制。

## 1. 背景

当前 `dclaw` memory 主链路：

- `src/memory/paths.ts / store.ts / manifest.ts / prompt.ts / select.ts / extract.ts`
- 每个 workspace 有独立 memory 目录
- `MEMORY.md` 作为入口索引
- 独立 memory markdown 文件保存正文和 frontmatter
- system prompt resolver 中同步调用 `loadPromptMemoryContext`
- 使用 side-query selector 从 manifest 中选择相关 memory
- turn complete 后通过后台 extraction 更新 memory

与 Claude Code 对照后，确认核心差距集中在四个方面：

1. relevant memory prefetch 机制缺失
2. surfaced memory 去重与会话级注入节流缺失
3. session memory 机制缺失
4. 遗忘 / prune 机制仍停留在 prompt 语义，缺少完整 runtime 设计

另外，`dclaw` 当前 session 存储仍是全局平铺目录：

```text
<DCLAW_HOME>/sessions/<session-id>/
```

这与 memory 已采用的 workspace/project 级目录不一致。session memory、autoDream、resume 列表如果继续基于全局 session 目录，会混入无关 workspace 的历史。因此 session 存储 workspace 化是本方案的前置任务。

本文档只覆盖上述四项。`DCLAW.md` 指令系统不列为本阶段核心差距；`dclaw` 已经具备基础多层发现、`.dclaw/rules/*.md`、`DCLAW.local.md`、基础 include、去重与循环保护。后续 `DCLAW.md` 深化仍按 `prompt-system.md` 中的 v0.4 边界推进。

## 2. 设计目标

### 2.1 目标

- 降低 memory recall 对首 token 延迟的影响。
- 防止同一 memory 在同一 session 内反复注入。
- 为长会话提供滚动结构化状态，提升 compact / resume 连续性。
- 将遗忘分成显式遗忘、机会性纠错、周期性整理三层，避免增量 extraction 误删。
- 保持 memory、session memory、DCLAW.md、plan/task 的职责边界清晰。
- 将 session transcript / meta 从全局平铺目录迁移到 workspace/project 级目录。

### 2.2 非目标

- 本阶段不做 team memory sync。
- 本阶段不做跨 workspace 的全局 auto-memory。
- 本阶段不把 session memory 作为长期 memory recall 来源。
- 本阶段不引入数据库；仍以本地文件系统为 source of truth。
- 本阶段不实现基于 TTL 的确定性自动删除。
- 项目尚未上线，本阶段不保留旧全局 session / artifact 目录兼容。

## 3. 术语与职责边界

### 3.1 Long-term memory

当前 `src/memory/` 下的 file-based memory。用于保存跨会话仍有价值的 durable context。

适合保存：

- 用户角色、偏好、协作方式
- 项目中无法从代码直接推导的背景、目标、约束、事故
- 外部系统引用
- 用户明确要求记住的非临时事实

不适合保存：

- 当前会话临时步骤
- task progress
- plan 内容
- transcript recap
- 可从代码 / git / DCLAW.md 直接获得的信息

### 3.2 Session memory

每个 session 一个滚动结构化 notes 文件。它服务当前长会话的 compact / resume，不参与未来新 session 的 memory recall。

适合保存：

- 当前正在做什么
- 用户本轮任务规格
- 重要文件 / 函数
- 已运行命令与解释
- 错误和纠正
- 下一步
- 简短 worklog

### 3.3 DCLAW.md

指令型上下文。保存稳定、显式、可人工维护的项目或用户指令。

### 3.4 Task / Plan

Task 是当前执行批次状态；Plan 是计划模式下的计划文件。它们不应被 long-term memory 或 session memory 替代。

## 4. Workspace-scoped Session Storage

### 4.1 当前问题

当前 `dclaw` session 路径由 `src/session/paths.ts` 提供，核心形态是：

```text
<DCLAW_HOME>/sessions/<session-id>/meta.json
<DCLAW_HOME>/sessions/<session-id>/messages.jsonl
```

这会导致：

- 不同 workspace 的 session 混在同一个目录。
- `/resume` 默认列表难以表达“当前 workspace session”。
- session memory 无法自然挂在 workspace/session 下面。
- autoDream 如果基于 session mtime 判断，会把无关 workspace 的 session 算进去。
- 后续 workspace 级 memory 与 session 级 compact/resume 的边界不一致。

### 4.2 目标形态

session 存储改为 workspace/project 级目录：

```text
<DCLAW_HOME>/projects/<sanitized-workspace>/sessions/<session-id>/meta.json
<DCLAW_HOME>/projects/<sanitized-workspace>/sessions/<session-id>/messages.jsonl
<DCLAW_HOME>/projects/<sanitized-workspace>/sessions/<session-id>/subagents/
```

其中 `<sanitized-workspace>` 应复用 memory 的 project key 规则，避免同一 workspace 在 memory 和 session 中产生不同目录。

### 4.3 API 调整

建议新增 workspace-aware path API：

```ts
getProjectSessionsDir(workspaceRoot, env)
getSessionDir(workspaceRoot, sessionId, env)
getSessionMetaPath(workspaceRoot, sessionId, env)
getSessionMessagesPath(workspaceRoot, sessionId, env)
getSessionSubagentsDir(workspaceRoot, sessionId, env)
```

实现期不保留旧全局目录 fallback。env-only 调用只允许解析到当前 workspace root；新代码应优先显式传入 workspaceRoot，避免依赖进程 cwd。

### 4.4 Resume 行为

默认 `/resume`：

- 只列当前 workspace 的 sessions。
- 如果未来支持 git worktree 归并，可以另行按 canonical git root 扩展。

可选 all projects：

- 后续可以提供“所有 workspace sessions”视图。
- 跨 workspace resume 时应提示目标 workspace 路径，必要时建议用户切换目录后 resume。

### 4.5 旧 session 兼容

项目尚未上线，不保留旧 session 兼容：

- 新 session 只写入 workspace-scoped 目录。
- 读取指定 session id 只查当前 workspace project 目录。
- `/resume` 默认只显示当前 workspace project sessions。
- 不提供旧全局目录迁移命令。

### 4.6 验收标准

- 新建 session 写到 `<DCLAW_HOME>/projects/<workspace>/sessions/<id>/`。
- 同一 `DCLAW_HOME` 下不同 workspace 的 session 不互相出现在默认 resume 列表。
- 指定 session id resume 只在当前 workspace project 内查找。
- subagent transcript 跟随 parent session 进入 workspace session 目录。
- 现有 session meta / messages / plan mode / task snapshot 测试更新到新路径。

## 5. Relevant Memory Prefetch

### 5.1 当前问题

当前 `dclaw` 在 system prompt resolver 中同步调用 `loadPromptMemoryContext`。这意味着：

- recall selector 会进入用户请求首轮延迟路径
- recall 结果被揉进 system prompt，而不是作为可追踪 attachment
- 缺少 turn-level abort / dispose 语义
- 缺少“如果 prefetch 未完成，本 iteration 先跳过，下个 iteration 再消费”的机制

### 5.2 目标形态

新增 turn-level memory prefetch：

```text
submitUserPrompt
  -> startRelevantMemoryPrefetch(baseMessages, toolContext, latestUserPrompt)
  -> main model request proceeds
  -> after tool results / before next model iteration:
       if prefetch settled:
         filter duplicate surfaced memories
         append relevant_memories transient attachment messages
       else:
         skip now; retry consume on next iteration
  -> dispose / abort on query exit
```

### 5.3 数据结构建议

```ts
type MemoryPrefetch = {
  promise: Promise<MemoryAttachment[]>
  settledAt: number | null
  consumedOnIteration: number
  abortController: AbortController
  dispose(): void
}

type MemoryAttachment = {
  type: 'relevant_memories'
  memories: Array<{
    path: string
    relativePath: string
    content: string
    mtimeMs: number
    header: string
    limit?: number
  }>
}
```

### 5.4 Selector 输入

继续使用现有 side-query selector，但扩展输入：

- latest user prompt
- memory manifest
- recent successful tools
- already surfaced paths

recent tools 的目的不是提升召回，而是降低噪声：如果模型已经成功使用某个工具，不要再召回该工具的普通 usage reference；但 warnings、gotchas、known issues 仍可召回。

### 5.5 注入方式

新增 transient message：

```text
<system-reminder>
Memory (saved today): /path/to/memory.md:

...
</system-reminder>
```

不要把 prefetch 结果写入真实 session history，除非当前架构需要通过 transcript 保留 surfaced memory 状态。若写入，应标记为 transient/meta，并在 compact 后有清晰恢复策略。

### 5.6 验收标准

- memory selector 不阻塞首轮 system prompt 构建。
- prefetch 未完成时，本轮不等待。
- prefetch 结果最多消费一次。
- 用户中断 query 时，prefetch 被 abort。
- trace 中能看到 start / success / failure / consumed iteration。

## 6. Surfaced Memory 去重与节流

### 6.1 当前问题

当前 `dclaw` 每轮基于 manifest 重新选择 memory，缺少 session 内 surfaced 状态：

- 同一 memory 可能被多轮重复注入
- selector 的 5 个名额可能浪费在已看过的 memory 上
- 缺少 session total memory bytes throttle
- 缺少与 readState 的联动

### 6.2 目标形态

在 query engine 层维护或从 messages 中恢复 surfaced memory 状态：

```ts
type SurfacedMemoryState = {
  paths: Set<string>
  totalBytes: number
}
```

去重来源：

- 已 surfaced attachment 的 paths
- 当前 turn 或历史 readState 中已 Read / Write / Edit 的 memory file
- 当前 prefetch 已标记消费的 paths

节流建议：

- 单次最多 5 条
- 单条沿用现有 `MAX_RECALLED_MEMORY_LINES` / `MAX_RECALLED_MEMORY_BYTES`
- session total bytes 设软上限，例如 32KB 或 64KB，后续按模型上下文窗口调参

### 6.3 staleness header

每条 recalled memory 注入时带 freshness 提示：

- today / yesterday：轻提示
- 超过 1 天：明确提示 memory 是 point-in-time observation
- 如果 memory 引用代码文件、函数、flag，回答前应读取当前代码验证

示例：

```text
This memory is 47 days old. Memories are point-in-time observations, not live state. Verify against current code before asserting as fact.

Memory: /path/to/memory.md:
```

### 6.4 验收标准

- 同一 session 内已 surfaced memory 不会重复注入。
- 如果用户或模型显式 Read 了某 memory 文件，prefetch 不再重复注入。
- session total memory bytes 达上限后停止自动注入 relevant memories。
- compact 后 surfaced 状态有明确行为：可以重置，也可以从 post-compact attachments 恢复；第一版建议重置。

## 7. Session Memory

### 7.1 为什么需要

session history 是原始日志；compact summary 是临界点压缩产物；session memory 是长会话中持续维护的滚动结构化工作笔记。

它解决的问题：

- 不等上下文接近上限时才抢救式总结。
- 将总结工作摊到多个 turn 后台执行。
- 保留当前状态、错误纠正、重要文件、命令流程等 compact 容易压掉的信息。
- compact 时优先使用已整理好的 session memory。
- resume 时提供更稳定的继续工作状态。

### 7.2 文件路径

建议路径：

```text
<DCLAW_HOME>/projects/<sanitized-workspace>/sessions/<session-id>/session-memory.md
```

该路径依赖 `Workspace-scoped Session Storage` 先落地。关键要求：

- session-scoped
- 不跨 session recall
- resume 同一 session 时可找到
- clear / fork / branch 行为明确

### 7.3 模板

首版固定模板：

```markdown
# Session Title
_Short distinctive title._

# Current State
_What is actively being worked on now? Immediate next steps._

# Task Specification
_What did the user ask to build or answer? Important decisions._

# Files and Functions
_Important files/functions and why they matter._

# Workflow
_Commands run, expected order, and how to interpret output._

# Errors and Corrections
_Errors encountered, failed approaches, user corrections._

# Key Results
_Exact outputs or answers the user asked for._

# Worklog
_Terse chronological worklog._
```

### 7.4 更新触发

建议配置：

```ts
type SessionMemoryConfig = {
  minimumMessageTokensToInit: number
  minimumTokensBetweenUpdate: number
  toolCallsBetweenUpdates: number
}
```

首版默认：

- `minimumMessageTokensToInit`: 10000
- `minimumTokensBetweenUpdate`: 5000
- `toolCallsBetweenUpdates`: 3

触发条件：

- 仅主 session
- 非 subagent
- auto compact 开启时启用
- 达到初始化 token 阈值后开始
- 每次 context window 增长超过阈值，且工具调用数量达到阈值，或最近 assistant turn 无工具调用时更新

### 7.5 更新方式

使用 forked single-purpose agent：

- 输入：当前 session memory 文件内容 + 当前 conversation
- 工具：只允许 Edit 当前 session memory 文件
- 禁止调用其他工具
- 更新后记录 last summarized message id
- 更新过程不进入主 conversation
- 若更新正在进行，compact 前最多等待短时间，例如 15s

### 7.6 compact 集成

auto compact 时优先尝试 session memory compact：

1. 检查 feature/config gate。
2. 等待 in-flight session memory extraction。
3. 读取 session memory。
4. 如果不存在或仍是模板，回退现有 compact。
5. 基于 `lastSummarizedMessageId` 计算需要保留的 suffix messages。
6. 将 session memory 转成 compact summary message。
7. 如果 post-compact token 仍超过阈值，回退现有 compact。

### 7.7 resume / fork / clear 语义

- resume 同一 session：复用 session memory。
- fork session：默认复制当前 session memory 到新 session，并追加 fork note；也可第一版不复制，等后续完善。
- clear context：保留 transcript，但新 context 是否保留 session memory 需要产品决策；第一版建议保留并追加 clear boundary note。
- new session：不读取旧 session memory。

### 7.8 验收标准

- 长会话达到阈值后生成 session-memory.md。
- 后续 turn 会更新 Current State 和 Worklog。
- compact 时优先使用 session memory。
- session memory 不参与 long-term memory recall。
- session memory 更新失败不影响主对话。

## 8. 遗忘与整理机制

### 8.1 三层机制

#### 显式遗忘

用户明确说“忘记 X”时：

- 主 agent 或 extraction agent 应定位相关 memory
- 删除或改写 memory 正文
- 更新 `MEMORY.md` 索引
- 添加 transcript-only system note，说明修改了哪些 memory 文件

#### 机会性纠错

增量 extraction 可以处理最近消息中明确出现的纠错信号：

- “之前那个记忆不对”
- “现在流程改了”
- “不要再记 X”
- “X 已废弃”

但 extraction 不应主动巡检旧 memory。建议 prompt 增加硬约束：

```text
Only remove or rewrite an existing memory when the recent conversation explicitly says it is wrong, obsolete, or should be forgotten. Do not proactively prune older memories.
```

#### 周期性整理

后续引入 autoDream 类机制：

- 低频触发
- 读取 memory 目录和 `MEMORY.md`
- 必要时窄搜索当前 workspace session transcripts
- 合并重复 memory
- 修正矛盾
- 删除 stale / wrong / superseded pointers
- 缩短过长索引项

### 8.2 /memory 管理入口

新增或扩展 slash command：

- 打开 `MEMORY.md`
- 打开 auto-memory folder
- 打开 session memory 文件
- 显示 memory dir 路径

第一版可以只打开文件/目录，不做 TUI 内编辑器。

### 8.3 autoDream 设计草案

触发条件建议参考 Claude Code：

- auto memory enabled
- 非 remote / 非 bare
- 距离上次 consolidation 至少 `minHours`，默认 24
- 当前 workspace session transcript 中，上次 consolidation 后至少 `minSessions` 个 session 被更新，默认 5
- memory dir lock 未被其他进程持有

session 判断：

- 只看当前 workspace/project transcript 目录
- 使用 session `.jsonl` 文件 mtime 判断 touched since
- 排除当前 session
- 这是 cheap gate，不读取 transcript 内容判断是否真的有新信息
- 该判断依赖 workspace-scoped session storage；不能使用全局 `<DCLAW_HOME>/sessions`。

执行阶段：

1. Orient：读取 memory 目录、`MEMORY.md`、已有 topic files。
2. Gather：查看 daily logs 或窄搜索 session transcripts。
3. Consolidate：合并重复、更新 topic files、把相对日期转绝对日期。
4. Prune：更新 `MEMORY.md`，移除 stale/wrong/superseded pointers，解决矛盾。

权限：

- Read / Grep / Glob 允许
- Bash 仅 read-only
- Edit / Write 仅 memory dir
- 不允许任意 rm

### 8.4 验收标准

- 用户显式“忘记”能导致对应 memory 被更新或移除。
- extraction 不会无依据主动删除旧 memory。
- autoDream 不会在每 turn 跑；必须满足时间、session 数和 lock gate。
- autoDream 修改后有 transcript-only system note。

## 9. 分阶段实施计划

状态约定：

- `[ ]` 未开始
- `[~]` 进行中
- `[x]` 已完成

维护规则：

- 每完成一个任务或测试项，都要在同一次实现提交中更新本节状态。
- 若任务拆分或范围变化，应先更新本节，再继续实现。
- 一个 Phase 的所有任务与测试均为 `[x]` 后，才可将该 Phase 视为完成。

### Phase 0：Session 存储 workspace 化

目标：让 session transcript / meta 与 memory 一样按 workspace/project 分目录，为 session memory 和 autoDream 打基础。

任务：

- [x] 复用 memory project key 规则，新增 project sessions path API。
- [x] 修改 session create / append / read / resume / history 路径。
- [x] 修改 agent session / subagent transcript 路径。
- [x] 默认 resume 列表改为当前 workspace sessions。
- [x] 指定 session id resume 只查当前 workspace project。
- [x] 更新 doctor / docs / tests 中的 session 路径说明。

测试：

- [x] `getSessionMessagesPath` 新路径包含 `projects/<workspace>/sessions/<id>`。
- [x] 两个 workspace 下创建 session，默认 resume 列表互不污染。
- [x] 不保留 legacy `<DCLAW_HOME>/sessions/<id>` 显式 resume。
- [x] subagent 文件写在 parent workspace session 目录下。

### Phase 0.1：Runtime Artifact 存储 workspace 化

目标：让 plan file、task board、execution task board、query trace 与 session 一样进入 workspace/project namespace，避免跨 workspace 污染调试与恢复状态。

任务：

- [x] session plan file 改为 session-scoped `plan.md`。
- [x] plan board 新写入 workspace project 目录。
- [x] execution task board 新写入 workspace project 目录。
- [x] query trace 新写入 workspace project 目录。
- [x] plan/task/query trace 不保留 legacy 全局目录 fallback。
- [x] doctor 输出 workspace 级 artifact 路径。

测试：

- [x] project path API 覆盖 plan board / execution task board。
- [x] query trace path 可按 workspace project 生成。
- [x] older board schema fixture 可在 project 目录内读取 / 重写。
- [x] session plan mode 测试使用 session-scoped plan file。

### Phase 1：Surfaced 去重与 freshness

目标：先控制重复注入和 stale 风险，改动范围小。

任务：

- [x] 新增 surfaced memory 状态收集。
- [x] recalled memory 注入 header 增加 freshness/staleness 信息。
- [x] 将 readState 与 surfaced paths 用于过滤重复 memory。
- [x] 增加 session total bytes throttle。

测试：

- [x] 同一 memory 不重复注入。
- [x] Read 过的 memory 不再被 relevant recall 注入。
- [x] stale memory header 包含 verify 提示。
- [x] session bytes 超限后停止注入。

### Phase 2：Relevant Memory Prefetch

目标：把 recall 从 system prompt resolver 挪到 query loop 非阻塞路径。

任务：

- [x] 新增 `startRelevantMemoryPrefetch`。
- [x] QueryEngine submit loop 持有 prefetch handle。
- [x] 在 tool result 后或下一 iteration 前消费 settled prefetch。
- [x] selector 输入加入 recent successful tools 和 already surfaced paths。
- [x] query abort 时终止 prefetch。

测试：

- [x] selector promise 未完成时 query 不等待。
- [x] settled prefetch 被消费为 transient reminder。
- [x] abort 后不追加 memory。
- [x] recent tools 被传入 selector prompt。

### Phase 3：Session Memory

目标：为 compact / resume 提供滚动结构化会话状态。

任务：

- [x] 新增 `src/sessionMemory/` 或 `src/session/sessionMemory.ts`。
- [x] 建立 session-memory.md 路径、模板、读写工具。
- [x] turn complete 后按阈值后台更新。
- [x] compact 前尝试使用 session memory。
- [x] resume 时恢复 session memory path。

测试：

- [x] 达阈值后创建 session-memory.md。
- [x] session memory 更新任务只允许通过受限工具集 Read/Edit 修改当前 session 的 session-memory.md
- [x] compact 优先使用 session memory。
- [x] session memory 为空或模板时回退现有 compact。
- [x] in-flight update compact 前最多等待指定 timeout。

### Phase 3.1：Session Memory Checkpoint 与增量 Compact

目标：补齐 session memory 的覆盖边界语义，让 compact 可以使用“已整理 session memory + 未覆盖 transcript 尾部”，避免重复 compact 已经被 session memory 吸收的历史。

Claude Code 参考行为：

- `lastSummarizedMessageId` 是 `SessionMemory/sessionMemoryUtils.ts` 中的模块级运行时状态，不是写入 `session-memory.md` 的字段。
- session memory extraction 成功后会尝试记录 `lastSummarizedMessageId`，表示 session memory 已覆盖到该消息。
- 该记录有安全条件：只有最后一个 assistant turn 没有 tool calls 时才设置，避免 compact 时裁掉 tool_use 而留下 orphaned tool_result。
- 手动 session memory extraction 成功后也会走同样的安全记录逻辑。
- 该 id 只在当前进程共享状态中维护；resume 后若 id 不存在但 session memory 有内容，会走 resumed-session fallback。
- session-memory compact 先等待 in-flight extraction，读取 session memory；若不存在或还是模板，回退传统 compact。
- 若 `lastSummarizedMessageId` 存在且能在当前 messages 中找到，从该消息之后开始保留 transcript 尾部。
- 若 `lastSummarizedMessageId` 不存在但 session memory 有内容，按 resumed-session 处理：以 session memory 作为 summary，尾部 transcript 从空开始再按最小保留规则向前扩展。
- 保留尾部不是简单 slice：会向前扩展到满足 `minTokens`、`minTextBlockMessages`，并受 `maxTokens` 上限约束。
- 保留尾部还会修正 API 不变量：不能拆散 tool_use/tool_result 配对，也不能拆散同一个 assistant message id 下的 thinking/tool_use 分片。
- compact boundary 会记录 preserved segment 元数据，确保 resume/transcript 持久化时能保留 summary 后面的尾部消息链。
- compact 成功后会清空 `lastSummarizedMessageId`，因为旧 id 可能已经被 compact 后的消息数组裁掉。

dclaw 设计参考：

- dclaw 可以比 Claude Code 更显式：把 checkpoint 持久化到 session meta，而不是只放进进程内状态。
- checkpoint 不能在任意消息后更新；必须定义“安全覆盖边界”。
- 第一版安全边界建议：最新消息不能是未配对的 assistant tool_use，也不能处于 tool_use/tool_result 配对中间。
- 如果当前 turn 最后仍有工具调用链，session memory 可以更新正文，但不要推进 `coveredMessageId`。
- compact 使用 checkpoint 前必须校验该 message id 仍存在于当前 compact 输入；找不到时回退传统 compact。
- checkpoint 持久化后，resume 可以恢复增量 compact 能力；这点会强于 Claude Code 的纯运行时状态。
- compact 成功后必须清空或重写 checkpoint，避免后续引用被裁掉的旧消息。

dclaw 当前差距：

- `lastProcessedMessageId` 只存在于 `createSessionMemoryUpdater` 进程内，用于避免重复更新；没有暴露给 compact。
- `session-memory.md` 没有持久化覆盖到哪个 message id。
- `compactSession` 当前是“session memory + 全量传入 transcript”，还不是“session memory + uncovered transcript”。
- compact 后没有 preserved segment 语义；dclaw 目前 compact 后只保留 boundary + summary。

任务：

- [x] 为 session memory 增加 checkpoint 数据模型，至少包含 `coveredMessageId`、`coveredAt`、`updatedAt`。
- [x] 决定 checkpoint 存储位置：优先写入 session meta，避免污染 `session-memory.md` 正文；必要时同时支持 frontmatter。
- [x] session memory 更新成功后持久化 `coveredMessageId`。
- [x] compact 前读取 session memory checkpoint，并计算 uncovered transcript。
- [x] 实现 `calculateSessionMemoryMessagesToKeep`：从 checkpoint 后一条开始，按最小 token / text message 数向前扩展。
- [x] 实现 API 边界修正：避免拆散 tool_use/tool_result 配对。
- [x] 实现 assistant 分片边界修正：避免拆散同一 assistant message id 的 reasoning/thinking/tool_use 分片。
- [x] session memory checkpoint 找不到对应消息时，回退传统 compact，或显式走 resumed-session fallback；第一版建议回退传统 compact，避免误裁历史。
- [x] compact prompt 改为使用 `session memory + messagesToKeep`，不再重复输入 checkpoint 前的 transcript。
- [x] compact 成功后清空或更新 checkpoint，避免下一次 compact 引用已被裁掉的旧 message id。
- [x] query trace 记录 session memory compact 的 checkpoint、messagesToKeep 数量、fallback 原因。
- [x] 评估是否需要 dclaw 版 preserved segment；如果仍然只保留 boundary + summary + tail messages，则要确保 transcript/store/resume 不会丢 tail。

测试：

- [x] session memory 更新成功后 session meta 记录 `coveredMessageId`。
- [x] compact 只把 checkpoint 后的 transcript 尾部传入 summarizer。
- [x] checkpoint 前的大段历史不会重复进入 compact prompt。
- [x] checkpoint 找不到消息时回退传统 compact。
- [x] session memory 为空或模板时仍回退传统 compact。
- [x] messagesToKeep 至少满足最小 token / text message 保留规则。
- [x] messagesToKeep 不拆散 tool_use/tool_result。
- [x] messagesToKeep 不拆散同一 assistant message id 的分片。
- [x] compact 成功后 checkpoint 被清空或更新。
- [x] resume 后 session memory path 与 checkpoint 状态恢复一致。

### Phase 4：显式遗忘与 /memory

目标：补齐用户可控的 memory 管理与可测试遗忘路径。

任务：

- [ ] memory extraction prompt 加强显式 forget 规则。
- [ ] 增加 forget 行为测试：删除正文、更新索引。
- [ ] 新增 `/memory` 最小命令，打开 memory 文件/目录。
- [ ] 成功修改后追加 transcript-only note。

测试：

- [ ] “忘记 X”会定位并修改已有 memory。
- [ ] `MEMORY.md` 不留下 orphan pointer。
- [ ] `/memory` 能创建并打开缺失的 `MEMORY.md`。

### Phase 5：autoDream

目标：低频整理长期 memory，避免增量堆积。

任务：

- [ ] 新增 consolidation lock。
- [ ] 实现 lastConsolidatedAt mtime 语义。
- [ ] 扫描当前 workspace session transcripts，按 mtime 计算 touched session 数。
- [ ] 实现 dream forked agent。
- [ ] 约束工具权限。
- [ ] 记录 improved memory system note。

测试：

- [ ] minHours 未满足不触发。
- [ ] minSessions 未满足不触发。
- [ ] 当前 session 被排除。
- [ ] lock 持有时不触发。
- [ ] 触发后调用 forked agent，使用 consolidation prompt。

## 10. 风险与约束

- Session 路径 workspace 化会影响 resume、history、agent session、plan/task 文件引用，必须分清新写路径与 legacy 读取路径。
- Prefetch 注入时机要避免破坏 tool_use / tool_result 配对。
- Surfaced state 如果持久化到 transcript，compact / resume 需要明确恢复策略。
- Session memory 不应被误当作长期 memory，否则会污染未来 session。
- Extraction 遗忘必须严格基于最近消息中的明确证据。
- autoDream 使用 transcript search 时必须限制范围，避免大文件 OOM。
- memory 写权限 carve-out 必须只覆盖 memory dir，不扩大到任意用户目录。

## 11. 推荐优先级

建议按以下顺序推进：

0. Session 存储 workspace 化
1. Surfaced 去重 + freshness header
2. Relevant memory prefetch
3. Session memory + compact 接入
4. 显式遗忘 + `/memory`
5. autoDream

这个顺序先降低 recall 噪声和延迟，再增强长会话连续性，最后补长期 memory 的整理能力。
