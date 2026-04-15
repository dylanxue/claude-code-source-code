# Lesson 6: Streaming Runtime Foundations

这一课在 `lesson5` 的基础上，继续向 Claude Code / Claw Code 靠近，重点补上：

- streaming model response
- SSE event parsing
- event-driven tool/text assembly

相比第 5 课，这一课新增了：

- `src/model/streaming-sse.js`
- Anthropic-compatible adapter 支持 `stream: true`
- trace 里会记录 streaming events
- CLI 测试时会直接把 text delta 流式打印到 stdout
- CLI 测试时会额外显示基础 assistant events，例如 `[tool_use]` 和 `[message_stop]`
- streaming event 会先进入 `AgentRuntime`，再由 CLI 订阅显示
- CLI 会显示 `LLM stream: on/off`
- provider 响应如果长时间不返回或 SSE 卡住，会在请求超时后报错而不是无限挂起
- 兼容网关如果不返回 `text/event-stream`，会自动回退到非 streaming `json()`

## 推荐练习

```bash
cd agent-study/lesson6
npm start -- "请阅读 src/index.js 并解释入口流程"
```

```bash
cd agent-study/lesson6
LLM_STREAM=true npm start -- "请简短总结 lesson6 的重点"
```

```bash
cd agent-study/lesson6
LLM_STREAM=false npm start -- "请简短总结 lesson6 的重点"
```

## 学习重点

- Claude Code / Claw Code 的 runtime 更像 event loop，而不是整包响应处理器
- streaming 时要先解析 provider 事件，再组装成 text/tool_use
- tool use 的流式输入需要单独拼装，不能假设一次事件就给完整 JSON
- streaming 与 session/compaction 并不冲突，它们是同一套 runtime 的两条能力线
- 最终回答应优先作为“无 tool_use 的 assistant 文本”直接收口，而不是额外走 `final_answer` 工具
- 这一课只处理“流如何被解析、传递、显示”，不展开 compaction hardening

## 当前验证目标

- Anthropic-compatible 网关如果支持 SSE，trace 中应出现 `LLM STREAM EVENT ITERATION N`
- 如果网关不支持 SSE，也不应该把链路跑坏，而应回退到普通 JSON 响应
- tool_use 同轮如果还有 text/reasoning，CLI 应该能显示出来
- reasoning、tool_use、message_stop 都应该能在 CLI 和日志里对齐

## 不放在这一课里的内容

这些内容已经明确顺延到 `lesson7`：

- usage-driven auto compaction
- context window exceeded 后的 forced compaction
- provider 不返回 `input_tokens` 时的 compact fallback 策略
