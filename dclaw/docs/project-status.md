# 项目状态

## 当前状态

- 项目名称：`dclaw`
- 当前阶段：`v0.1` 后半段，阶段 5 持续打磨中，阶段 6-7 已启动
- 当前版本目标：`v0.1`
- 总体状态：`in progress`

## 阶段进展

| 阶段 | 名称 | 状态 | 备注 |
|---|---|---|---|
| 1 | CLI 与运行入口 | completed | 最小 CLI 入口已跑通 |
| 2 | Query Engine 与消息协议 | completed | 已有最小消息模型、LLM 抽象、QueryEngine、queryLoop |
| 3 | System Prompt 与指令装配 | in progress | 最小 prompt assembler 与基础版 `CLAUDE.md` 指令链路已可用 |
| 4 | `CLAUDE.md` 指令系统 | in progress | 基础版多层发现、include、去重、顺序可观察性已可用 |
| 5 | Tool 协议与基础工具 | in progress | 已补 `buildTool / outputSchema / result mapping / runtime output validation`，当前继续打磨 `Bash / Glob / Grep` 与模型侧结果收口 |
| 6 | 权限模式与 Hooks | in progress | 已接入最小 permission evaluator，但 hooks 与细粒度规则仍未完成 |
| 7 | Session、历史与恢复 | in progress | 已实现最小 session store、messages 持久化与 `resume` 恢复链路 |
| 8 | 上下文管理与自动压缩 | not started | 后续阶段 |
| 9 | Plan / Task / Todo | not started | 后续阶段 |
| 10 | Memory | not started | 已完成方案设计，未编码 |
| 11 | 多代理、Worktree 与协作执行 | not started | 已完成方案设计，未编码 |
| 12 | MCP、Skills、Plugins 与 Remote Bridge | not started | 已完成方案设计，未编码 |
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
- 跑通 `interactive / --print / --doctor / resume` 四条入口
- 实现最小消息协议
- 实现最小 LLM client/provider 抽象
- 接入第一个真实 LLM provider：`Anthropic`
- 接入第二个真实 LLM provider：`OpenAI`
- 为 `Anthropic` provider 补上最小非流式 `createMessage` 调用
- 为 `OpenAI` provider 补上 `Responses API` 与 `chat/completions` 两条调用路径
- 为真实 LLM 接入补上基础配置读取、API key 校验与错误分层
- 增加 `.env` / `.env.local` 自动加载，允许直接用本地 provider 配置联调
- 将 tool definitions 接入 LLM 请求层，为真实 provider 的 tool_use 预留协议
- 将 CLI `--provider` 扩展为支持 `anthropic`
- 将 CLI `--provider` 扩展为支持 `openai`
- 将 `doctor` 扩展为输出 `Anthropic` 关键配置状态
- 增加模型 token limit 配置层，支持内置默认值、环境变量覆盖和外部 JSON 覆盖
- 为 `MiniMax / Kimi / GLM` 补上内置 model limits，并让兼容模型可同时命中 `openai / anthropic` 两侧 provider
- 将 `doctor` 扩展为输出解析后的 model limits
- 将 `OpenAI` provider 扩展为支持 `responses / chat-completions` 两种 API style 自动适配
- 为 `Anthropic` 与 `OpenAI` provider 补上基础 streaming
- 为 CLI 增加 `--stream` 与 `--output-format sse`
- 为 headless 输出增加 SSE 事件流
- 使用本地 `.env.local` 配置完成 `OpenAI` 与 `Anthropic` 的真实 smoke test
- 实现最小 QueryEngine 并接入 CLI
- 拆出 `queryLoop`
- 建立最小 prompt context / system prompt 装配层
- 实现基础 `CLAUDE.md` 加载器
- 将 `CLAUDE.md` 指令接入 interactive / headless prompt 链路
- 支持从 cwd 向上发现多层 `CLAUDE.md`
- 支持 `.claude/CLAUDE.md` 与 `.claude/rules/*.md`
- 支持基础 `@include` 指令展开
- 为 `CLAUDE.md` 加载加入去重与循环保护
- 实现最小 Tool 协议
- 实现 tool registry
- 将默认工具名与 Claude Code 对齐为 `Read / Edit / Write / Bash / Glob / Grep`
- 将 tool loop 接入 QueryEngine
- 将 QueryEngine 推进到多轮 assistant->tool->assistant 闭环
- 增加 `glob` / `grep` 两个只读基础工具
- 为 Tool 执行链路补上 `validate / isEnabled / availableTools` 预留位
- 增加 `WebFetch` 与 `AskUserQuestion` 的最小实现并接入默认工具集
- 将 `Bash` 的 timeout / interrupted / noOutputExpected / 只读判定语义往 Claude Code 收紧一层
- 将 `Bash` 补上最小 `run_in_background` 能力，并将后台输出落盘到 `<DCLAW_HOME>/background-tasks/`
- 将 `Bash` 补上大输出落盘能力，并返回 `persistedOutputPath`
- 将 `permissionMode` 接入 CLI 与 tool context
- 将 `Bash.dangerouslyDisableSandbox` 接入最小模式约束
- 将最小 permission evaluator 接入 `queryLoop`
- 让 `default / accept-edits / plan / bypass-permissions` 真正作用于工具执行
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
- 让 `interactive / --print / resume` 接入最小 session 持久化与恢复链路
- 让 `resume` 支持在恢复历史消息后继续执行新的 prompt
- 将 `QueryEngine` 扩展为支持从恢复的 `initialMessages` 继续执行
- 将 headless / interactive 运行时的最大 tool loop 轮数从默认最小值上调，减少过早回退到原始 tool result JSON 的情况

## 当前风险与注意事项

- 当前已完成 Query Engine 最小链路和基础 prompt/`CLAUDE.md` 注入，已进入基础多轮 tool loop
- 当前 tool loop 已有基础多轮 assistant->tool->assistant 闭环，并已补上最小 permission evaluator，但还没有更细粒度规则
- 当前工具层已经不只是“名字和最小链路对齐”，而是完成了第一轮协议收口：`buildTool`、显式 `input/output schema`、内部/模型结果分层、运行时 output 校验都已接入
- 当前 `Read / Edit / Write` 已完成第一轮语义收紧，具备更明确的 partial read、warning、stale read 拦截、`noop` 与 patch/diff 输出；但和 Claude Code 的完整 diff / patch /复杂文件支持还有明显差距
- 当前 `Bash / Glob / Grep` 已补上较完整的结果边界信息；其中 `Bash` 已具备只读判定、关键 shell 边界覆盖、结果持久化与可观测性，`Glob / Grep` 也已补上统计、分页和执行来源字段，但模型侧结果映射仍比 Claude Code 更薄
- 当前 `WebFetch / AskUserQuestion` 仍然只是最小实现
- 当前 `LLM` 层已同时支持 `stub`、`Anthropic`、`OpenAI`，默认联调已可以直接走真实 provider
- 当前已接入 `Anthropic` 与 `OpenAI` 的基础 streaming，但仍未补重试、速率限制处理与更细粒度错误分类
- 当前 `OpenAI` provider 已支持 `responses / chat-completions`，但 `responses` 路径的真实流式事件兼容仍待继续补齐
- 当前 model limits 已有基础配置层，并补上 `MiniMax / Kimi / GLM` 内置 defaults，但上下文预算、自动压缩阈值和真实请求调度还未系统接入
- 当前自动化测试已覆盖 `Read / Edit / Write / Bash / Glob / Grep / WebFetch / AskUserQuestion` 与权限执行链路，并包含一批关键边界场景，但整体覆盖面仍然有限
- 文档约束已经较明确，后续开发需尽量遵守，不要边写边扩大范围
- 当前 `CLAUDE.md` 仍是基础版实现，未覆盖完整 include 语义和所有优先级细节
- 当前 `CLAUDE.md` 尚未覆盖 managed memory、frontmatter 条件规则、instruction hooks 等细节
- 当前 session / resume 仍是最小实现，尚未覆盖 session 列表、最近会话选择、history 检索与更完整的 transcript 恢复语义
- 阶段 1 开始后，应持续维护本文件状态

## 下一步

下一步进入：

- `v0.1` 收尾阶段：并行推进阶段 5、6、7 的剩余主链路

第一批目标：

- 优先细化已有核心工具语义，而不是继续横向补更多工具
- 继续收口 `Bash / Glob / Grep` 的统计、分页、结果映射与模型侧压缩策略
- 再补 `WebFetch / AskUserQuestion`
- `Bash` 暂时以 bugfix 为主，不继续主动深挖真 sandbox / AST 级 shell 解析这类深水区能力
- `Read / Edit / Write` 转入 bugfix + 小步增强，继续向 Claude Code 的更完整 diff / patch / 文件类型支持靠近
- 把 session / resume 从“最小可用”推进到“可持续使用”：
  - session 列表 / 最近会话选择
  - 更完整的 transcript / history 恢复
  - interactive 真正 REPL 化，而不是仅依赖单次 prompt
- 继续细化 `Anthropic` provider，补重试、可配置 token 参数与更稳的错误处理
- 继续细化 `OpenAI` provider，补 `responses` 流式事件、reasoning / verbosity 等更细粒度参数支持
- 为后续更多 provider 抽象出更明确的 request/response 适配层
- 将 model limits 继续接入上下文管理、budget 估算和后续 compact 逻辑
- 为后续权限模式与 hooks 接入 tool 执行链路预留接口
- 继续完善 tool contract
