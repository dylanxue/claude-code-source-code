# Agent Study Handoff

这份文档用于跨设备继续 `agent-study` 项目，重点记录当前学习进度、关键约定和下一步工作。

## 当前进度

- 已完成 `lesson1` 到 `lesson14`
- 当前主工作目录：`agent-study/lesson14`
- 下一课工作目录：待定
- 当前主题：`Agent / Delegation Runtime`
- 下一主题：优先推进 `worker-style lifecycle`，其次才是 `MCP / ReadMcpResource`

## 2026-04-15 今日工作

- 继续把 `lesson14` 从“教学版 delegation demo”推进成更接近 Claude Code 的真实 orchestration runtime
- 明确固定两条总原则：
  - 我们不是在做“教学 agent”，而是在用课程式拆解实现顶级 agent
  - 在可行前提下，无穷靠近 Claude Code 的实现
- 把 `TaskPacket` 扩成更接近 Claude Code 的结构化任务形状：
  - 支持 `repo`
  - 支持 `branch_policy`
  - 支持 `acceptance_tests`
  - 支持 `commit_policy`
  - 支持 `reporting_contract`
  - 支持 `escalation_policy`
- 新增 `TaskCreate` 和 `RunTaskPacket`，让 lesson14 有更像 Claude Code 的结构化任务入口
- 把 `Agent` 从同步执行推进成真正的后台 spawn 语义：
  - `Agent` 现在先返回 `running` manifest
  - 后台 subagent 自行完成并更新 registry / manifest / output
  - `TaskGet / TaskOutput / TaskStop` 成为主要查询与控制面
- 给后台 subagent 补上停止态保护：
  - `TaskStop` 后不会再被后台执行误覆盖成 `completed`
- 给 subagent manifest 补上更接近 Claude Code 的轨迹字段：
  - `laneEvents`
  - `currentBlocker`
  - `derivedState`
- 新增最小可用的 worker-style lifecycle：
  - `WorkerCreate`
  - `WorkerGet`
  - `WorkerAwaitReady`
  - `WorkerSendPrompt`
- worker 现在具备最小状态机：
  - `spawning`
  - `ready_for_prompt`
  - `running`
  - `finished`
  - `failed`
- worker 控制面状态会落到：
  - `.dclaw/workers/<workspace_hash>/<worker_id>/manifest.json`
  - `.dclaw/workers/<workspace_hash>/<worker_id>/worker-state.json`
- worker prompt 交付阶段会复用现有 `TaskRegistry / Agent` 执行底座：
  - 发送 prompt 后仍然走既有 subagent runtime、task registry 和 agent artifact 落盘
- 当前 lesson14 已具备的关键能力：
  - role-scoped subagent runtime
  - `Plan` 结果回流成 `planState`
  - `TaskRegistry`
  - `TaskCreate / RunTaskPacket / TaskGet / TaskList / TaskStop / TaskUpdate / TaskOutput`
  - 后台 `Agent`
  - ready-handshake `Worker*` 控制面
  - lane-style subagent manifest
- 最新验证结果：
  - `cd agent-study/lesson14 && npm test`
  - `cd agent-study/lesson14 && npm run smoke`
  - 当前均通过，测试计数为 `100/100`
- 关键失败回归用例：
  - `cd agent-study/lesson14 && npm start -- "逐个分析lesson1至lesson5的功能说明和代码实现,判断是否匹配,如有必要请使用Agent委托合适的子代理"`
  - 这条命令到今天为止从未稳定成功过
  - 明天必须优先解决这条真实长任务链路

## 下一步计划

- P0：解决这条真实失败回归，直到能够稳定完成：
  - `cd agent-study/lesson14 && npm start -- "逐个分析lesson1至lesson5的功能说明和代码实现,判断是否匹配,如有必要请使用Agent委托合适的子代理"`
- P0：用新的 `Worker*` 控制面去驱动并稳定跑通真实失败回归
- P0：评估是否需要让主 agent 的系统提示更强地偏向 worker ready-handshake，而不是优先走旧 `Agent`
- P1：继续向 Claude Code 的 `worker_boot` 靠拢
  - `trust_required`
  - `WorkerResolveTrust`
  - `WorkerObserve`
  - `WorkerRestart`
  - `WorkerObserveCompletion`
- P1：等 worker 控制面稳定后，再评估是否进入 `lesson15`

## 架构原则

- 这是一个按课程快照组织的 Node.js coding agent 学习项目
- 每一课都是上一课的独立副本，不回改旧课
- 遇到架构决策时，优先参考 Claude Code / 当前仓库下 Claude Code 的实现
- 设计原则之二：在可行前提下，无穷靠近 Claude Code 的实现
- 不只参考概念命名，更尽量贴近它的 runtime 原语、状态模型、工具边界、生命周期和 orchestration 方式
- 如果某一课暂时不能直接达到 Claude Code 的复杂度，也应优先保持接口形状、数据结构和演进方向一致，而不是为了局部简单引入偏离主线的替代方案
- 阶段性偏离必须可解释、可追踪，并明确后续回收路径
- 我们不是在做“教学 agent”，而是在用课程式拆解来实现一个顶级 agent
- 教学只是实现和讲解方式，不是产品定位；当教学便利与产品级 agent 架构冲突时，优先选择后者
- 优先建设真实 runtime 原语、结构化状态、可观察 orchestration 和可恢复任务流，而不是为了演示方便长期停留在 demo 级实现

## 课程状态

- `lesson1`
  最小可运行 agent
- `lesson2`
  工具层与多步 runtime
- `lesson3`
  真实 LLM adapter
- `lesson4`
  session persistence 与 resume
- `lesson5`
  session compaction 与 summary continuation
- `lesson6`
  streaming runtime foundations
- `lesson7`
  compaction hardening
- `lesson8`
  context budget controls（主线已跑通，正在收口）
- `lesson9`
  factual tool signals（lesson9 当前已进一步向 Claude Code 靠拢：tool 主要返回 `truncated / omitted / reason / limit / fileBytes` 这类事实信号；runtime 不再解析 continuation，也不再在写回 session 前统一做 tool-result budget，而是让 tool result 直接进入 session，后续由 compaction 负责压缩；同时只为高成本 direct-file-dump 绕路保留最小 guardrail，并已抽成 lesson9 本地 `PreToolUse` 风格接口）
  当前设计原则已收敛为：`Facts-first, guardrails-for-high-cost-boundaries`
  当前最明确的 tool 功能差距待办：
  - P0：把 `read_file` 升级成 `offset / limit / startLine / totalLines / numLines`
  - P0：把 `grep_text` 升级成更像 `grep_search` 的接口（regex / glob / context / offset / head_limit / file type）
  - P0：补独立 `glob_search`
  - P1：补 `edit_file`，并让写入/编辑结果返回 `structured_patch`
  - P1：增强 `bash` 的 timeout / background / sandbox 选项
  - P2：后续课程逐步补 `WebFetch / WebSearch / ToolSearch / Skill / Agent / MCP / LSP / TodoWrite / NotebookEdit`
- `lesson10`
  runtime decision loop（lesson10 在 lesson9 的 orchestration 基础上，开始把 runtime 自己每轮的 decision 显式化：`model_decision`、`tool_results`、stop/continue 轨迹都会进入 `decisionJournal`，并通过 `runtime_decision` event 暴露出来，方便直接观察 agent 为什么继续、为什么停止）
  当前设计原则已收敛为：`Observe the runtime loop before redesigning it`
  当前最明确的后续候选：
  - P0：评估 `Pinned Context / Retained Messages`
  - P0：梳理 turn-level stop / continue heuristics
  - P1：决定哪些 runtime decision signal 值得跨 compaction 保留
- `lesson11`
  web search / web fetch（lesson11 在 lesson10 的 runtime orchestration 之上，补上了显式的外部知识通道：当问题需要当前信息、网页内容或 workspace 外事实时，agent 可以优先走 `WebSearch` / `WebFetch`，而不是把 `bash` 当成跨边界兜底工具）
  当前设计原则已收敛为：`Use explicit external-knowledge tools instead of shell workarounds`
  当前最明确的后续候选：
  - P0：决定 search result citation 如何更稳定地进入最终回答
  - P0：评估 `ToolSearch / Skill / Agent / MCP` 的下一课切入顺序
  - P1：梳理外部工具结果在 compaction 后的保留策略
- `lesson12`
  tool search / capability discovery（lesson12 在 lesson11 的工具面之上，补上显式能力发现层：当 agent 不确定该用哪个工具时，可以先用 `ToolSearch` 检索当前工具名、family 和 description，而不是完全依赖 prompt 和记忆）
  当前设计原则已收敛为：`Discover capabilities before guessing tool names`
  当前最明确的后续候选：
  - P0：继续引入 `Skill`
  - P0：评估 `MCP / ReadMcpResource`
  - P1：决定 capability discovery 如何和未来动态工具面一起工作
- `lesson13`
  skill / reusable workflows（lesson13 在 lesson12 的 capability discovery 之上，补上本地可复用工作流层：agent 可以按 Claude Code 风格从项目技能目录、`~/.codex/skills` 和兼容 commands 目录里解析 Skill，并把技能内容作为显式 prompt 资产读出来）
  当前设计原则已收敛为：`Load reusable workflows instead of re-inventing them each turn`
  当前最明确的后续候选：
  - P0：继续引入 `Agent`
  - P0：评估 `MCP / ReadMcpResource`
  - P1：决定 Skill 与 ToolSearch 的联动方式是否需要更自动化
- `lesson14`
  agent / delegation runtime（lesson14 在 lesson13 的 reusable workflow 之上，已经补上更接近 Claude Code 的显式 delegation 层：主 agent 可以通过 `Agent` 工具创建后台 subagent，按 `Explore / Plan / general-purpose / Verification` 角色限制子 agent 工具面、独立 session、独立 task/manifest/output 落盘，并通过 registry 查询和控制任务状态）
  当前设计原则已收敛为：`Delegate bounded work to role-scoped subagent runtimes`
  当前最明确的后续候选：
  - P0：继续引入 `worker-style lifecycle`
  - P0：评估 `MCP / ReadMcpResource`
  - P1：再决定是否显式补 `send_input / wait / close`

## lesson6 当前实现

`lesson6` 已经具备这些能力：

- Anthropic-compatible adapter 默认请求 `stream: true`
- `src/model/streaming-sse.js` 解析 SSE
- `src/model/anthropic-messages-model.js` 组装 `text_delta` / `tool_use`
- streaming event 会先进入 `AgentRuntime`
- CLI 会消费 runtime 事件并打印：
  - `[tool_use] ...`
  - `[message_stop] ...`
- 加入了 `LLM_REQUEST_TIMEOUT_MS`，避免 SSE 卡住时无限挂起

## lesson6 关键文件

- `agent-study/lesson6/src/model/streaming-sse.js`
- `agent-study/lesson6/src/model/anthropic-messages-model.js`
- `agent-study/lesson6/src/core/agent-runtime.js`
- `agent-study/lesson6/src/index.js`
- `agent-study/lesson6/docs/06-streaming-runtime.md`

## 运行方式

基础运行：

```bash
cd agent-study/lesson6
npm start -- "请简短总结 lesson6 的重点"
```

关闭 streaming：

```bash
cd agent-study/lesson6
LLM_STREAM=false npm start -- "请简短总结 lesson6 的重点"
```

缩短请求超时，便于排查挂流问题：

```bash
cd agent-study/lesson6
LLM_REQUEST_TIMEOUT_MS=15000 npm start -- "总结一下lesson6的内容,以及下步要做什么"
```

## 配置说明

本地模型配置依赖各课目录下的 `.env.local`，这些文件默认不进 git。

如果换电脑，需要自行补齐：

- `agent-study/lesson6/.env.local`
- `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL`
- 或
- `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL`

当前 lesson6 的主要验证链路通常走 `MODEL_PROVIDER=anthropic`。

## 已知现状

- streaming 文本已经能实时打印
- `tool_use` / `message_stop` 已经能实时打印
- 最终回答现在优先直接作为 assistant 文本收口，而不是依赖 `final_answer` 工具
- 某些兼容网关会在 tool result 后不继续返回 SSE；目前已用请求超时保护兜底，但还没有“流式空闲超时”

## 今日完成的工作

今天主要做了两类事情：

### 1. 把 lesson6 打磨成更完整的 streaming 课程

- CLI 现在会显示：
  - `[reasoning]`
  - `[assistant]`
  - `[tool_use]`
  - `[message_stop]`
- 支持 `LLM_STREAM_DEBUG`：
  - `off`
  - `meta`
  - `true`
- 增加了 `cli-run` 日志，并且和 `llm-trace`、`run-summary` 通过同一个 `Run ID` 串联
- 支持 mixed content：
  - `tool_use` 同轮的 text 不再丢失
  - reasoning 不再丢失
- 最终回答改成“无 tool_use 即收口”，不再依赖 `final_answer` 工具

### 2. 把 compaction hardening 从 lesson6 拆到 lesson7

- 今天一度实现并验证了：
  - usage 透传
  - usage-driven auto compact
  - forced compaction on context-limit
- 但后来确认这部分会让 lesson6 主题过重
- 所以最终决定：
  - lesson6 只保留 streaming runtime 相关改造
  - lesson7 专门承接 compaction hardening

目前 `lesson7` 已经创建为下一课骨架，并补好了：

- `agent-study/lesson7/README.md`
- `agent-study/lesson7/docs/07-compaction-hardening.md`

为了继续向 Claude Code 对齐，当前已经把 `lesson8` 起始目录建好：

- `agent-study/lesson8/README.md`
- `agent-study/lesson8/docs/08-context-budget-controls.md`

lesson8 的主线不再是继续微调 compact 阈值，而是把这些系统能力补上：

- 搜索 / 工具结果的输出预算控制
- tool result 写回 session 前的统一裁剪 / truncation
- request budget、tool budget、summary budget 的更清晰联动
- 为后续 pinned / persisted context 留出更自然的结构位置

这里也先固定一个边界：

- lesson8 暂时不把完整 `pin message` 一起做掉
- 更合适的拆法是：lesson8 先解决 budget control，后续再单独做 pinned context / retained messages

补充一个最新验证：

- `run-2026-04-13T00-30-11-433Z-8ec582` 是一次在 `agent-study/lesson7` 下的真实 Anthropic-compatible run
- 这次 run 已经明确拿到了每轮 `input_tokens`
- `providerUsageMode` / `compactionMode` 也都进入了 `"provider_usage"`
- 说明当前 minimax Anthropic-compatible 链路下，真实 input usage 已经至少在这次实验中打通
- 这次没有触发 compact，主要因为阈值仍然是 `100000`，而累计 `inputTokens` 只有 `11249`

## lesson6 当前边界

lesson6 现在明确只覆盖这些内容：

- SSE 解析
- streaming text / reasoning / tool_use 处理
- CLI 流式展示与调试
- runtime 事件开始进入 CLI
- “无 tool_use 即收口”的结束语义

这些内容已经明确不放在 lesson6，而顺延到 lesson7：

- usage-driven auto compaction
- forced compaction on context-limit
- provider 不返回 `input_tokens` 时的 fallback 策略

同时也要注意，关于 “Anthropic-compatible 一定拿不到 `input_tokens`” 这件事，当前已经不能再当成固定前提：

- 更准确的判断应改成“是否拿得到真实 input usage，取决于当前 provider / gateway 的实际返回”
- 如果返回了，lesson7 现有 runtime 已经能按 provider usage 主路径工作
- 如果没返回，再走 fallback

而 lesson7 之后进入 lesson8，当时最明确的差距是：

- 还没有系统级的 tool-result budget control
- 还没有统一的超大 tool result 裁剪层
- 还没有“关键上下文跨 compaction 保留”的显式能力

lesson9 最终没有停在“声明式 continuation policy”这条重路线，而是继续收敛成了：

- factual tool signals
- 最小 `PreToolUse` guardrail
- tool result 直接进入 session，由 compaction 处理后续压缩

而 `pinned context / retained messages` 这条线现在更适合作为 lesson9 之后的下一候选主题：

- pinned context / retained messages
- `/pin` / `/unpin`
- compaction 与 retention policy 的优先级规则

## 换电脑后建议先做什么

换电脑后，推荐按这个顺序恢复：

1. 补齐本地配置
2. 先确认 `lesson6` 能正常跑
3. 再进入 `lesson7`

建议先跑：

```bash
cd agent-study/lesson6
npm start -- "请简短总结 lesson6 的重点"
```

如果要验证 streaming 展示边界，可以再跑：

```bash
cd agent-study/lesson6
LLM_STREAM_DEBUG=meta npm start -- "先用一句话说明你准备怎么做，再查找并总结 lesson6 的重点"
```

然后再进入：

```bash
cd agent-study/lesson7
npm start -- --resume latest "继续刚才的任务，并尽量多读一些内容后再总结"
```

确认 lesson7 没问题后，下一步直接进入：

```bash
cd agent-study/lesson8
npm start -- "搜索 lesson7 里关于 Claude Code 差距的记录，并总结 lesson8 应先补哪一块"
```

## 下一步建议

更接近 Claude Code 的下一步建议是：

1. 把 `lesson9` 的基础 tool 做深，而不是继续扩 runtime 策略层
2. 优先补 `read_file` 的 `offset / limit / startLine / totalLines / numLines`
3. 把 `grep_text` 升级成更像 `grep_search` 的接口
4. 补独立 `glob_search` 与 `edit_file`
5. 让 `bash` 继续向 timeout / background / sandbox 选项靠拢
6. 在后续课程评估 `pinned context / retained messages`

## Lesson7 Deferred Backlog

lesson7 当前有一个明确记录、但暂时后置的问题：

- 搜索类工具和超大 tool result 的输出预算控制

已经出现过一次真实案例：

- `grep_text("lesson7")` 命中大量运行产物与日志内容
- 巨大 tool result 被完整写回 session
- 下一轮 preflight 直接报：
  - `Estimated request exceeds model context window (...)`

这个问题暂时不准备通过目录级 hard code 修补，而是留到后续课程，用更接近 Claude Code 的方式处理：

- 搜索工具增加通用结果上限 / `truncated` 语义
- tool result 写回 session 前增加统一裁剪层
- 把“超大工具输出预算”作为系统级能力处理

这条线在 `lesson8` 里已经有了第一批实现：

- `grep_text` 已支持匹配数上限与 `truncated`
- `grep_text` 默认跳过 `.git / .logs / .sessions / node_modules` 等高噪音目录
- `list_files` 已支持返回条目数上限与 `truncated`
- `read_file` 已支持 `totalCharCount / totalLineCount / omitted* / truncated`
- `read_file` 超大文件会直接返回 `reason: "file_too_large"`
- `bash` 已支持 `stdoutMeta / stderrMeta`，把输出大小与截断状态结构化返回
- `bash` 在大文件场景下会拦住最常见的文件直出命令：
  `cat / head / tail / sed -n / node -e readFileSync`
- `AgentRuntime`
  当前 lesson9 已进一步收敛：
  - runtime 不再解析 tool result 里的 `continuation`
  - 统一 `tool_result_budget` 写回层已移除
  - tool result 直接进入 session，后续交给 compaction 压缩
  - runtime 只单独维护最小 guardrail

当前剩余的重点不再是“有没有统一 write-back budget”，而是：

- tool 自己是否已经返回足够好的事实信号
- compaction 是否能在长对话下稳定收敛这些原始 tool result

补充一条新的真实验证：

- `run-2026-04-13T03-24-56-689Z-92d520`
- prompt: `搜索 lesson7，并总结命中的内容`
- 在默认搜索过滤开启后，`grep_text` 只扫描了 36 个文件，命中 3 个文件，命中 51 处
- 没有再被 `.logs / .sessions` 放大到几百条结果
- 说明噪音过滤已经在更前面一层起效，不必依赖统一 write-back budget 才能工作

再补两条较新的验证结论：

- `npm run smoke`
  现在已经可用，会自动验证 `read_file / grep_text / list_files / bash`
- `run-2026-04-13T03-30-03-359Z-f1468e`
  用 `READ_FILE_MAX_FILE_BYTES=100` 强制触发了 `read_file` 的 `file_too_large`
  模型能正确解释 `truncated / reason / fileBytes / maxFileBytes`
  这次 run 暴露出模型会自然尝试用 `bash` 去绕过读取限制
- 后续补上的 `bash` file-dump guard
  已经能拦住 `cat / head / tail / sed -n / node -e readFileSync` 这类最常见绕路
  这说明 lesson8 正在从“单工具限制”走向“工具协同预算控制”
- `run-2026-04-13T03-36-02-113Z-ce6856`
  在同样的 `READ_FILE_MAX_FILE_BYTES=100` 条件下，模型先后尝试了 `read_file`、`bash cat`、`bash head`
  但最终没再拿到完整文件，而是基于 guard metadata 正确解释了限制原因
- `run-2026-04-13T03-40-35-750Z-48bb64`
  在统一 `continuation` metadata 加入后，模型在 `read_file` 返回 `file_too_large` 后直接做了解释并收口
  这条链路后来已继续收敛，lesson9 当前不再保留统一 continuation card
- `run-2026-04-13T03-51-30-279Z-2a23ca`
  用显式 prompt 诱导模型忽略 hint，iteration 2 确实去调用了 `bash cat`
  这也是后续 lesson9 决定删除解释性 `followed / ignored`、只保留事实信号与最小 guardrail 的原因之一

## 参考文档

- `agent-study/README.md`
- `agent-study/lesson7/README.md`
- `agent-study/lesson7/docs/07-compaction-hardening.md`
- `agent-study/lesson8/README.md`
