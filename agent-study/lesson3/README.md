# Lesson 3: Real LLM Adapter

这一课把 `lesson2` 的工具化 agent 升级为“真实 LLM + 工具层”的版本。

相比第 2 课，这一课新增了：

- `OpenAIResponsesModel`
- `createModel()` 模型工厂
- `.env.local` 驱动的真实模型调用
- `toolCallId` 在 session 中的保存与回传
- 去掉 `MockModel` 回退
- 默认开启 LLM 请求/响应 trace，并写入本地日志文件
- 支持单轮返回多个 `tool_calls`，并逐个执行

## 推荐练习

```bash
cd agent-study/lesson3
npm start -- "请阅读 src/index.js 并解释入口流程"
```

```bash
cd agent-study/lesson3
npm start -- "查找 src 里和 tool 相关的内容，并总结一下"
```

```bash
cd agent-study/lesson3
npm start -- "运行 `pwd`"
```

## 运行

```bash
cd agent-study/lesson3
npm start -- "请阅读 ../../rust/README.md 并总结它的架构"
```

如果你觉得输出太多，也可以关闭 trace：

```bash
cd agent-study/lesson3
LLM_TRACE=false npm start -- "请阅读 ../../rust/README.md 并总结它的架构"
```

开启 trace 时，stdout 只会提示日志文件位置，详细请求/响应会写入：

```txt
agent-study/lesson3/.logs/llm-trace-*.log
```

同时还会生成一份更适合快速浏览的运行摘要：

```txt
agent-study/lesson3/.logs/run-summary-*.log
```

阅读 trace 时，最值得先看这几个字段：

- `finish_reason`
- `tool_calls`
- `content`
- `reasoning_content`

## 学习重点

这一课真正想让你建立的感觉是：

- runtime 不应该直接知道 OpenAI、Anthropic 之类厂商细节
- 模型层最好抽象成 adapter，便于替换 provider
- 真正的 function calling 需要保存 `call_id`
- 工具层和模型层分离之后，架构会稳定很多
- 在循环终止策略上，优先参考 Claude Code / Claw Code：主要依赖 `maxIterations` 收口，重复批次只做告警
