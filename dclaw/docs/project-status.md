# 项目状态

## 当前状态

- 项目名称：`dclaw`
- 当前阶段：`v0.3` 早期实施
- 当前版本目标：`v0.3`
- 总体状态：`implementing v0.3`；TUI 阶段 7 已切默认并移除旧 readline REPL 主循环

## 阶段进展

| 阶段 | 名称 | 状态 | 备注 |
|---|---|---|---|
| 1 | CLI 与运行入口 | completed | 最小 CLI 入口已跑通 |
| 2 | Query Engine 与消息协议 | completed | 已有最小消息模型、LLM 抽象、QueryEngine、queryLoop |
| 3 | System Prompt 与指令装配 | in progress | 最小 prompt assembler 与基础版 `DCLAW.md` 指令链路已可用；深化项下调到 `v0.4` |
| 4 | `DCLAW.md` 指令系统 | in progress | 基础版多层发现、include、去重、顺序可观察性已可用；深化项下调到 `v0.4` |
| 5 | Tool 协议与基础工具 | in progress | `v0.1` 范围已基本可用，剩余收口项转入 backlog |
| 6 | 权限模式与 Hooks | in progress | 已接入最小 permission evaluator；hooks 与细粒度规则下调到 `v0.4` |
| 7 | Session、历史与恢复 | in progress | `v0.1` 范围已基本可用，剩余体验打磨转入 backlog |
| 8 | 上下文管理与自动压缩 | completed | 已完成 manual compact、消息级 boundary、共享 context stats、模型生成 compact summary、dry-run recommendation、最小 autocompact 触发/回退链路，以及首轮 post-compact 文件/plan/task 恢复；当前范围按 `full compact + autocompact + post-compact 恢复` 收口。`partial compact / reactive compact` 已作为非主线路径主动舍弃 |
| 9 | Plan / Task | completed | 已落地 task board、`/plan`、plan file、`Task*`、`EnterPlanMode / ExitPlanMode`、plan-mode reminders、prompt runtime planning context，以及 `resume/history/transcript` planning 观察面；当前已开始 plan-centered 改造，`ExitPlanMode` 已从交互式审批入口收缩为 plan 交付入口，不再自动 materialize 执行任务；阶段 9-3 的 plan 真值恢复 / planning 生命周期规则均已收口，并补齐了 Claude Code 风格的“completed task board 5 秒后自动 retire/reset” |
| 10 | Memory | completed | 已完成 `10-1` memory 文件系统骨架、`10-2` 的 `MEMORY.md` 常驻注入 / side-query recall / 来源可观察性，以及 `10-3` 的写回边界、去重 / 升级护栏、`WHAT_NOT_TO_SAVE_SECTION` 约束；同时完成 `10-5` 的非阻塞 memory 写回与退出软 drain，按当前 `v0.2` 范围收口 |
| 11 | 多代理、Worktree 与协作执行 | in progress | `v0.3` 只聚焦 subagent 主路径；`src/agent/` 最小运行时骨架、独立 child transcript、parent turn links、`Agent` tool 的 `spawn/send/wait/stop` 主路径，以及 `resume/history/transcript/trace` 的最小观察面已落地；`worktree / coordinator / 多 worker` 继续后置到 `v0.4` |
| 12 | MCP、Skills、Plugins 与 Remote Bridge | in progress | `v0.3` 只聚焦 skills 主路径；`src/skills/` 最小 loader / registry / prompt 骨架与统一 `Skill` tool 主路径已落地；`MCP / plugins / remote bridge` 继续后置到 `v0.4` |
| 13 | Coding 场景增强 | not started | 明确后置 |

## 已完成事项

- 明确 `dclaw` 产品定位：终端优先的通用 agent
- 明确 12 个核心阶段与 1 个后置场景阶段
- 明确 `coding` 能力不进入核心主线
- 明确 `memory` 进入核心能力
- 建立 `dclaw/` 目录骨架
- 初始化 TypeScript 工程
- 初始化基础脚手架文件
- 编写主文档与专题文档
- 建立文档编号版入口
- 初始化进展跟踪文档
- 实现最小 CLI 运行入口
- 跑通 `interactive / exec / doctor` 三条入口
- 实现最小消息协议
- 实现最小 LLM client/provider 抽象
- 接入第一个真实 LLM provider：`Anthropic`
- 接入第二个真实 LLM provider：`OpenAI`
- 为 `Anthropic` provider 补上最小非流式 `createMessage` 调用
- 为 `OpenAI` provider 补上 `Responses API` 与 `chat/completions` 两条调用路径
- 为真实 LLM 接入补上基础配置读取、API key 校验与错误分层
- 为 `Anthropic` 与 `OpenAI` provider 补上基础重试、限流处理与指数退避
- 将默认 provider 重试次数与退避上限对齐 Claude Code：默认 `10` 次重试、`500ms` 起步指数退避、最大 `32s`
- 让 provider 重试优先尊重 `x-should-retry`、`Retry-After`，并为 `Anthropic 429` 优先接入 `anthropic-ratelimit-unified-reset`
- 将流式请求的自动重试收紧为仅在收到首个 SSE 事件前允许重放，避免重复文本和重复 tool call
- 为 provider 错误补上结构化分类与错误对象字段，包括 `kind / errorType / errorCode / retryDirective`
- 增加 `.env` / `.env.local` 自动加载，允许直接用本地 provider 配置联调
- 将 tool definitions 接入 LLM 请求层，为真实 provider 的 tool_use 预留协议
- 将 CLI `--provider` 扩展为支持 `anthropic`
- 将 CLI `--provider` 扩展为支持 `openai`
- 将 `doctor` 扩展为输出 `Anthropic` 关键配置状态
- 增加模型 token limit 配置层，支持内置默认值、环境变量覆盖和外部 JSON 覆盖
- 为 `MiniMax / Kimi / GLM` 补上内置 model limits，并让兼容模型可同时命中 `openai / anthropic` 两侧 provider
- 将 `doctor` 扩展为输出解析后的 model limits
- 将 `dclaw doctor` 扩展为输出 provider reliability 诊断，包括 `max retries / retry backoff / request timeout / stream watchdog / stream idle timeout`
- 将 `OpenAI` provider 扩展为支持 `responses / chat-completions` 两种 API style 自动适配
- 为 `Anthropic` 与 `OpenAI` provider 补上基础 streaming
- 为 `OpenAI Responses API` 补上更完整的流式事件兼容，包括 `response.output_text.*`、`response.reasoning_summary_text.*`、`response.function_call_arguments.*`、`response.output_item.*` 与 `response.done` 回退收尾
- 为 `OpenAI Responses API` 补上首批更细 request 参数支持，包括 `text.verbosity`、`reasoning.effort`、`store`、`previous_response_id`、`parallel_tool_calls` 与 `max_tool_calls`
- 为 `OpenAI Responses API` 补上第二批 request 参数支持，包括 `include`、`truncation`、`metadata` 与 `text.format`
- 为 `OpenAI Responses API` 补上基于 message item 的流式文本回退路径，避免只依赖 `response.output_text.*`
- 为 `OpenAI Responses API` 补上 `response.content_part.*` 与 `response.refusal.*` 事件兼容，并接到实时文本增量回调
- 为 `OpenAI Responses API` 补上 `output_text.annotations` 与 `response.output_text.annotation.added` 兼容，并将 annotation 保留到 `text` 内容块
- CLI 当前保留 `--stream`；旧的 `--output-format sse` 已移除
- 为 headless 输出增加 SSE 事件流
- 为 CLI 补上结构化 provider 错误格式化，失败统一走 stderr 文本输出
- 将 `main.ts` 收紧为仅在直接执行时自启动，并为 CLI 失败路径补上子进程级集成测试
- 使用本地 `.env.local` 配置完成 `OpenAI` 与 `Anthropic` 的真实 smoke test
- 实现最小 QueryEngine 并接入 CLI
- 拆出 `queryLoop`
- 建立最小 prompt context / system prompt 装配层
- 实现基础 `DCLAW.md` 加载器
- 将 `DCLAW.md` 指令接入 interactive / headless prompt 链路
- 支持从 cwd 向上发现多层 `DCLAW.md`
- 支持 `.dclaw/DCLAW.md` 与 `.dclaw/rules/*.md`
- 支持基础 `@include` 指令展开
- 为 `DCLAW.md` 加载加入去重与循环保护
- 实现最小 Tool 协议
- 实现 tool registry
- 将默认工具名与 Claude Code 对齐为 `Read / Edit / Write / Bash / Glob / Grep`
- 将 tool loop 接入 QueryEngine
- 将 QueryEngine 推进到多轮 assistant->tool->assistant 闭环
- 增加 `glob` / `grep` 两个只读基础工具
- 为 Tool 执行链路补上 `validate / isEnabled / availableTools` 预留位
- 增加 `WebFetch` 与 `AskUserQuestion` 的最小实现并接入默认工具集
- 为 `WebFetch` 补上更稳的 URL/协议校验、跨 host 重定向提示、HTML/JSON 内容提取与更丰富的结果元信息
- 为 `AskUserQuestion` 补上稳定 question id、唯一性校验、可选 preview/annotations 字段与答案规范化
- 将 `Bash` 的 timeout / interrupted / noOutputExpected / 只读判定语义往 Claude Code 收紧一层
- 将 `Bash` 补上最小 `run_in_background` 能力，并将后台输出落盘到 `<DCLAW_HOME>/background-tasks/`
- 将 `Bash` 补上大输出落盘能力，并返回 `persistedOutputPath`
- 将 `permissionMode` 接入 CLI 与 tool context
- 将 `Bash.dangerouslyDisableSandbox` 接入最小模式约束
- 将最小 permission evaluator 接入 `queryLoop`
- 让 `default / accept-edits / plan / bypass-permissions` 真正作用于工具执行
- 为 `permissionMode` 增加用户级与 workspace 级配置解析，并明确优先级为 CLI > 用户级 > workspace > 默认值
- 让 `doctor / interactive / resume / verbose meta` 显示实际生效的 `permissionMode` 及其来源
- 将 `Glob` 补上默认 100 条结果限制与 `truncated` 语义
- 将 `Grep` 补上更接近 Claude Code 的 `head_limit` 默认值与 `-A/-B/-C/context/-n/type/multiline` 基础支持
- 将 `Edit / Write` 补上基础 `structuredPatch` 输出
- 将 `Edit / Write` 补上最小 `gitDiff` 输出
- 将 `Read` 补上 `isPartial` 输出标记
- 将 `Read` 补上空文件 / offset 越界 warning 与目录路径校验
- 为 `Read` 补上明确 input schema，并兼容 `path` 作为 `file_path` 别名
- 将 Tool 协议收紧为轻量版 `buildTool`，并统一默认 `validate / isEnabled / isReadOnly`
- 为默认 builtin tools 补齐显式 `outputSchema`
- 将 tool result 分为模型侧 `output` 与内部 `rawOutput`
- 将 `outputSchema` 接入 `queryLoop` 运行时校验，避免不合法工具输出直接进入消息链路
- 将 `Read` 的输出形态进一步收紧到更明确的 `type / file / didReadToEnd / warning` 结构
- 将 `Edit / Write` 的读后写约束从 validate 扩展到 direct `call`
- 为 `Write` 补上 `create / update / noop` 结果区分与 `didWrite`
- 为 `Glob / Grep` 补上 `totalFiles / totalMatches / searchRoot / engine / durationMs` 等结果元信息
- 为 `Bash` 补上 `executionMode / stdoutTruncated / stderrTruncated / persistedOutputSize`
- 建立基础自动化测试骨架，并接入 `npm test`
- 将自动化测试扩展到 `Glob / Grep / WebFetch / AskUserQuestion`
- 将自动化测试扩展到更多 permission mode 与 `Read / Edit / Write / Bash` 边界场景
- 将 `Bash` 的只读识别扩展到 `pwd` 与一批常见只读 `git` 命令
- 将 `Bash` 的只读识别扩展到 `timeout / time / nice / stdbuf / nohup` 这类安全 wrapper
- 将 `Bash` 的只读识别扩展到一小组 Claude Code 风格的安全环境变量前缀
- 将带输出重定向的 `Bash` 命令从只读自动放行中排除，并补上对应测试
- 为 `Bash` 补上两类更接近 Claude Code 的人工审批原因：
  - 动态 shell expansion 重定向目标
  - `cd` 与输出重定向的组合命令
- 将自动化测试扩展到上述两类 `Bash` 安全审批场景
- 将 `Bash` 的结果持久化收紧为“可独立诊断的运行记录”，前台大输出与后台任务日志均补上 `cwd / exit_code / sandbox_mode / command` 等元信息
- 将 `Bash` 的 `sandboxMode` 透出到 tool result、query trace、session transcript 与 history 摘要
- 将 `Bash` 的重定向语义进一步收紧到 `fd duplication / force-clobber / >& file / &> / &>> / 1>>file 2>&1` 等边界
- 将 `Bash` 的 command substitution / process substitution 从只读自动放行路径中移出，并统一要求手动审批
- 建立最小 session store：
  - 默认：`~/.dclaw/sessions/<session-id>/meta.json`
  - 默认：`~/.dclaw/sessions/<session-id>/messages.jsonl`
  - 若设置 `DCLAW_HOME`，则改为 `<DCLAW_HOME>/sessions/<session-id>/...`
- 让 `interactive / exec / resume` 接入最小 session 持久化与恢复链路
- 让 `resume` 支持在恢复历史消息后继续执行新的 prompt
- 将 `QueryEngine` 扩展为支持从恢复的 `initialMessages` 继续执行
- 将 `interactive` 从“单次 prompt 入口”推进到真正的 REPL 交互循环
- 为 REPL 增加首批本地 slash commands：
  - `/help`
  - `/session` / `/info`
  - `/history`
  - `dclaw doctor`
  - `/model [model]`
  - `/permissions [mode]`
  - `/config`
  - `/transcript [N]`
  - `/resume [session-id]`
  - `/compact [instructions]`
  - `/clear`
  - `/cls`
  - `/exit` / `/quit`
- 将 headless / interactive 运行时的最大 tool loop 轮数从默认最小值上调，减少过早回退到原始 tool result JSON 的情况
- 将 `QueryEngine` 扩展为支持最小运行时变更：
  - `setModel()`
  - `setPermissionMode()`
  - `resetMessages()`
- 为 `compact` 建立最小内核：
  - `compactSession`
  - `compactSummary`
  - `compact boundary`
- 将 `/compact` 升级为统一 boundary 流程，并把 compact boundary 接到 `history / resume / /session / /transcript`
- 建立共享 `contextStats` 与 Claude Code 风格的 compact threshold / percent-left recommendation
- 将 compact dry-run recommendation 接到 REPL `/session / info / doctor`、verbose 与 query trace
- 将最小 autocompact 接到 `QueryEngine` 提交链路，并补上 same-session boundary 追加、trace 记录与失败回退
- 明确阶段 9 的产品规则：`plan mode` 由模型可建议/发起，`EnterPlanMode` 负责直接进入高约束 planning，`ExitPlanMode` 负责交付计划并等待用户下一步；planning 会改变 LLM 的工作节奏而不只是限制工具
- 为阶段 9 建立最小 `plan board` 内核，并通过 session meta 挂接 planning 状态
- 为阶段 9 接通首批 REPL 入口：`/plan`、`/plan exit`
- 重新评估 Claude Code 源码后，明确阶段 9 主线应对齐 `plan mode + plan file + Task*`
- 已移除 `TodoWrite` tool 与 `/todo` 系列命令，避免继续保留偏离当前主路径的 V1 checklist 能力
- 已接通 Claude Code V2 最小 `TaskCreate / TaskList / TaskGet / TaskUpdate`，并按当前 task board 真值持久化
- TUI interactive 入口已切为默认 Ink 路径，`--tui / --legacy-repl` 已移除并由 CLI 参数解析拒绝
- TUI 退出时会清理 Ink instance 并限时 drain 后台工作；queue / interrupt / permissions / resume compact / task snapshot 的阶段 7 回归护栏已补齐。首版 transcript viewport 已撤回，resize / scrollback / autofollow 暂不启用，避免破坏 Bottom Dock 与主布局

## 当前风险与注意事项

- 当前已完成 Query Engine 最小链路和基础 prompt/`DCLAW.md` 注入，已进入基础多轮 tool loop
- 当前 tool loop 已有基础多轮 assistant->tool->assistant 闭环，并已补上最小 permission evaluator；更细粒度规则与 hooks 已下调到 `v0.4`
- 当前 `permission mode` 已不再只是 CLI 临时参数，也支持用户级与 workspace 级默认配置
- 当前阶段 9 已不再是纯文档设计：task board、最小 REPL 入口、plan file、`EnterPlanMode / ExitPlanMode`、prompt runtime 摘要、`Task*` tool、task tool prompt，以及最小 runtime task reminder / `TaskUpdate` 完成态引导都已接通；其中 task reminder 已从 system prompt 拼接收敛为临时 `<system-reminder>` user meta message，plan mode 也已补上 `plan_mode / plan_mode_exit / plan_mode_reentry` 的最小 attachment-style 提醒，并覆盖了 compact 后第一轮的强制 full reminder。当前 `resume / history / transcript` 已具备统一的 planning 观察面；其中 transcript 收敛为记录 `EnterPlanMode / ExitPlanMode` 工具事件与 plan 真值，不再额外持久化这些 runtime reminder。plan-centered 改造后，`ExitPlanMode` 不再触发交互式审批或自动开工，而是展示 plan 并等待用户下一步；swarm / teammate 仍属后续扩展
- 当前阶段 9 已接通 `Task*` 主路径的最小版本，但 swarm / teammate 相关 hook、mailbox、owner 自动派发等 Claude Code 扩展仍未实现
- 当前已确认 Claude Code 源码里有两层不同能力：V1 `TodoWrite` 与 V2 `TaskCreate / TaskList / TaskGet / TaskUpdate`；`dclaw` 已明确收敛到 V2 主路径，不再保留 V1 对外能力
- 当前已具备阶段 9 的最小 plan file 主线：进入 planning 后会创建/绑定 plan file，plan file 已作为当前 planning 真值，并接入 prompt runtime context、compact 后首轮恢复，以及 `resume / history / transcript / /session` 的观察面；plan-centered 改造后，退出 plan mode 时会交付 plan 正文/摘要并等待用户下一步
- 当前阶段 9 已取消 `ExitPlanMode` 自动从 plan materialize 首版 task list；若用户明确要求开始实施，执行流再创建或更新 task list
- 当前 `TaskCreate / TaskList / TaskUpdate` 的提示语义已收紧：执行阶段默认应继续消费当前 task list；若发现重大新增工作，应在当前轮结束时向用户说明，而不是静默扩张当前计划
- 当前阶段 9 又补齐了一个与 Claude Code 对齐的生命周期规则：当执行板处于 `inactive` 且可见 task 全部 `completed` 超过 `5s`，当前 session 会自动 retire 这块旧 board；后续新任务会起 fresh board，而不是继续把新工作拼在旧列表后面
- 当前 `dclaw` 已不再保留 `/todo` 与 `TodoWrite`；`TaskBoard` 也已去除内部 `todos` 字段，主路径统一收敛到 `plan file + Task*`
- 当前已修复一个阶段 9 的关键体验缺口：
  - `EnterPlanMode` 已不再要求用户批准进入，而是直接切换到 planning
  - `ExitPlanMode` 已不再是 plan approval step，而是 plan 交付 step
  - 退出 plan mode 后模型会收到“展示计划并等待用户下一步”的 runtime reminder，避免同轮直接开工
- 当前这条 bugfix 仍保持严格边界：
  - 没有额外引入本地 cooldown / plan hash 去重 / “必须先改 plan 才能再次批准” 之类 heuristic
  - 若后续仍发现重复请求问题，应继续回到 Claude Code 源码找主线路径，而不是先补本地规则
- 当前阶段 10 已完成 `10-1` 的 memory 文件系统骨架，并已接通 `10-2` 的 query-time recall / prompt 注入，以及 `10-3` 的首版 automatic extraction：
  - 已新增 `src/memory/paths.ts / frontmatter.ts / store.ts / manifest.ts / recall.ts`
  - 已按 `~/.dclaw/projects/<sanitized-workspace>/memory/` 风格落地路径、`MEMORY.md` 入口、独立 memory markdown 文件，以及最小 frontmatter/manifest
  - 当前已将 `MEMORY.md` 常驻接入 `src/prompt/systemPrompt.ts` 主链路，并按当前 query 注入少量 recalled memory
  - 当前已将具体 memory recall 收口到“扫描 manifest + side-query 选择相关 memory”的主路径，不再只靠 deterministic token overlap
  - 当前已明确 memory selector 永远复用主对话的 `client/model`，不再单独引入 selector model / routing
  - 当前已为 injected memory 补上来源可观察性：prompt 中保留源路径，query trace 记录 recall 结果，doctor 可显示当前 workspace 的 memory 路径/入口
  - 当前已新增独立的 turn-end memory extraction 子流程：query 完成后会用受限的 `Read / Edit / Write` memory-only 子工具链，按当前 turn 内容自动尝试写回 memory，并把成功写入记录为 transcript-only system note
  - 当前 automatic extraction 已收口到更接近 Claude Code 的后台 / 非阻塞执行：主 turn 不再等待 extraction，interactive/resume 不再被写回阻塞，headless 与退出路径会做软 drain
- 当前 `config.json` 已不再只承载 `permissionMode`，也可承载 provider / api key / query trace / model 等运行时配置，并在 `doctor` 中显示来源
- 当前工具层已经不只是“名字和最小链路对齐”，而是完成了第一轮协议收口：`buildTool`、显式 `input/output schema`、内部/模型结果分层、运行时 output 校验都已接入
- 当前 `Read / Edit / Write` 已完成第一轮语义收紧，具备更明确的 partial read、warning、stale read 拦截、`noop` 与 patch/diff 输出；剩余差距当前转入 backlog
- 当前 `Bash / Glob / Grep` 已补上较完整的结果边界信息；其中 `Bash` 已具备只读判定、关键 shell 边界覆盖、结果持久化与可观测性，`Glob / Grep` 也已补上统计、分页和执行来源字段，剩余细化项当前转入 backlog
- 当前 `dclaw` 已补上第一轮“超大 tool result 处理”链路：`queryLoop` 在发起下一次 LLM 请求前会统一执行 tool result budget / persistence，支持 `maxResultSizeChars`、单轮 aggregate budget，以及“落盘 + 文件引用 + preview”的模型侧替换格式
- 当前这条“大工具结果处理”链路已开始接入 model limits：`queryLoop` 会基于 resolved model limits 派生模型感知的 `tool result budget`，对小上下文模型更积极地做结果持久化
- 当前这条链路的剩余差距主要在于：预算参数仍较粗；更广的上下文压缩逻辑与真实请求调度仍未充分消费 model limits，这部分已下调到 `v0.4`
- 当前 `Bash` 既有工具内前台/后台输出落盘，也已经能接入 query loop 级的统一 tool result 替换；剩余问题当前转入 backlog
- 当前 `Read` 已收紧默认读取边界：超大文件在未指定 `limit` 时不会整段直接返回；剩余问题当前转入 backlog
- 当前 `Grep / Glob` 与 fallback 搜索已补上第一轮默认排除目录，并在显式目标路径下允许继续搜索这些目录；剩余问题在于这套排除规则仍是本地实现的务实名单，还没完全对齐 Claude Code 那种更依赖 VCS / ignore 语义的模型
- 当前 `WebFetch / AskUserQuestion` 已完成第一轮增强：`WebFetch` 不再只是简单去标签，而是会做协议校验、跨 host 重定向提示、HTML/JSON 规范化、基础 metadata 提取，以及按 prompt 聚焦相关摘录；`AskUserQuestion` 也已补上稳定 id、唯一性校验和 richer schema 透传
- 这两个工具的后续深化已下调到 `v0.4 / 低优先级`：`WebFetch` 主要剩权限/安全链路、cache、binary content 与更强 prompt 处理，`AskUserQuestion` 主要剩 richer host UI、preview 展示与 annotations 采集
- 当前 `LLM` 层已同时支持 `stub`、`Anthropic`、`OpenAI`，默认联调已可以直接走真实 provider
- 当前 `Anthropic` 与 `OpenAI` provider 已补上基础 streaming、重试、限流处理、结构化错误分类，以及 CLI / SSE 错误出口
- 当前 provider 重试策略已覆盖 `408 / 409 / 429 / 529 / 5xx`、瞬时网络错误、`Retry-After`、`x-should-retry` 与 Anthropic 的 unified rate limit reset；更细的 provider 专属错误语义和更长等待策略已下调到 `v0.4 / 低优先级`
- 当前 provider 已补上第一轮 Claude Code 风格稳定性基线：
  - provider 请求超时：`DCLAW_LLM_TIMEOUT_MS`
  - streaming body idle watchdog：`DCLAW_ENABLE_STREAM_WATCHDOG`、`DCLAW_STREAM_IDLE_TIMEOUT_MS`
- 当前 provider 也已补上第一轮保守 fallback：
  - 如果流式请求在收到首个 SSE 事件前就挂起、提前结束或无法形成有效流内容，会回退到 non-streaming 请求
  - 一旦已经开始出流，仍保持“不自动重放”的保守策略
- 当前这条线的剩余差距主要变成：
  - timeout/watchdog/fallback 触发后的更明确恢复路径
  - 更细粒度的 provider 专属错误提示
- 当前 `OpenAI` provider 已支持 `responses / chat-completions`，并已补齐 `verbosity`、两批关键 Responses request 参数，以及关键流式事件兼容；当前已覆盖 `response.output_text.*`、`response.output_text.annotation.added`、`response.content_part.*`、`response.refusal.*`、`response.reasoning_summary_text.*`、`response.function_call_arguments.*`、`response.output_item.*` 与 `response.done/completed`，其余更多参数、更多 output 类型与更广事件面已下调到 `v0.4 / 低优先级`
- 当前 model limits 已有基础配置层，并补上 `MiniMax / Kimi / GLM` 内置 defaults；其中 `tool result budget` 已开始消费这些 limits，更广的上下文预算、自动压缩阈值和真实请求调度已下调到 `v0.4`
- 当前阶段 8 已不再只有 tool result budget；manual compact、boundary 持久化、共享 context stats、dry-run recommendation 与最小 autocompact 触发/回退都已接通
- 最近一次对 `compact` 模块的代码/文档核对结论：阶段 8 主路径实现与文档描述基本一致，未发现“文档已标完成但代码未落地”的重大偏差；当前文档漂移主要集中在少数“下一步”描述还停留在 post-compact attachment 恢复之前
- 当前阶段 8 已按当前产品范围收口：
  - compact 后的上下文恢复已完成首版结构化 runtime attachment：最近文件、plan file、plan mode、current task / current step 与 first-turn task reminder 均可恢复；当前 transcript 已按 Claude Code 外部主线收敛为工具事件与 plan 真值持久化
- 当前阶段 11 已接通第一条可用主路径：
  - `src/agent/` 已落地 `types.ts / store.ts / runtime.ts / session.ts`
  - subagent 已具备最小 file-backed 真值：agent meta、parent turn links、独立 child transcript
  - `Agent` tool 已接入 `spawn / send / wait / stop` 闭环；子代理继续复用现有 `QueryEngine / client / model / toolRegistry / permissionMode`，并为子流程显式提供独立 `maxTurns / maxIterations`
  - `spawn` 已不再只是 queued 占位，而会立即挂到最小后台执行器；`wait` 优先等待现有 child 运行结果，`resume` 等场景则可按落盘状态继续执行
  - subagent 默认会从 parent tool set 继承后再收紧，当前显式剥离 `Agent / AskUserQuestion / EnterPlanMode / ExitPlanMode / Task*`，避免把 child 误当成完整顶层 session / host
  - `send` 已与 `spawn` 对齐，会立即把 follow-up prompt 接回后台执行；subagent 也不再绑定独立顶层 `sessionId`，避免生成额外 `sessions/<agentId>` 与 task board 副作用
  - 主代理当前可拿到受控的子代理完成摘要，而不是转抄整段 child transcript；`resume / history / transcript / trace` 也已补上最小 subagent 观察面
  - 已补齐阶段 11 的最小单测，覆盖 agent store / status persistence、parent-child transcript 隔离、runtime limit 继承，以及 `spawn / send / wait / stop` 主路径
- 当前阶段 12 已接通第一条可用主路径：
  - `src/skills/` 已落地 `types.ts / loader.ts / registry.ts / prompt.ts`
  - 首版只支持 `builtin skills` 与 `project skills`，当前不引入 plugin-provided skills、marketplace 或 remote bridge
  - `Skill` tool 已接入统一主消息循环；技能调用会 resolve 已加载 skill，并把技能约束以最小 `<system-reminder>` 注回当前对话，而不是绕开 QueryEngine 自己执行
  - 已调用 skill 现已进入最小 `invoked_skills` 持续约束链路：skill 调用会登记到 runtime state，`compact` 后首轮会重新注入持续提醒，`resume` 也会从 transcript 恢复这份状态；post-compact 恢复已补上最小 token 保护，对单个 skill 和整组 skills 做预算裁剪
  - 最小 `skill_listing` 也已落地：仅在 runtime 实际暴露 `Skill` tool 时注入，以 `<system-reminder>` 形式向模型广播当前可用 skills；只补“之前没发过的新 skill”，`/resume` 首轮抑制重复广播，`compact` 后不重放 listing
  - skill 现已具备最小 `inline / fork` 双模式：默认 inline，只有 skill 元数据显式声明 `context: fork` 时主线程才会复用现有 subagent 运行时执行；subagent 内调用 `Skill` 时会显式忽略 `fork` 并统一按 inline 执行；fork skill 不会把自己的持续约束写回父 agent 的 `invoked_skills`
  - 已确认 `dclaw` 不实现 `skill_discovery`：当前公开源码里看不到 Claude Code 对应的 discovery 实现体，因此不做近似版相关性发现，避免伪装成源码已有能力
  - 当前 `dclaw` 只有 `builtin/project skills`，没有 Claude Code 那种 `MCP / plugin / remote skill` 扩展面；因此 `skill_listing` 继续保持最小，不额外引入独立 budget / formatting pipeline
  - 已补齐阶段 12 的最小单测，覆盖 skill loader / registry、`SkillTool` invoke path、`invoked_skills` 的 persistence / recovery 边界、`skill_listing` 的 duplication / resume-suppression / compact-no-replay 边界，以及 `Skill` 的 `inline / fork` execution-context 主路径
  - 当前剩余差距主要收敛为：fork skill 的 agent-type 元数据尚未落地，先继续复用现有 generic subagent runtime，不额外发明 skill 专属 agent 协议
- 当前多模态链路又补了一层受控降级：
  - 当当前主 runtime 不支持 image input、但额外配置了 vision runtime 时，`Read` 与 `WebFetch` 的图片路径不再继续向主模型返回 image block，而会改走最小 `vision side query`
  - 这条 side query 仍保持单独的辅助模型请求，不会把主会话 provider 动态切走，也不会让主 query loop 中途换 provider
  - side query 当前只吃两类最小上下文：当前用户请求，以及当前这次 tool use 的局部意图
  - 当前 `toolUseIntent` 的回退顺序已固定为：最近 assistant 可见文本 -> 同轮 reasoning/thinking -> 最近用户请求
  - 当前范围只覆盖 `Read(image)` 与 `WebFetch(image)`；还没有扩到用户直接附图、interactive 图片输入或通用多模态路由
- `partial compact / reactive compact` 已按当前产品取舍主动舍弃：
  - `partial compact` 不会和 auto compact 联动，也没有 Claude Code 风格的 message selector / rewind 用户入口
  - `reactive compact` 在当前 Claude Code 外部源码里只有调用点与 feature gate，没有可直接对齐的实现本体，且明确是 ant-only
  - 这两项都与 `TodoWrite` 类似，属于当前明确主动不做，而不是延后排期
- `microcompact / session memory compact / context collapse` 等更深层调度当前不进入最近主线，避免阶段 8 过早发散
- 当前自动化测试已覆盖 `Read / Edit / Write / Bash / Glob / Grep / WebFetch / AskUserQuestion`、权限执行链路、provider 重试/错误分类，以及 CLI 失败路径，但整体覆盖面仍然有限
- 文档约束已经较明确，后续开发需尽量遵守，不要边写边扩大范围
- 当前 `DCLAW.md` 仍是基础版实现，未覆盖完整 include 语义和所有优先级细节；这些深化项已下调到 `v0.4`
- 当前 `DCLAW.md` 尚未覆盖 managed memory、frontmatter 条件规则、instruction hooks 等细节；这些深化项已下调到 `v0.4`
- 当前 session / resume 已不再只是“最小恢复链路”，而是具备基础 REPL、history、recent session 提示、本地会话命令，以及 persisted tool result 的基础记录与展示；剩余体验打磨当前转入 backlog
- 当前 REPL 命令面已经覆盖 `/help / session / history / doctor / model / permissions / config / transcript / resume / compact / clear / cls` 等第一批高频能力；更统一的 slash command 框架当前转入 backlog
- 阶段 1 开始后，应持续维护本文件状态

## 下一步

当前 `v0.3` 主线已经从“进入阶段 11/12”推进到“subagent / skills 两条最小主路径均已落地”。接下来更准确的焦点是：

- 阶段 12：继续补 `fork skill` 的 agent-type 元数据与剩余 nested skill 边界
- `worktree / coordinator / 多 worker / MCP / plugins / remote bridge` 继续维持在 `v0.4`
- 前序阶段的深化项也继续维持在 `v0.4`，当前不再回头扩张 `v0.3` 范围
  - `tool result budget / persistence` 的进一步参数化，以及更深层的上下文级 compact / 多层调度接线
  - 权限模式与 hooks 的继续收口，包括更细粒度规则和 evaluator 深化
  - `DCLAW.md` 的完整 include 语义、优先级细节、frontmatter / managed memory / instruction hooks
- provider 深化项已下调到 `v0.4 / 低优先级`：
  - `Anthropic` 更完整错误类型映射、可配置 token 参数与更长等待策略
  - `OpenAI Responses API` 更多 request 参数、更多 output 类型与更广流式事件覆盖
  - 将 `text` 内容块上的 annotation 继续接到 transcript / verbose / headless 输出层，而不只是保留在消息模型里
- 其余 backlog 中的工具契约、provider 错误提示、`session / resume` 体验收口项与多模态剩余项统一排入 `v0.4`
- 多模态后续推进也继续收口在 `v0.4`：
  - `QueryEngine` 公开结构化输入
  - interactive 图片输入与 `exec --image`
  - 是否继续把 `vision side query` 扩到更多图片来源与更完整的恢复链路
