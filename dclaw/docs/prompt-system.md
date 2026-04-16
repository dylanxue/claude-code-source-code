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

### 3.6 MCP section

说明 MCP tools/resources 的存在及使用方式。

### 3.7 language / output style section

注入语言偏好和输出风格。

## 4. Prompt 组装顺序

建议顺序：

1. 默认 system prompt
2. 固定 section
3. runtime context
4. `CLAUDE.md` 指令
5. memory prompt
6. MCP instructions
7. hooks instructions
8. 用户追加 prompt

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
- memory
- MCP
- language
- output style

### 5.3 兼容 headless

headless 模式不能使用不同 prompt 体系，只能改变 section 注入内容。

## 6. 当前已实现的最小形态

当前代码中已经落地的最小 prompt 链路包括：

- `prompt context`
- `System` section
- `Doing Tasks` section
- `Runtime Context` section
- `CLAUDE.md Instructions` section
- `User Override` section

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

因此，当前这一层更适合被视为：

- 可工作的基础版 `CLAUDE.md` 指令系统
- 已足够支撑后续主线开发
- 但还不是完整对齐 Claude Code 的最终形态
