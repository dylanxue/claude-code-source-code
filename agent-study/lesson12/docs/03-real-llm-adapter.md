# 第 3 课：接入真实 LLM Adapter

这一课我们终于把 `MockModel` 推进成了真实模型适配层。

## 为什么第 3 课才接 LLM

这是一个很重要的架构顺序。

如果一开始就先接模型，很容易把这些边界搅在一起：

- CLI 入口
- runtime loop
- 工具协议
- provider API
- 权限和错误处理

所以我们故意先做：

1. 最小 agent loop
2. 工具执行层
3. 真实模型 adapter

这样你会更清楚：LLM 只是 agent 的一层，不是 agent 本身。

## 这一课新增的核心文件

- `src/model/create-model.js`
  负责加载本地配置并创建真实模型适配器。
- `src/model/openai-responses-model.js`
  负责把 session 消息和工具 schema 转成 OpenAI Responses API 请求。
- `src/core/agent-runtime.js`
  负责保存 `toolCallId`，让工具结果能回传给真实模型。

## 这一课最关键的理解

### 1. Provider 协议应该被隔离

`AgentRuntime` 不应该知道 HTTP、Bearer Token、`/v1/responses` 这些细节。

这些都应该封装在 adapter 层。

### 2. Tool calling 不是普通文本对话

当模型触发工具时，系统不仅要记住：

- 工具名
- 输入参数

还要记住：

- `toolCallId`

因为下一轮把工具结果回传给模型时，需要靠这个 id 对齐。

现在第三课也已经支持：

- 一轮 assistant 返回多个 `tool_calls`
- runtime 把这一整组工具调用全部执行完
- 再带着整组 `tool_result` 进入下一轮

### 3. 第三课这里选择只保留真实模型

为了贴近你当前的使用场景，这一课现在已经不再回退到 mock。

这意味着：

- 启动时就必须能拿到模型配置
- 真实 provider 错误会直接暴露出来
- 你能更早进入真正的联调阶段

### 4. 第三课现在默认打印完整 LLM trace

为了帮助学习，这一课会默认打印：

- 发给模型的完整请求体
- 模型返回的完整响应体

但会自动隐藏 Authorization 里的 API key。

现在这些 trace 默认写入本地日志文件，而不是直接刷到 stdout：

```txt
lesson3/.logs/llm-trace-*.log
```

另外还会生成一份 run summary，专门记录：

- 每轮的 `finish_reason`
- 这一轮请求了哪些工具
- 每个工具执行成功还是失败
- warnings 和停止原因

在循环治理这件事上，第三课现在也刻意向 Claude Code 靠拢：

- 主要依赖 `maxIterations` 防止无限循环
- “重复工具批次”只记 warning，不提前强制打断

如果你想关闭：

```bash
LLM_TRACE=false npm start -- "请阅读 ../../rust/README.md 并总结它的架构"
```

看 trace 时，建议优先观察这几个字段：

- `finish_reason`
  这轮为什么停下
- `tool_calls`
  这轮是否请求了工具
- `content`
  这轮是否已经给出最终文本
- `reasoning_content`
  模型对“为什么这么做”的简要思路

## 运行方式

使用真实模型：

```bash
cd agent-study/lesson3
npm start -- "请阅读 src/index.js 并解释入口流程"
```

如果你要读取仓库根目录下的 Rust 文档，从 `lesson3` 出发应使用：

```bash
cd agent-study/lesson3
npm start -- "请阅读 ../../rust/README.md 并总结它的架构"
```

## 代码对应时序图

下面这张图可以直接对应 `lesson3` 里的真实代码。

```txt
用户输入
  -> src/index.js
  -> createAgentApp()
  -> AgentRuntime.run()
  -> model.decide()
  -> OpenAI-compatible API
  -> 返回一组 tool_calls + toolCallId
  -> ToolRegistry.execute()
  -> 本地工具执行
  -> session 记录 tool request / tool result
  -> model.decide() 再次读取 session
  -> 回传 tool_call_id 对应的结果
  -> 模型输出 final answer
```

### 第 1 步：runtime 把上下文和 tools 交给模型

代码位置：

- `src/core/agent-runtime.js`
- `src/core/tool-registry.js`

关键调用：

```js
const decision = await this.model.decide({
  systemPrompt: this.systemPrompt,
  messages: this.session.snapshot(),
  tools: this.toolRegistry.listTools(),
  iteration,
});
```

这里有三类输入：

- `messages`
  当前会话历史
- `tools`
  当前 agent 能调用的工具定义
- `systemPrompt`
  对模型行为的约束

### 第 2 步：adapter 把本地工具定义翻译成 provider 协议

代码位置：

- `src/model/openai-responses-model.js`

关键调用：

```js
body: JSON.stringify({
  model: this.model,
  messages: mapMessages(messages, systemPrompt),
  tools: mapTools(tools),
  tool_choice: "auto",
})
```

这里最值得理解的是：

- `toolRegistry.listTools()` 返回的是你本地定义的工具对象
- `mapTools(tools)` 负责把它翻译成 provider 认识的 `tools` JSON

也就是说：

```txt
本地工具对象 -> API tools 协议
```

### 第 3 步：模型返回 tool call

模型如果决定调用工具，通常会返回类似结构：

```json
{
  "tool_calls": [
    {
      "id": "call_abc123",
      "type": "function",
      "function": {
        "name": "read_file",
        "arguments": "{\"path\":\"../../rust/README.md\"}"
      }
    }
  ]
}
```

这里的 `id`，就是这次工具调用的关联 id。

在我们代码里，它现在会被转换成一整组 `toolCalls`：

```js
return {
  type: "tools",
  toolCalls: [...]
};
```

### 第 4 步：runtime 执行本地工具

代码位置：

- `src/core/agent-runtime.js`
- `src/tools/*.js`

关键调用思路：

```js
for (const toolCall of decision.toolCalls) {
  const toolResult = await this.toolRegistry.execute(
    toolCall.toolName,
    toolCall.input,
    context,
  );
}
```

这一步才是真正执行本地工具。现在如果一轮里有多个 `tool_calls`，会全部执行，而不是只拿第一个。

比如：

- `read_file`
- `grep_search`
- `write_file`
- `bash`

### 第 5 步：把 toolCallId 和结果一起写入 session

这是第三课最关键的一步。

代码位置：

- `src/core/agent-runtime.js`

请求记录：

```js
this.session.addAssistantMessage({
  type: "tool_request",
  toolName: decision.toolName,
  input: decision.input,
  toolCallId: decision.toolCallId ?? null,
});
```

结果记录：

```js
this.session.addToolMessage(decision.toolName, {
  ok: true,
  input: decision.input,
  toolCallId: decision.toolCallId ?? null,
  content: toolResult,
});
```

为什么必须存 `toolCallId`？

因为下一轮回传结果时，模型要知道：

- 你现在给我的这个工具结果
- 到底对应我刚才发起的哪一次工具调用

### 第 6 步：adapter 用同一个 id 回传 tool result

代码位置：

- `src/model/openai-responses-model.js`

tool request 会被映射成：

```js
{
  role: "assistant",
  content: "",
  tool_calls: [
    {
      id: message.content.toolCallId,
      type: "function",
      function: {
        name: message.content.toolName,
        arguments: stringifyJson(message.content.input),
      },
    },
  ],
}
```

tool result 会被映射成：

```js
{
  role: "tool",
  tool_call_id: message.content.toolCallId,
  content: stringifyJson(...),
}
```

这里最重要的是：

- `tool_calls[].id`
- `tool.tool_call_id`

它们必须是同一个值。

这就是 `call_id` 的真正职责：

```txt
把某一次工具调用请求
和
它对应的工具执行结果
绑定起来
```

### 第 7 步：模型继续推理，直到输出最终答案

如果模型不再需要工具，它就会直接返回普通文本。

adapter 会把它转换成：

```js
return {
  type: "final",
  output: message?.content?.trim() || ...
};
```

然后 runtime 收尾：

```js
this.session.addAssistantMessage(decision.output);
return {
  output: decision.output,
  session: this.session.snapshot(),
  iterations: iteration,
};
```

## 一句话记忆版

第三课最值得记住的一句话是：

```txt
本地工具定义 -> tools 协议 -> 模型返回 tool call + call_id
-> 本地执行工具 -> 用同一个 call_id 回传结果 -> 模型继续推理
```

## 一个直观比喻

你可以把 `toolCallId` 理解成快递单号：

- 模型发起工具调用时，生成一张单子
- 你本地执行工具，相当于处理这单快递
- 回传结果时，必须带回同一个单号
- 模型才知道“这份结果对应的是哪一次调用”

## 下一课建议

第 4 课最自然的方向是：

1. 持久化 session
2. 保存和恢复历史对话
3. 为后续 summary compaction 做准备
