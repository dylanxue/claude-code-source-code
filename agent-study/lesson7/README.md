# Lesson 7: Compaction Hardening

这一课承接 `lesson6`，不再扩 streaming 基础能力，而是专门收敛“长上下文如何稳定继续”的问题。

重点会放在：

- usage-driven auto compaction
- provider context window error 后的 forced compaction
- provider 没返回 `input_tokens` 时的 fallback 策略
- compaction 日志、调试和课程边界整理

## 这节课为什么单独拆出来

今天验证下来，compaction 相关内容已经足够独立成一课：

- `lesson5` 已经讲了“基础 compaction 机制”
- `lesson6` 应该聚焦在 streaming runtime
- 更接近 Claude Code 的 compaction hardening 会明显拉高复杂度

所以这里单独新开 `lesson7`，把这些增强版能力集中讲清楚。

## 当前状态

- 当前 `lesson7` 目录从 `lesson6` 复制而来，作为下一课起点
- `lesson6` 已回到“以 streaming 为主”的教学边界
- 这一课已经不只是规划，当前代码里已经落地了第一版 compaction hardening
- OpenAI-compatible 路径已经验证能返回真实 `prompt_tokens`，runtime 也已经能按真实 input usage 驱动 compact
- Anthropic-compatible 路径更早一轮实验里没有稳定拿到真实 `input_tokens`，但 `run-2026-04-13T00-30-11-433Z-8ec582` 已经确认当前 minimax Anthropic-compatible 链路会返回真实 `input_tokens`
- runtime 已经把三类信号拆开记录：
  - `providerUsageMode`
  - `requestBudgetMode`
  - `compactionMode`
- provider-usage compact 已接入最小 watermark / min-delta 节流，避免一过阈值就每轮 compact
- OpenAI-compatible 路径已经支持 SSE streaming，和 Anthropic 路径一样会向 CLI 发出 `text_delta / reasoning_delta / tool_use / message_stop`
- compact summary 现在已经有第一版 `LLM-based summary`，并保留 heuristic fallback 作为兜底

## 预期主线

这一课计划沿着下面这条线展开：

1. 先确认 Claude Code 如何记录和使用真实 usage
2. 再把教学版 compaction 从“粗估主导”推进到“usage 优先、粗估兜底”
3. 继续解决 repeated compaction、阈值策略和模型预算联动
4. 继续验证第一版 LLM-based summary 是否稳定，并评估是否要进一步增强
5. 最后补上 context window 报错后的恢复和调试日志

## 这一课最重要的学习点

- compaction 不是“触发了就一定更好”，策略不当反而会伤害回答质量
- 真实 provider usage 和启发式估算是两套不同信号，不能混成一个概念
- forced compaction 解决的是极端兜底，不是日常主路径
- 调试 compaction 时，必须同时看 `cli-run`、`run-summary`、`llm-trace`

## 推荐实验

```bash
cd agent-study/lesson7
npm start -- --resume latest "继续刚才的任务，并尽量多读一些内容后再总结"
```

```bash
cd agent-study/lesson7
SESSION_AUTO_COMPACT_INPUT_TOKENS=2000 npm start -- "解释下我们lesson1-Lesson6分别做了什么事情"
```

```bash
cd agent-study/lesson7
SESSION_AUTO_COMPACT_INPUT_TOKENS=2000 LLM_TRACE=true npm start -- "解释下我们lesson1-Lesson6分别做了什么事情"
```

## 预期结果怎么判断

- 如果 compact 合理，`run-summary` 里应该能看出明确的触发原因
- 如果 compact 不合理，通常会看到频繁触发、压缩收益很低，或者最终回答开始泛化
- 如果 provider 没给 `input_tokens`，文档和实现都应该明确说明当前走的是 fallback 逻辑
- 如果 provider 给了真实 `prompt_tokens`，日志里应该明确显示 `providerUsageMode: "provider_usage"`
- 如果 Anthropic-compatible 链路也返回了真实 `input_tokens`，同样应该看到：
  - `providerUsageMode: "provider_usage"`
  - `compactionMode: "provider_usage"`
- 如果 provider-usage compact 已真正生效，日志里应能看到：
  - `trigger.reason = "cumulative_input_tokens"`
  - `trigger.mode = "provider_usage"`
  - `removedMessageCount > 0`
- 如果 min-delta 节流生效，compact 后应该出现一段“安静期”，而不是每轮都再次 compact
- 如果 LLM summary 生效，`run-summary` 里应该能看到：
  - `summaryMode: "llm"`
- 如果 LLM summary 失败并自动降级，也应该能看到：
  - `summaryMode: "heuristic_fallback"`
  - `summaryError`

## 建议阅读顺序

- 先看 [docs/06-streaming-runtime.md](/Users/ke.xue/work/claude-code-source-code/agent-study/lesson7/docs/06-streaming-runtime.md)
- 再看 [docs/07-compaction-hardening.md](/Users/ke.xue/work/claude-code-source-code/agent-study/lesson7/docs/07-compaction-hardening.md)
