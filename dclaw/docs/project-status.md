# 项目状态

## 当前状态

- 项目名称：`dclaw`
- 当前阶段：阶段 5 进行中
- 当前版本目标：`v0.1`
- 总体状态：`in progress`

## 阶段进展

| 阶段 | 名称 | 状态 | 备注 |
|---|---|---|---|
| 1 | CLI 与运行入口 | completed | 最小 CLI 入口已跑通 |
| 2 | Query Engine 与消息协议 | completed | 已有最小消息模型、LLM 抽象、QueryEngine、queryLoop |
| 3 | System Prompt 与指令装配 | in progress | 最小 prompt assembler 与基础版 `CLAUDE.md` 指令链路已可用 |
| 4 | `CLAUDE.md` 指令系统 | in progress | 基础版多层发现、include、去重、顺序可观察性已可用 |
| 5 | Tool 协议与基础工具 | in progress | 工具名和最小链路已接入，但工具语义与 Claude Code 仍有明显差距 |
| 6 | 权限模式与 Hooks | not started | 已完成方案设计，未编码 |
| 7 | Session、历史与恢复 | not started | 已完成方案设计，未编码 |
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
- 将 `Bash` 补上最小 `run_in_background` 能力，并将后台输出落盘到 `.dclaw/background-tasks/`
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

## 当前风险与注意事项

- 当前已完成 Query Engine 最小链路和基础 prompt/`CLAUDE.md` 注入，已进入基础多轮 tool loop
- 当前 tool loop 已有基础多轮 assistant->tool->assistant 闭环，并已补上最小 permission evaluator，但还没有更细粒度规则
- 当前工具层主要完成的是“名字和最小链路对齐”，离 Claude Code 的完整工具语义还差很远
- 当前 `Read / Edit / Write` 已进入“基础语义收紧”阶段，并补上了基础 `structuredPatch`、最小 `gitDiff` 与更明确的 warning 语义，但和 Claude Code 的完整 diff / patch /复杂文件支持还有明显差距
- 当前 `Bash / Glob / Grep` 已补上部分核心语义；`Bash` 已有最小后台任务、大输出落盘、mode 级 unsandboxed 入口和最小 permission evaluator，但真正的 sandbox 行为和更细粒度 permission 规则仍未接入
- 当前 `WebFetch / AskUserQuestion` 仍然只是最小实现
- 当前 `LLM` 层仍以 `stub` provider 为主，真实模型服务尚未接入
- 当前自动化测试已覆盖 `Read / Edit / Write / Bash / Glob / Grep / WebFetch / AskUserQuestion` 与权限执行链路，并包含一批关键边界场景，但整体覆盖面仍然有限
- 文档约束已经较明确，后续开发需尽量遵守，不要边写边扩大范围
- 当前 `CLAUDE.md` 仍是基础版实现，未覆盖完整 include 语义和所有优先级细节
- 当前 `CLAUDE.md` 尚未覆盖 managed memory、frontmatter 条件规则、instruction hooks 等细节
- 阶段 1 开始后，应持续维护本文件状态

## 下一步

下一步进入：

- 阶段 5：Tool 协议与基础工具继续推进

第一批目标：

- 优先细化已有核心工具语义，而不是继续横向补更多工具
- 先补 `Read / Edit / Write / Bash / Glob / Grep`
- 再补 `WebFetch / AskUserQuestion`
- 下一批优先补 `Bash` 的权限接入点、sandbox 行为和更稳的结果持久化语义
- 同步继续细化 `Read / Edit / Write`，向 Claude Code 的更完整 diff / patch / 文件类型支持靠近
- 接入第一个真实 LLM provider，结束当前仅靠 `stub` provider 的状态
- 优先实现 `Anthropic` provider 的最小非流式调用链路
- 为真实 LLM 接入补配置读取、key 校验与错误处理
- 为后续权限模式与 hooks 接入 tool 执行链路预留接口
- 继续完善 tool contract
