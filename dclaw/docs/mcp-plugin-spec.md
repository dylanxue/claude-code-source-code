# MCP / Skill / Plugin / Remote 设计

## 1. 目标

这一层对应 Claude Code 的扩展能力边界：

- MCP
- skills
- plugins
- structured IO
- remote bridge

## 2. MCP

MCP 的目标：

- 接入外部 tools
- 接入外部 resources
- 统一纳入 tool registry

与 Claude Code 当前源码对齐时，MCP 还应遵循一条额外原则：

- MCP server 的动态 instructions，不应默认长期内嵌在全局 system prompt 中
- 当 `dclaw` 后续具备类似 Claude Code 的动态增量机制时，应优先通过 attachment-style runtime reminder 注入
- 在那之前，只能保留最小静态说明，不要伪装成已经具备完整 `mcp_instructions_delta`

建议模块：

- `src/mcp/client.ts`
- `src/mcp/resources.ts`
- `src/tools/mcp/*`

## 3. Skills

`skills` 的专门约束见 [skill-spec.md](./skill-spec.md)。

skill 的目标：

- 以可复用 prompt / workflow 形式封装能力
- 允许由 agent 在独立上下文中执行

与 Claude Code 当前源码对齐时，还应注意：

- `Skill` tool prompt 负责说明“如何调用 skill”
- “当前与任务相关的 skills”应属于动态发现信息
- 这类动态发现结果后续应优先走 reminder / attachment，而不是每轮把完整 skill 列表硬塞进主 prompt
- `dclaw` 明确不实现动态 `skill_discovery`；不要用阶段性方案去伪装 Claude Code 已有的 `skill_discovery` 机制，skills 侧只对齐 `invoked_skills`

建议模块：

- `src/skills/skillTool.ts`
- `src/skills/loader.ts`

## 4. Plugins

plugin 的目标：

- 装载扩展能力
- 挂载 MCP、skills、commands、hooks

这里也要遵循同一条上游原则：

- plugin 带来的能力变化，如果会影响可用 tool / skill / agent 集合，应尽量通过 runtime reminder 增量告知模型
- 不应因为 plugin 热插拔，把一大段动态清单永久写死在 system prompt 中

建议模块：

- `src/plugins/loader.ts`
- `src/plugins/manifest.ts`
- `src/plugins/registry.ts`

## 5. Structured IO

structured IO 的目标：

- 支持 headless / SDK 模式稳定输出
- 让上层调用方以机器可读格式消费消息流

建议模块：

- `src/remote/structuredIO.ts`

## 6. Remote Bridge

remote bridge 的目标：

- 支持远程会话
- 支持桥接控制
- 支持 remote session 生命周期管理

建议模块：

- `src/remote/bridge.ts`
- `src/remote/sessionManager.ts`

## 7. 进入顺序

这些能力全部放在后期：

1. 先 MCP
2. 再 skills
3. 再 plugins
4. 最后 structured IO / remote bridge

## 8. Reminder 对齐原则

如果 `dclaw` 继续向 Claude Code 当前源码靠拢，这一层后续应优先补的是“能力如何被动态告知模型”，而不是把更多能力说明继续堆进总 prompt。

除 `plan / task` 外，Claude Code 当前源码里最值得对齐的 reminder 类型，主要是：

1. `Agent`
   - 动态 agent 类型列表走 reminder
   - 静态 Agent 使用规则留在 tool prompt

2. `Skill`
   - 当前相关的 skills 走 reminder
   - Skill 调用方法留在 tool prompt

3. `MCP`
   - server instructions 走 reminder
   - MCP 基础存在性和调用边界可保留最小静态说明

4. `ToolSearch`
   - deferred tools 的动态可用列表走 reminder
   - ToolSearch 自身只负责加载 deferred tools

`dclaw` 的实现边界也应写清楚：

- 只有当某项动态能力真实存在时，才引入对应 reminder
- 在能力未完成前，可以做“阶段性方案提醒”的最小近似
- 但不要伪装成已经实现 Claude Code 的完整 delta / attachment 机制

建议的落地顺序：

1. 先做统一的 `<system-reminder>` runtime 注入基础设施
2. 再按条件补 `Agent / Skill / MCP / ToolSearch` 四类 reminder
3. 最后再考虑收敛成更完整的结构化 attachment 与恢复语义
