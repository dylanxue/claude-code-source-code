# dclaw 文档索引

## 当前快照

- 当前处于 `v0.3` 准备阶段
- 阶段判断：阶段 8-10 已按当前范围收口；`v0.3` 只聚焦 `subagent + skills`，其它未完成项统一后置到 `v0.4`
- 当前已落地的主链路包括：
  - 真实 `Anthropic / OpenAI` provider
  - `Read / Edit / Write / Bash / Glob / Grep / WebFetch / AskUserQuestion`
  - 4 种 `permission mode`
  - session store / resume / history
  - interactive REPL 与首批 slash commands
  - `compact` 主路径
  - `Plan / Task` 主路径
  - `Memory` 主路径
- 当前已真实落地、但不进入本轮 `v0.2` 主线的能力：
  - 多模态输入第一阶段
  - 用户图片输入
  - `WebFetch` 远程图片读取
  - 工具结果图片 -> runtime 临时图片消息桥接
- 当前最值得先看的状态文档：
  - [project-status.md](./project-status.md)
  - [dev-tasks.md](./dev-tasks.md)
  - [work-log.md](./work-log.md)

## 推荐阅读顺序

### 主文档

这 3 份是后续长期维护的主入口：

1. [01-总体方案](./01-总体方案.md)
2. [02-MVP设计](./02-MVP设计.md)
3. [03-扩展设计](./03-扩展设计.md)

### 进展记录

- 想先知道“现在做到哪里”：先看 [project-status.md](./project-status.md)
- 想看当前主线和剩余缺口：再看 [dev-tasks.md](./dev-tasks.md)
- 想看最近几轮具体改动：补看 [work-log.md](./work-log.md)

- [project-status.md](./project-status.md)
- [dev-tasks.md](./dev-tasks.md)
- [work-log.md](./work-log.md)

### 专题文档

这些文档保留更细的约束和实现细节，供后续分模块开发时查阅：

- [plan-centered-design.md](./plan-centered-design.md)
- [plan-task-runtime-split-design.md](./plan-task-runtime-split-design.md)
- [architecture.md](./architecture.md)
- [phases.md](./phases.md)
- [mvp-tech-design.md](./mvp-tech-design.md)
- [prompt-system.md](./prompt-system.md)
- [tool-spec.md](./tool-spec.md)
- [plan-task-spec.md](./plan-task-spec.md)
- [memory-spec.md](./memory-spec.md)
- [tui-design.md](./tui-design.md)
- [skill-install-dialog-design.md](./skill-install-dialog-design.md)
- [multimodal-input-todo.md](./multimodal-input-todo.md)
- [agent-spec.md](./agent-spec.md)
- [skill-spec.md](./skill-spec.md)
- [mcp-plugin-spec.md](./mcp-plugin-spec.md)

## 使用方式

- 想快速理解项目：先读 `01 -> 02 -> 03`
- 想先判断项目现在在哪个阶段：先读 `project-status -> dev-tasks`
- 想进入实现：先读 `02-MVP设计`，再对照 `project-status`
- 想做某个模块：先看对应专题文档，再对照 `dev-tasks` 与 `phases`
