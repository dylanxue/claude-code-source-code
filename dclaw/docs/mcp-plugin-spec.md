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

建议模块：

- `src/mcp/client.ts`
- `src/mcp/resources.ts`
- `src/tools/mcp/*`

## 3. Skills

`skills` 的专门约束见 [skill-spec.md](./skill-spec.md)。

skill 的目标：

- 以可复用 prompt / workflow 形式封装能力
- 允许由 agent 在独立上下文中执行

建议模块：

- `src/skills/skillTool.ts`
- `src/skills/loader.ts`

## 4. Plugins

plugin 的目标：

- 装载扩展能力
- 挂载 MCP、skills、commands、hooks

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
