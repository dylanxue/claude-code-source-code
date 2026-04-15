# Skill 设计

## 1. 目标

`dclaw` 中的 `skill` 对应 Claude Code 的 `SkillTool` 能力。

它的目标不是新增一种底层执行引擎，而是把一组可复用的提示词、工作流约束和上下文资源封装成可被 agent 调用的能力单元。

## 2. skill 的定位

`skill` 介于以下几者之间：

- 比普通 prompt 更结构化
- 比 builtin tool 更轻
- 比 plugin 更聚焦
- 可以作为 agent 的复用工作流入口

它适合承载：

- 标准化操作流程
- 特定任务模板
- 带约束的 prompt 执行单元
- 项目内复用能力

## 3. skill 不是什么

`skill` 不是：

- 新的底层模型 provider
- 任意代码执行沙箱
- plugin 的替代品
- MCP server 的替代品

如果能力本质上是“外部系统工具接入”，优先考虑 MCP。  
如果能力本质上是“安装型扩展”，优先考虑 plugin。  
如果能力本质上是“可复用任务模板/流程”，才适合做 skill。

## 4. skill 的核心约束

### 4.1 skill 应通过统一入口执行

后续应由 `SkillTool` 统一承载 skill 调用，不允许每个 skill 自己绕开主消息循环。

### 4.2 skill 本质上运行在 agent 上下文中

skill 不应拥有独立于 agent 之外的新上下文协议。  
它应复用：

- 当前 session
- 当前 tool set
- 当前 permission mode
- 当前 prompt/context 体系

### 4.3 skill 可以 fork，但不是必须

参考 Claude Code，skill 可以在独立 agent/forked context 中执行。  
但这属于执行策略，而不是 skill 本体定义的一部分。

### 4.4 skill 必须可发现、可描述

每个 skill 至少应具备：

- `name`
- `description`
- `source`
- 可执行内容

后续如果支持 frontmatter，还应补：

- `model`
- `effort`
- `allowedTools`
- `hooks`

## 5. skill 与其他扩展机制的关系

### 5.1 skill 与 tool

- tool 是底层能力接口
- skill 是基于 prompt/workflow 的高层复用单元

### 5.2 skill 与 plugin

- plugin 可以提供 skill
- skill 本身不负责安装和分发

### 5.3 skill 与 MCP

- MCP 提供外部 tools/resources
- skill 可以消费这些 tools/resources

## 6. skill 的加载来源

首版设计中，skill 的来源只做这三类：

1. 本地内置 skills
2. 项目目录 skills
3. plugin 提供的 skills

暂不单独设计超出 Claude Code 已体现边界的分发机制。

## 7. 建议的数据模型

建议最小结构：

```ts
type SkillDefinition = {
  name: string
  description: string
  source: 'builtin' | 'project' | 'plugin'
  prompt: string
}
```

后续扩展字段：

```ts
type SkillDefinition = {
  name: string
  description: string
  source: 'builtin' | 'project' | 'plugin'
  prompt: string
  model?: string
  effort?: 'low' | 'medium' | 'high'
  allowedTools?: string[]
  hooks?: unknown
}
```

## 8. 执行模型

建议执行流程：

```text
SkillTool
  -> resolve skill definition
  -> assemble skill prompt
  -> decide execution mode
     -> in current context
     -> or forked subagent context
  -> run
  -> collect result
  -> return tool_result
```

## 9. 进入顺序

`skill` 不进入 MVP。

建议顺序：

1. 先完成 tool / prompt / session 基础能力
2. 再做 MCP
3. 再做 skill
4. 再做 plugin 对 skill 的提供能力

## 10. 对后续开发的指导意义

这份文档主要用于约束以下问题：

- skill 是否应该单独发明一套执行协议
- skill 和 plugin / MCP 的职责如何分界
- skill 是否默认 fork
- skill 的定义最小字段是什么

后续实现 `src/skills/` 和 `src/tools/skillTool.ts` 时，应以这份文档为边界。

