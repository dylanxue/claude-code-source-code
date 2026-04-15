# Lesson 11: Web Search / Web Fetch

`lesson10` 让 runtime decision loop 变得可观察，但还有一个缺口没有补：

- 如果回答需要 `workspace` 外的事实，agent 应该通过什么渠道拿到这些信息？

参考 Claude Code，这件事不应该主要靠 shell 绕路，而应该靠显式的外部知识工具。

## 参考来源

这课主要参考：

- `rust/crates/tools/src/lib.rs`
- `rust/crates/runtime/src/prompt.rs`

其中 Rust 侧已经把这几类工具独立出来：

- `WebSearch`
- `WebFetch`

所以 lesson11 的目标不是发明新概念，而是把这层能力引进我们的教学版 agent。

## lesson11 的设计结论

这一课最终想固定下来的不是某个字段，而是一条系统分工原则：

- `workspace` 内事实：文件工具负责
- `workspace` 外事实：Web 工具负责
- 执行动作：shell 工具负责

如果这三件事混在一起，模型就更容易出现这些行为：

- 用 shell 去硬找外部知识
- 明明需要网页内容，却一直在本地目录里打转
- 工具边界越做越模糊

## 当前实现

lesson11 新增了两个工具：

### `WebFetch`

输入：

- `url`
- `prompt`

输出：

- `bytes`
- `code`
- `codeText`
- `result`
- `durationMs`
- `url`

实现重点：

- 跟随跳转
- HTML 转文本
- 从内容里提取标题或摘要
- 对 localhost 保持 `http`
- 对普通 `http` URL 升级到 `https`

### `WebSearch`

输入：

- `query`
- `allowed_domains`
- `blocked_domains`

输出：

- `query`
- `results`
- `durationSeconds`

其中 `results` 会同时包含：

- 面向模型的摘要文本
- 一份结构化 hit 列表

这样做的目的，是让 agent 既能直接消费摘要，也能在后续需要时继续抓取某个具体页面。

## 和 lesson9/10 的关系

lesson9 的重点是：

- factual tool signals
- minimal guardrail

lesson10 的重点是：

- observe runtime decision loop

lesson11 则是在这两者基础上补上：

- explicit external-knowledge tools

这三课合在一起，刚好形成一个更完整的 runtime 视角：

1. tool 应该返回什么
2. runtime 怎样观察这些 tool result
3. 当事实不在 workspace 里时，应该走哪类工具

## 验证方式

```bash
cd agent-study/lesson11
npm test
```

```bash
cd agent-study/lesson11
npm run smoke
```

smoke 和测试都使用本地 HTTP fixture，不要求外网可用。

## lesson11 的一句话总结

- 不把 `bash` 当作外部知识兜底，而是给 agent 显式的 `WebSearch / WebFetch` 通道。
