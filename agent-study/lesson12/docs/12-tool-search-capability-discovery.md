# Lesson 12: ToolSearch / Capability Discovery

`lesson11` 解决的是：

- 当事实不在 workspace 里时，agent 应该通过什么外部工具获取信息

但再往前走一步，就会遇到另一个很实际的问题：

- 当工具面越来越大时，agent 怎么知道该用哪个工具？

参考 Claude Code，这件事不该只放在 prompt 里，也不该完全交给模型记忆，而应该通过显式的能力发现工具来解决。

## 参考来源

这课主要参考：

- `rust/crates/tools/src/lib.rs`

其中 Rust 侧已经有：

- `ToolSearch`

它的作用不是直接执行工作，而是帮助模型先收敛到一组更合适的工具。

## lesson12 的设计结论

这一课最终想固定的是一条新的 runtime / tool 交互习惯：

- 不确定用哪个工具时，先搜索能力

这看起来像一个小变化，但它解决的是一个会随着系统规模放大的问题：

- 工具越多，靠 prompt 和记忆越不稳定
- 动态能力进入系统后，这个问题会更明显

所以 lesson12 的重点不是“再加一个工具”，而是：

- 给 agent 一个显式的 capability discovery 层

## 当前实现

lesson12 新增：

- `ToolSearch`

输入：

- `query`
- `max_results`

输出：

- `matches`
- `query`
- `normalized_query`
- `total_deferred_tools`
- `pending_mcp_servers`

其中最核心的是：

- `matches`

当前实现会综合：

- 工具名
- 工具 family
- 工具 description

做一个简化版的 Rust 风格匹配和排序。

## 和前几课的关系

lesson10 的重点是：

- runtime decision loop 可观察

lesson11 的重点是：

- explicit external-knowledge tools

lesson12 则补上：

- explicit capability discovery

这三课连起来，agent 的 runtime 结构会更完整：

1. 观察 runtime 怎么决策
2. 给外部知识提供合法入口
3. 给工具选择提供显式发现层

## 验证方式

```bash
cd agent-study/lesson12
npm test
```

```bash
cd agent-study/lesson12
npm run smoke
```

## lesson12 的一句话总结

- 工具面变大后，不让模型纯靠记忆猜工具名，而是先用 `ToolSearch` 发现能力。
