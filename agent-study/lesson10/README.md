# Lesson 10: Runtime Decision Loop

这一课承接 `lesson9`，但重点不再是继续补工具字段。

`lesson9` 已经把系统收敛到：

- tool 返回事实型结果
- runtime 只保留最小 deterministic guardrail
- tool result 直接进入 session，由 compaction 负责后续压缩

走到 `lesson10`，我们开始处理另一件更接近真实 runtime 的事：

- 把 orchestration 自己变得可观察

## 当前目标

lesson10 现在主要做三件事：

1. 把每轮 model decision 结构化成可读 journal
2. 把 tool batch 执行结果整理成 runtime 级摘要
3. 让 CLI 和测试都能直接观察“为什么继续、为什么停止”

## 当前实现

现在 `AgentRuntime.run()` 除了返回：

- `output`
- `session`
- `iterations`

还会额外返回：

- `decisionJournal`

这份 journal 当前会记录两类核心 entry：

- `model_decision`
- `tool_results`

典型的一次 run 会留下这种轨迹：

1. 第 1 轮模型决定走 `tools`
2. runtime 执行这批 tool call，并记录 `ok / blocked / error`
3. 下一轮模型决定走 `final`

## 这课新增的观察面

lesson10 现在不只是把这些信息写进 summary log，还把它们显式暴露成：

- `run()` 返回值里的 `decisionJournal`
- `channel: "runtime_decision"` 的 runtime event

所以现在我们可以同时从三层看 runtime orchestration：

- session：看消息历史
- summary log：看长文本 run trace
- decision journal：看每轮决策骨架

## 为什么这一步重要

lesson9 的重要结论是：

- runtime 不该替模型写 continuation 策略

但这不等于 runtime 没有 decision loop。

真实系统里 runtime 仍然必须负责这些事：

- 当前轮是 `tools` 还是 `final`
- tool batch 有没有重复
- 有没有 pre-tool-use block
- 当前 request budget 压力大不大
- 一轮工具执行后，成功 / blocked / error 分布是什么

lesson10 做的不是把 runtime 再做重，而是把这些本来就存在的 orchestration 信息显式化。

## 当前课程口径

所以 lesson10 的定位可以压成一句话：

- `Observe the runtime loop before redesigning it`

也就是：

- 先把 runtime 自己的 decision trace 看清楚
- 再决定后面是否值得进入 pinned context、retained messages、或者更复杂的 turn policy

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

最后这条命令会额外打印 lesson10 新增的 runtime decision trace。

## 当前判断标准

如果 lesson10 的方向是对的，应该看到这些结果：

- runtime decision 不再只埋在日志文本里
- 一轮 run 的 stop / continue 轨迹可以被结构化读取
- tool batch 之后的健康度可以快速判断
- 新的观察能力没有把 runtime 再做成 policy engine

## 下一步候选

lesson10 之后，最自然的后续主题有两条：

- `Pinned Context / Retained Messages`
- 更明确的 turn-level continuation / stop heuristics

但在进入那一步之前，lesson10 先把 runtime decision loop 本身变成了一个可以观察、可以讨论、可以验证的对象。
