# 第 10 课：Runtime Decision Loop

lesson9 已经把系统收敛到：

- tool 返回事实
- runtime 只保留最小 guardrail
- tool result 直接进入 session

但这时还剩一个很实际的问题：

- runtime 自己到底是怎么决定“继续还是停止”的？
- 一轮 tool batch 之后，系统怎么知道当前状态更健康还是更危险？
- 当我们调试 agent 时，怎么快速看懂每一轮 orchestration 在做什么？

所以 lesson10 的重点不是继续扩工具面，而是把 runtime orchestration 显式化。

## 本课新增的核心东西

lesson10 在 runtime 里新增了一个结构化 `decisionJournal`：

- 每轮 model decision 都会记录
- tool batch 执行完成后也会记录
- 最终 `run()` 返回值会把这份 journal 一起带出来

当前 journal 至少覆盖三类 entry：

- `model_decision`
- `tool_results`
- 下一轮 `model_decision`

典型的一次两轮 run 会长这样：

1. 第 1 轮模型决定调用工具
2. runtime 执行工具，并记录这批 tool results 的摘要
3. 第 2 轮模型决定产出 final answer

## 为什么这一步重要

lesson9 强调的是：

- runtime 不替模型写策略

但“不替模型写策略”不等于 runtime 没有自己的 decision loop。

真实系统里 runtime 仍然要负责：

- 记录每轮 decision type
- 观察 request budget
- 判断 tool batch 是否重复
- 判断是否出现 pre-tool-use block
- 汇总一轮 tool results 的成功 / 失败 / blocked 情况

只是这些东西不应该再偷偷藏在 runtime 内部。

lesson10 的意思是：

- runtime 可以保持轻
- 但 runtime 的决策过程应该变得可观察

## lesson10 当前实现

现在 `AgentRuntime.run()` 会返回：

- `output`
- `session`
- `iterations`
- `decisionJournal`

同时 runtime 也会发出新的事件：

- `channel: "runtime_decision"`

所以除了看 summary log，现在还可以直接在内存里拿到每轮 decision 的结构化轨迹。

## 推荐实验

```bash
cd agent-study/lesson10
npm test
```

```bash
cd agent-study/lesson10
npm run smoke
```

```bash
cd agent-study/lesson10
RUNTIME_DECISION_DEBUG=true npm start -- "列出 src 然后结束"
```

最后这条命令会在 CLI 上把 runtime decision event 打出来，帮助你观察：

- 什么时候进入 tool 决策
- tool batch 执行后发生了什么
- 什么时候收口到 final
