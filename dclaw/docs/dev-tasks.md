# 开发任务清单

## 当前迭代

目标：进入 `v0.1` 收尾阶段，并行推进阶段 5、6、7；优先把 Tool、Permission、Session/Resume 主链路收口到“可持续使用”，而不是继续横向铺能力数量。

## Todo

- [ ] 细化 `WebFetch` / `AskUserQuestion` 的最小行为，使其更接近 Claude Code
- [ ] 为更多 provider 预留统一配置与适配层
- [ ] 将 model limits 接入更多运行时决策，而不只是 provider 请求参数和 doctor 输出
- [ ] 梳理当前 Tool 协议与文档之间的差距
- [ ] 为阶段 6 的 permission mode 接入设计更明确的 evaluator 位置
- [ ] 把 `interactive` 从“单次 prompt 入口”推进到真正的 REPL 交互循环
- [ ] 继续完善 session 列表、最近会话选择和更完整的 history 体验
- [ ] 补齐 resume / transcript 的恢复语义，避免仅恢复消息数组而缺少更完整的会话视图
- [ ] 将现有 `tool result budget / persistence` 从“首版可用”继续推进到更可配置、模型感知的上下文预算层
- [ ] 继续细化 `Bash / Glob / Grep` 的统计、分页、结果映射与模型侧压缩策略
- [ ] 将“大工具结果处理”从当前 `tool_result` 路径继续扩展到更广的上下文压缩 / compact 逻辑
- [ ] 继续细化 `Read / Grep` 在超大文件、超大命中集和更复杂文件语义下的剩余边界
- [ ] 扩展自动化测试覆盖到更复杂文件语义、provider 边界与其余核心工具结果结构

## In Progress

- [ ] 梳理 Claude Code 核心工具与 dclaw 当前实现之间的差距，并按优先级收口
- [ ] 对照本仓库内 Claude Code 源码继续收口“大工具结果处理”链路的剩余部分：budget 参数化、上下文级 compact、以及 `Read / Grep` 的剩余特例

## Deferred

- [ ] `Bash` 的真 sandbox、AST 级 shell 解析和更细粒度 permission 规则暂缓；当前仅在出现真实 bug 或明确需求时继续下探
- [ ] `v0.2+ / 低优先级`：在已有 provider 重试 / 限流 / 结构化错误基础上，继续细化 `Anthropic` 的更完整错误类型映射、可配置 token 参数与更长等待策略
- [ ] `v0.2+ / 低优先级`：在已补 `verbosity / reasoning.effort / store / previous_response_id / parallel_tool_calls / max_tool_calls / include / truncation / metadata / text.format` 的基础上，继续扩展 `OpenAI Responses API` 的更多 request 参数与更广的事件覆盖
- [ ] `v0.2+ / 低优先级`：将 provider / Responses 的 annotation、specialized output types 与更广事件覆盖继续接到 transcript / verbose / headless 展示层

## Done

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
- [x] 让 provider 重试优先尊重 `x-should-retry` 与 `Retry-After`
- [x] 为 `Anthropic 429` 优先接入 `anthropic-ratelimit-unified-reset`
- [x] 将流式请求的自动重试限制为“收到首个 SSE 事件前”
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
- 阶段 8：上下文管理与自动压缩 `not started`
- 阶段 9：Plan / Task / Todo `not started`
- 阶段 10：Memory `not started`
- 阶段 11：多代理、Worktree 与协作执行 `not started`
- 阶段 12：MCP、Skills、Plugins 与 Remote Bridge `not started`
- 阶段 13：Coding 场景增强 `not started`

## 使用约定

- `Todo`：当前迭代明确要做
- `In Progress`：本轮正在做
- `Done`：已完成并确认
- `阶段跟踪`：当前各阶段的总体状态快照
