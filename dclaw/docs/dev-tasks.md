# 开发任务清单

## 当前迭代

目标：继续阶段 5，优先把 Tool 协议和核心工具语义往 Claude Code 靠拢，而不是继续横向铺工具数量。

## Todo

- [ ] 重构 Tool 协议，使其更接近 Claude Code 的 `buildTool` 能力边界
- [ ] 细化 `Read` 的输出形态、分段读取、read-state 和错误语义
- [ ] 细化 `Edit` 的匹配、replace_all、冲突与失败语义
- [ ] 细化 `Write` 的整文件覆写、读后写约束与返回结构
- [ ] 继续细化 `Bash` 的 sandbox、更细粒度 permission 规则、自动后台化与结果持久化语义
- [ ] 继续细化 `Bash` 的 shell 语义判定，尤其是重定向、组合命令和更复杂的 git/外部命令边界
- [ ] 继续细化 `Bash` 的输出重定向语义，尤其是 fd redirection、force clobber 和更复杂的 target 解析
- [ ] 继续细化 `Glob` / `Grep` 的 schema、permission 接入、fallback 语义与结果结构
- [ ] 细化 `WebFetch` / `AskUserQuestion` 的最小行为，使其更接近 Claude Code
- [ ] 继续细化 `Anthropic` provider 的重试和更完整错误语义
- [ ] 继续细化 `OpenAI` provider 的 `responses` 流式事件、reasoning、verbosity 与更多 Responses 参数
- [ ] 为 tool 定义补更明确的 schema，而不是当前的通用 object 兜底
- [ ] 为更多 provider 预留统一配置与适配层
- [ ] 将 model limits 接入更多运行时决策，而不只是 provider 请求参数和 doctor 输出
- [ ] 梳理当前 Tool 协议与文档之间的差距
- [ ] 为阶段 6 的 permission mode 接入设计更明确的 evaluator 位置
- [ ] 扩展自动化测试覆盖到更多 `Bash` sandbox 行为与更复杂的文件语义

## In Progress

- [ ] 梳理 Claude Code 核心工具与 dclaw 当前实现之间的差距，并按优先级收口

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
- [x] 为 `Glob` 补上默认 100 条结果限制与 `truncated`
- [x] 为 `Grep` 补上默认 `head_limit=250` 与 `-A/-B/-C/context/-n/type/multiline` 基础支持
- [x] 为 `Edit / Write` 补上基础 `structuredPatch`
- [x] 为 `Edit / Write` 补上最小 `gitDiff`
- [x] 为 `Read` 补上 `isPartial` 输出标记
- [x] 建立基础自动化测试骨架并接入 `npm test`
- [x] 将自动化测试扩展到 `Glob / Grep / WebFetch / AskUserQuestion`
- [x] 将自动化测试扩展到更多 permission mode 与 `Read / Edit / Write / Bash` 边界场景
- [x] 将 `Bash` 的只读识别扩展到 `pwd` 与常见只读 `git` 命令
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
- [x] 为 `MiniMax / Kimi / GLM` 补上内置 model limits
- [x] 用本地 provider 配置完成基础 smoke test

## Backlog

- [ ] 阶段 2：Query Engine 与消息协议
- [ ] 阶段 3：System Prompt 与指令装配
- [ ] 阶段 4：`CLAUDE.md` 指令系统
- [ ] 阶段 5：Tool 协议与基础工具
- [ ] 阶段 6：权限模式与 Hooks
- [ ] 阶段 7：Session、历史与恢复
- [ ] 阶段 8：上下文管理与自动压缩
- [ ] 阶段 9：Plan / Task / Todo
- [ ] 阶段 10：Memory
- [ ] 阶段 11：多代理、Worktree 与协作执行
- [ ] 阶段 12：MCP、Skills、Plugins 与 Remote Bridge
- [ ] 阶段 13：Coding 场景增强

## 使用约定

- `Todo`：当前迭代明确要做
- `In Progress`：本轮正在做
- `Done`：已完成并确认
- `Backlog`：还未进入当前迭代
