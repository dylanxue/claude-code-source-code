# 第 4 课：Session Persistence、Resume 与多协议 Adapter

这一课开始，我们把 agent 从“只会在当前进程里跑一轮”升级成“可以把会话保存到磁盘，并在下次继续”。

## 为什么这一课重要

如果没有 session persistence，agent 的很多高级能力都无从谈起：

- resume
- 长任务分阶段继续
- 失败后恢复
- 后续的 session compaction
- 子 agent 和父 agent 的状态追踪

所以从 Claude Code / Claw Code 的架构角度看，session 和 runtime 是同等重要的两个支柱。

## 这一课新增的核心文件

- `src/core/session.js`
  session 现在有 `sessionId`、时间戳和序列化能力
- `src/core/session-store.js`
  负责会话文件的保存、加载、latest 查找
- `src/index.js`
  负责解析 `--resume`

## 当前实现了什么

### 1. 每次运行都会生成或继续一个 session

- 新 session 会自动生成 `sessionId`
- 保存路径位于 `.sessions/<sessionId>.json`

### 2. 支持 resume

支持两种方式：

```bash
npm start -- --resume latest "继续刚才的任务"
```

```bash
npm start -- --resume .sessions/session-xxx.json "继续刚才的任务"
```

### 3. session 是教学版 JSON 快照

这版不是完整复刻 Claude Code 的 JSONL append-only 方案，而是先做学习更友好的 JSON 快照版本。

这样你更容易直接打开文件读懂结构。

### 4. resume 的关键不只是“读回文件”，还包括“正确重建模型上下文”

这一步非常容易踩坑。

如果 session 文件里保存了：

- user 消息
- assistant 的 tool request
- tool result
- assistant 的 final answer

那在 resume 时，必须把这些消息重新映射回模型能理解的上下文。

尤其是 assistant 的 final answer，不能漏掉。

否则模型会觉得自己只看到了半截历史，进而重复读文件、重复搜索，或者调用一些看起来“奇怪”的工具。

### 5. provider-specific 映射不应该直接散落在 adapter 里

这一课我们还额外学到一个架构点：

- `Session` 里保存的是我们自己的内部消息语义
- OpenAI / Claude / 其他模型都有各自的外部协议

所以更稳的做法不是把一堆 `if role === ...` / `if type === ...` 直接写死在某个 provider adapter 里，
而是先通过内部消息协议层做一次归一化，再让 adapter 负责协议转换。

这更接近 Claude Code 的设计方向：

- 内部统一消息模型
- provider adapter 只做映射

### 6. 同一套内部消息模型，现在可以接两种外部协议

目前 lesson4 已经支持两类 adapter：

- OpenAI-compatible Chat Completions + tools
- Anthropic Messages API + tool_use / tool_result

这正是我们想从 Claude Code / Claw Code 学到的关键点：

- 内部消息模型尽量稳定
- provider 协议差异封装在 adapter 内

OpenAI-compatible 的典型特征：

- `tool_calls`
- `tool_choice`
- `finish_reason`
- `role: "tool"`

Anthropic 的典型特征：

- `tool_use`
- `tool_result`
- `stop_reason`
- `tool_result` 作为下一轮 `user` message 的 content block

如果你接的是火山 Coding Plan 这类 Anthropic-compatible 网关，配置形式通常还会更接近 Claude Code：

- 环境变量常见为 `ANTHROPIC_AUTH_TOKEN`
- base url 常见为 `https://ark.cn-beijing.volces.com/api/coding`
- 实际请求路径需要映射到兼容的 `v1/messages`

### 7. lesson4 里的内部协议长什么样

这一课新增的 `src/core/message-protocol.js`，不是 provider 协议，而是我们自己的内部语义层。

目前归一化后的 message kind 主要有四类：

- `text`
  普通文本消息
- `final_answer`
  agent 已经完成这一轮任务后的最终回答
- `tool_request`
  assistant 发起的一次工具调用
- `tool_result`
  本地工具执行后的结构化结果

这层之所以重要，是因为 runtime 和 session 只需要理解这四类语义；
至于外部到底叫 `tool_calls`、`tool_use`、`tool_result` 还是别的字段，应该由 adapter 负责。

### 8. OpenAI 和 Anthropic 的差异，具体落在哪

虽然 lesson4 里两条链最后都能驱动同一个 runtime，但它们的线协议差异很大。

OpenAI-compatible 这条链：

- 请求里传 `tools`
- 用 `tool_choice: "auto"` 让模型自己决定是否调工具
- assistant 返回 `tool_calls`
- 工具结果通过 `role: "tool"` 和 `tool_call_id` 回传
- 结束状态常见是 `finish_reason: "tool_calls"` 或 `finish_reason: "stop"`

Anthropic 这条链：

- 请求里也会传 `tools`
- assistant 返回的是 content blocks，其中工具调用 block 是 `tool_use`
- 工具结果不是 `role: "tool"`，而是作为下一条 `user` message 里的 `tool_result` block 回传
- 结束状态字段叫 `stop_reason`，常见值是 `tool_use`、`end_turn`

这正是为什么我们不能把 provider-specific 判断直接散落在 runtime 里。

### 9. 这和 Claude Code / Claw Code 的思路为什么更接近了

Claude Code 的核心思路不是“runtime 直接理解某一家模型的原始 JSON”，而是：

1. 先维护内部统一消息模型
2. 再由 provider adapter 负责输入输出映射

lesson4 现在虽然还是教学版，但方向已经和这个思路对齐：

1. `Session` 保存内部消息
2. `message-protocol` 做归一化
3. `openai-responses-model.js` / `anthropic-messages-model.js` 各自做协议转换

参考官方文档：

- OpenAI Function Calling
  https://developers.openai.com/api/docs/guides/function-calling
- Claude Tool Use
  https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works

## 对照 Claw Code

在 Claude Code 里，session 是更强的：

- 有版本号
- 有 workspace root
- 有 fork 信息
- 有 compaction 信息
- 支持更完整的持久化策略

参考：

- `rust/crates/runtime/src/session.rs`

我们这一课先学最核心的两件事：

1. session 不能只存在内存里
2. runtime 和 CLI 都要围绕 session 生命周期设计

## 我们离 Claude Code 还有多远

如果只看“架构方向”，lesson4 已经走在正确轨道上了：

- 有内部消息协议层
- 有 provider-specific adapter
- OpenAI-compatible / Anthropic 两条链都能驱动同一个 runtime

但如果看“产品级协议兼容能力”，我们和 Claude Code 之间仍然有明显差距。

### 已经对齐的部分

- runtime 不再直接理解某一家 provider 的原始 JSON
- session message 会先归一化，再交给 adapter 映射
- OpenAI-compatible 和 Anthropic 的差异已经被明确拆开

### 还明显落后的部分

1. 还没有 streaming runtime

- 目前 lesson4 还是整包请求、整包响应
- Claude Code 已经是 event-driven streaming 设计，内部会处理 `TextDelta`、`ToolUse`、`MessageStop`

2. 内部协议还比较薄

- 现在只有 `text / final_answer / tool_request / tool_result`
- Claude Code 的内部 block/event 模型更细，能表达更丰富的流式和多 block 场景

3. adapter 还偏教学版

- 目前 OpenAI / Anthropic adapter 里仍然有不少手工字段判断
- Claude Code 的 provider 层更接近正式 SDK / compat layer

4. 协议异常覆盖还不够

- 我们目前只做了基础 trace、summary 和少量 warning
- 还没有完整覆盖更多 provider 边角行为和异常变体

5. 测试体系差距很大

- 这一点往往最容易被忽略
- Claude Code 在 provider 兼容上有明显更完整的 mock、streaming、integration tests

### 现阶段可以怎么理解

可以把 lesson4 看成：

- 已经学会了 Claude Code / Claw Code 的“正确分层思路”
- 但还没有追上它的“完整协议工程化能力”

## 下一课建议

第 5 课可以继续往 Claude Code 靠：

1. session compaction
2. 更多 resume 方式
3. 更接近 JSONL append-only 的持久化格式
