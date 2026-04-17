# Prompt 系统设计

## 1. 目标

`dclaw` 的 prompt 系统要实现和 Claude Code 相同的核心思路：

- 固定默认 system prompt
- 按 section 组装动态上下文
- 接收来自 `CLAUDE.md`、memory、MCP、hooks 的追加信息
- 对 interactive 和 headless 复用同一套 prompt 组装流程

## 2. 设计原则

1. section 化
2. 可组合
3. 可缓存
4. 可增量扩展

## 3. 主要 section

### 3.1 基础 system section

定义 agent 的角色、输出方式、工具执行方式、系统提醒语义。

### 3.2 doing tasks section

强调任务执行原则：

- 不超出用户要求
- 不凭空假设代码结构
- 优先读再改
- 忠实汇报结果

### 3.3 actions with care section

强调风险操作的处理方式：

- 共享系统操作需谨慎
- 难以回滚的动作需要确认

### 3.4 hooks section

向模型说明 hooks 的存在与反馈来源。

### 3.5 memory section

向模型说明 memory 是长期持久化能力，并区分其与 plan/task 的边界。

### 3.6 plan / task context section

向模型注入当前执行状态，至少包括：

- 当前是否处于 `plan mode`
- 当前 task
- 当前步骤
- todo 摘要

这一 section 的目的不是把完整 task board 原样塞进 prompt，而是用受控摘要告诉模型“现在是在规划还是在执行”。

详细约束见 [plan-task-spec.md](./plan-task-spec.md)。

### 3.6.1 Task Tool Prompt

这里需要单独补一条与 Claude Code 当前源码对齐的规则：

- `TaskCreate / TaskList / TaskGet / TaskUpdate` 的具体使用规则，不应主要写在全局 system prompt
- 这些规则应主要写在各个 tool 的专属 prompt 中
- 模型通过 API tool definition 的 `description` 看到这些 prompt

Claude Code 当前源码就是这样做的：

- 每个 task tool 都有自己的 `prompt.ts`
- API 层构造 tool schema 时，发送给模型的是 `await tool.prompt(...)`
- 因此模型看到的是“长版 tool 使用说明”，而不是只有一个短描述

对 `dclaw` 来说，这意味着：

- system prompt 里只保留 plan/task 的全局边界和当前状态摘要
- `Task*` 的具体工作流规则，下沉到 tool prompt
- 避免把 task tool 的详细使用时机、状态流转、先后顺序重复写在 system prompt 和 tool prompt 两处

### 3.7 MCP section

说明 MCP tools/resources 的存在及使用方式。

### 3.8 language / output style section

注入语言偏好和输出风格。

## 4. Prompt 组装顺序

建议顺序：

1. 默认 system prompt
2. 固定 section
3. runtime context
4. `CLAUDE.md` 指令
5. plan / task context
6. memory prompt
7. MCP instructions
8. hooks instructions
9. 用户追加 prompt

## 5. 关键实现点

### 5.1 统一入口

所有 prompt 组装都应收敛到 `src/prompt/systemPrompt.ts`。

### 5.2 动静分离

静态部分：

- 角色定义
- 通用执行原则

动态部分：

- cwd
- git 状态
- `CLAUDE.md`
- task / todo / current step 摘要
- memory
- MCP
- language
- output style

### 5.3 兼容 headless

headless 模式不能使用不同 prompt 体系，只能改变 section 注入内容。

### 5.4 Tool Prompt 基础设施

为了与 Claude Code 对齐，`dclaw` 已把 tool prompt 纳入统一 prompt 体系：

1. 扩展 `src/tools/types.ts`
   - `Tool` 同时支持静态 `description` 与长版 `prompt()`

2. 调整 `queryLoop` 的 tool definition 构造
   - 当前发送给模型的是 `tool.prompt()` 的结果

3. 区分两类文案
   - 短描述：给本地代码、日志、未来 UI 用
   - 长 prompt：专门发给模型，承担“如何使用这个 tool”的职责

4. 保持 session 稳定性
   - Claude Code 会尽量保持同一 session 内 tool description 稳定，避免 prompt cache 抖动
   - `dclaw` 首版可先实现正确性，后续再考虑 session 级 cache

## 6. 当前已实现的最小形态

当前代码中已经落地的最小 prompt 链路包括：

- `prompt context`
- `System` section
- `Doing Tasks` section
- `Runtime Context` section
- `CLAUDE.md Instructions` section
- `User Override` section

当前已经做到 Claude Code 那种最小 tool prompt 体系：

- `dclaw` 的 tool definition 发送给模型时，会优先使用 `tool.prompt()`
- `Task*` 已接入长版 task-tool 使用规范
- 因此当前 task tool 已不只是“功能已存在”，也具备了最小提示策略对齐

当前基础版 `CLAUDE.md` 发现规则包括：

- 默认用户级 `CLAUDE.md`：`~/.dclaw/CLAUDE.md`
- 若设置 `DCLAW_HOME`：`<DCLAW_HOME>/CLAUDE.md`
- 从当前 `cwd` 向上查找 `<dir>/CLAUDE.md`
- 从当前 `cwd` 向上查找 `<dir>/.claude/CLAUDE.md`
- 从当前 `cwd` 向上查找 `<dir>/.claude/rules/*.md`
- 从当前 `cwd` 向上查找 `<dir>/CLAUDE.local.md`

当前基础版 `CLAUDE.md` include 规则包括：

- 支持整行 `@path`
- 支持整行 `@./relative/path`
- 支持整行 `@~/home/path`
- 支持整行 `@/absolute/path`
- 被包含文件会先于包含它的文件注入
- 当前实现带有去重与循环保护
- 当前实现会在非代码块、非 HTML 注释区域提取 include 路径
- 当前实现保留原文件中的 `@include` 文本，不会删除
- 当前实现支持带转义空格的路径
- 当前实现会去掉 include 路径中的 `#fragment`

这还不是 Claude Code 的完整实现，但已经具备后续继续扩展的稳定接入点。

## 7. 当前明确未支持

当前实现还没有覆盖这些 Claude Code 细节：

- managed memory / 托管指令来源
- 更完整的 frontmatter 解析与基于 `paths` 的条件规则
- 指令加载相关 hooks
- excludes / 忽略规则
- 更严格的“仅叶子文本节点提取 include”语义
- 与 read state / session state 的联动
- tool prompt / API tool description 这条完整链路

## 8. Task Tool Prompt 对齐改造方案

目标：让 `dclaw` 关于 `Task*` 的模型提示方式，与 Claude Code 当前源码一致。

### 8.1 Claude Code 当前做法

基于平级 `claude-code` 源码，当前事实是：

- `TaskCreate` 的 prompt 定义“什么时候该建 task、什么时候不该建、先 `TaskList` 再创建、开始前标 `in_progress`、完成后标 `completed`”
- `TaskList` 的 prompt 定义“查看可做工作、完成后再 list、多个任务按 ID 顺序优先”
- `TaskGet` 的 prompt 定义“开始前读取完整描述和依赖，确认 `blockedBy` 为空”
- `TaskUpdate` 的 prompt 定义“何时能标完成、何时应保持 `in_progress`、更新前先 `TaskGet`、支持 `deleted` / `addBlocks` / `addBlockedBy`”
- 这些内容不是 system prompt 的一部分，而是 tool prompt 的一部分

### 8.2 `dclaw` 当前差距

- `dclaw` 已有 `TaskCreate / TaskList / TaskGet / TaskUpdate`
- 当前已补齐长版 `prompt()` 和 query loop 侧的 tool prompt 发送
- 剩余差距主要不是 task tool prompt 本身，而是更完整的 Claude Code 周边能力

### 8.3 改造目标

阶段 9 后续需要补齐下面这条链路：

1. [x] tool 基础设施支持 `prompt()`
2. [x] API tool definition 改为向模型发送 `prompt()` 结果
3. [x] 为 `TaskCreate / TaskList / TaskGet / TaskUpdate` 补齐 Claude Code 风格 prompt
4. [x] system prompt 中不再重复承载细粒度 task workflow

### 8.4 首版实施范围

严格按 Claude Code 当前主线，首版只补：

- `TaskCreate`
- `TaskList`
- `TaskGet`
- `TaskUpdate`

并且只覆盖当前 `dclaw` 已实现的单 session / task board 场景。

明确不做：

- teammate / swarm 专属 task prompt 分支
- mailbox / owner 自动派发
- verification agent nudge
- hooks 驱动的 task created / task completed side effects

### 8.5 推荐实施顺序

1. 基础设施改造
   - [x] 给 `Tool` 增加 `prompt()` 能力
   - [x] `queryLoop` / provider 发送 tool schema 时使用 `prompt()`

2. task tool prompt 落地
   - [x] 新建 `src/tools/builtin/taskCreatePrompt.ts`
   - [x] 新建 `src/tools/builtin/taskListPrompt.ts`
   - [x] 新建 `src/tools/builtin/taskGetPrompt.ts`
   - [x] 新建 `src/tools/builtin/taskUpdatePrompt.ts`

3. 文案边界收口
   - 全局 system prompt 只保留 plan/task 的高层规则
   - task tool 的具体工作流指导只保留在 tool prompt

4. 验证
   - [x] 单测验证发给模型的 tool definition 已包含长版 task prompt
   - [x] 单测验证 task tool prompt 至少覆盖 Claude Code 当前的核心规则

因此，当前这一层更适合被视为：

- 可工作的基础版 `CLAUDE.md` 指令系统
- 已足够支撑后续主线开发
- 但还不是完整对齐 Claude Code 的最终形态
