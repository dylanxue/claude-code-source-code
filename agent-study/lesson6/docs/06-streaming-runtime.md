# 第 6 课：Streaming Runtime Foundations

这一课我们开始补上和 Claude Code / Claw Code 差距非常大的一块：streaming runtime。

## 为什么这一课重要

如果 agent 只会等整包响应回来再处理，那它和真正的 Claude Code / Claw Code 还有很大差距。

在 Claude Code 里，模型输出不是被当成“一个完整 JSON 包”处理的，而是被拆成事件流：

- `TextDelta`
- `ToolUse`
- `MessageStop`

对应源码可以看：

- `rust/crates/tools/src/lib.rs`
- `rust/crates/runtime/src/conversation.rs`

## 这一课新增的核心文件

- `src/model/streaming-sse.js`
  负责把 SSE 字节流切成事件
- `src/model/anthropic-messages-model.js`
  从“整包 json()”升级成“优先 streaming，失败再回退”

## 这次实现了什么

### 1. Anthropic-compatible adapter 开始请求 streaming

lesson6 里，Anthropic-compatible adapter 默认会请求：

```json
{
  "stream": true
}
```

这意味着 provider 如果支持 SSE，就会持续返回事件，而不是一次性返回完整 message。

### 2. 我们开始把 SSE 解析成事件

`src/model/streaming-sse.js` 负责做最小流解析：

- 读取 `ReadableStream`
- 按 `\n\n` 切分 SSE frame
- 识别 `event:` / `data:`
- 把每一帧解析成结构化事件

这一步和 Claude Code 的方向是一致的：先拿到 event，再交给上层组装。

### 3. lesson6 开始流式组装 text 和 tool_use

在 `src/model/anthropic-messages-model.js` 里，我们现在会处理这些 Anthropic-style 事件：

- `message_start`
- `content_block_start`
- `content_block_delta`
- `content_block_stop`
- `message_delta`
- `message_stop`

特别是两种 delta：

- `text_delta`
  持续拼接 assistant 文本
- `input_json_delta`
  持续拼接 tool input JSON

这正是从 Claude Code 那边学来的关键点：
tool input 在 streaming 模式下不能假设一次就完整给出，而要按 index/块逐步组装。

### 4. 如果网关不支持 SSE，会自动回退

lesson6 没有激进到“必须 streaming 成功，否则整个调用失败”。

当前策略是：

- 如果响应头是 `text/event-stream`
  就走 streaming 解析
- 否则
  自动回退到 `response.json()`

这样教学体验会更稳定，也更适合面对 OpenAI-compatible / Anthropic-compatible 网关的差异。

### 5. trace 现在会记录 stream event

如果 streaming 生效，trace 文件里会新增：

- `LLM STREAM EVENT ITERATION N`

这样你可以直观看到 provider 是如何一段一段吐出：

- text delta
- tool_use
- stop reason

### 6. runtime/CLI 开始消费基础 assistant events

lesson6 现在不只是“模型层支持 streaming”，而是开始形成：

`provider stream -> model adapter -> AgentRuntime -> CLI`

目前 CLI 会消费一部分流式事件：

- `text_delta`
  直接打印正文
- `tool_use`
  打印成 `[tool_use] read_file {...}`
- `message_stop`
  打印成 `[message_stop] stop_reason=...`

这还不是 Claude Code 那种完整的 runtime event bus，但已经开始从“模型内部细节”走向“runtime/CLI 可观察事件”了。

### 6.1 lesson6 现在也会处理 reasoning 和 mixed content

今天这版 lesson6 里，还有两个很关键但很容易被忽略的补丁：

- `thinking/reasoning` 不再被静默丢掉
- 同一轮里如果同时出现 `text + tool_use`，text 也不会被忽略

这意味着 CLI 看到的已经不只是：

- `[tool_use] ...`
- `[message_stop] ...`

还会包括：

- `[reasoning] ...`
- `[assistant] ...`

以及一些 provider 没有按 delta 发出来、但最终 payload 里存在的文本快照补发。

### 6.2 lesson6 已改成“无 tool_use 即收口”

为了更贴近 Claude Code，lesson6 现在不再依赖 `final_answer` 工具来结束一轮任务。

更自然的结束语义是：

- 如果这一轮 assistant 响应里还有 `tool_use`
  继续执行工具
- 如果这一轮 assistant 响应里没有 `tool_use`
  就直接把 assistant 文本作为最终回答收口

这样 streaming runtime 的时序会更自然，也更容易和真实产品行为对齐。

### 7. 为流式请求补上超时保护

lesson6 现在还补了一层更接近真实产品的保护：

- `LLM_REQUEST_TIMEOUT_MS` 控制单次模型请求超时
- 超时覆盖整次请求生命周期，包括：
  - 等待响应头
  - 读取 SSE 流
  - 读取普通 JSON body

这样当兼容网关在某一轮 tool result 之后不继续返回 SSE 事件时，agent 不会无限卡住，而会给出可定位的 timeout 错误。

## lesson6 和 lesson5 的差别

lesson5 的重点是：

- session compaction
- summary continuation
- compact metadata

lesson6 的重点是：

- 把模型响应从“整包处理”升级成“事件流处理”
- 学会区分 provider 流协议和内部 runtime 语义
- 开始向 Claude Code / Claw Code 的 event-driven runtime 迈进

这节课刻意不继续深入：

- usage-driven auto compaction
- forced compaction on context-limit
- compact fallback policy

这些内容已经顺延到 `lesson7`，避免 lesson6 主题发散。

## 这离 Claude Code / Claw Code 还有多远

lesson6 只是 streaming runtime 的第一步，还没有完全追上：

- 还没有把 streaming event 做成更完整的统一 runtime 总线
- 还没有做统一的 provider stream abstraction
- 还没有像 Claude Code 那样形成更明确的 `AssistantEvent` 管道
- 还没有做 OpenAI-compatible streaming tool call 拼装

但 lesson6 已经很关键，因为我们终于不再把“模型输出”默认为完整 JSON 了。

## 推荐实验

```bash
cd agent-study/lesson6
npm start -- "请简短总结 lesson6 的重点"
```

然后去看：

- `.logs/llm-trace-*.log`

重点观察：

- 有没有 `LLM STREAM EVENT ITERATION N`
- tool input 是否通过多次 delta 被逐步组装
- 如果 provider 不支持 SSE，是否自动回退到整包 JSON
- CLI 是否能按 `[reasoning] / [assistant] / [tool_use] / [message_stop]` 对齐显示
