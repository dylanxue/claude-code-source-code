# Lesson 4: Session Persistence And Multi-Protocol Adapters

这一课在 `lesson3` 的基础上，开始复刻 Claude Code / Claw Code 很核心的两层：

- session 持久化与 resume
- 多 LLM 协议 adapter（OpenAI-compatible / Anthropic）

相比第 3 课，这一课新增了：

- `Session` 拥有 `sessionId / createdAt / updatedAt`
- session 可保存到 `.sessions/*.json`
- 支持 `--resume latest`
- 支持 `--resume <session-file>`
- stdout 会显示当前 session id 和 session 文件路径
- `message-protocol` 内部消息协议层
- OpenAI-compatible adapter
- Anthropic Messages adapter

## 推荐练习

```bash
cd agent-study/lesson4
npm start -- "请阅读 src/index.js 并解释入口流程"
```

```bash
cd agent-study/lesson4
npm start -- --resume latest "基于之前的上下文，继续总结 lesson4 的架构"
```

```bash
cd agent-study/lesson4
npm start -- --resume .sessions/某个-session.json "继续刚才的任务"
```

Anthropic 模式示例：

```bash
cd agent-study/lesson4
MODEL_PROVIDER=anthropic ANTHROPIC_API_KEY=your_key ANTHROPIC_MODEL=claude-sonnet-4-5 npm start -- "请阅读 src/index.js 并解释入口流程"
```

如果你接的是 Claude Code / 火山 Coding Plan 这类 Anthropic-compatible 网关，也可以使用：

- `ANTHROPIC_AUTH_TOKEN`
- `ANTHROPIC_BASE_URL=https://ark.cn-beijing.volces.com/api/coding`

当前 adapter 会自动补齐到兼容的 `.../v1/messages` 路径。

## 运行

```bash
cd agent-study/lesson4
npm start -- "请阅读 ../../rust/README.md 并总结它的架构"
```

## 学习重点

- session 不应该只是内存数组，而应该是可恢复状态
- agent 的“连续对话能力”建立在 session 持久化之上
- Claude Code / Claw Code 的 session 设计，和 runtime loop 同样重要
- provider 协议会变化，内部消息协议层应该尽量稳定
- OpenAI-compatible 和 Anthropic 的 tool use 协议不同，adapter 应该分开实现

## 协议分层

这一课里，我们刻意按 Claude Code / Claw Code 的方向做了两层拆分：

- `src/core/message-protocol.js`
  内部稳定协议层，先把 session message 归一化成 `text / final_answer / tool_request / tool_result`
- `src/model/openai-responses-model.js`
  OpenAI-compatible adapter，负责映射 `tool_calls / role: "tool" / finish_reason`
- `src/model/anthropic-messages-model.js`
  Anthropic adapter，负责映射 `tool_use / tool_result / stop_reason`

这样做的重点不是“今天同时支持两家模型”，而是让 runtime/session 不直接耦合某一家的线协议。

## 当前验证状态

- OpenAI-compatible 路径已经在本地实跑通过
- Anthropic adapter 已完成代码接入和语法校验
- 如果要做 Anthropic 端到端验证，还需要你本地配置 `ANTHROPIC_API_KEY`
