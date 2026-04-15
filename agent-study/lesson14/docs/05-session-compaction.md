# 第 5 课：Session Compaction 与 Summary Continuation

这一课我们继续向 Claude Code / Claw Code 学习，把 session 从“可持久化”升级成“可压缩”。

## 为什么这一课重要

只做 session persistence 还不够。

如果会话越来越长，模型上下文最终一定会被吃满。真实 agent 需要在“保留工作连续性”和“减少上下文体积”之间做平衡，这正是 compaction 的职责。

在 Claude Code 里，这部分对应：

- `rust/crates/runtime/src/compact.rs`
- `rust/crates/runtime/src/session.rs`

## 这一课新增的核心文件

- `src/core/session-compaction.js`
  负责 `estimateSessionTokens / shouldCompact / compactSession`
- `src/core/session.js`
  新增 `compaction` metadata、`clone`、`replaceWith`、`recordCompaction`
- `src/core/agent-runtime.js`
  在每轮模型决策前检查是否需要 auto compact

## 这次实现了什么

### 1. 加了教学版 compaction threshold

这版没有直接复刻 Claude Code 的完整 token 预算逻辑，而是先做了一个更容易理解的版本：

- `SESSION_AUTO_COMPACT_MAX_TOKENS`
- `SESSION_COMPACT_PRESERVE_RECENT_MESSAGES`

其中 token 估算也是教学版近似：

- 按消息文本长度粗略除以 4

这样虽然不精确，但足够帮助我们理解 compaction 的架构位置。

### 2. compact 后不会只留下 summary，还会保留最近消息

这是很重要的一点。

如果 compact 只留下 summary，不保留最近若干原始消息，模型会丢失“刚刚正在做什么”的细粒度上下文。

所以 lesson5 的 compact 逻辑是：

1. 找出旧消息
2. 生成 summary
3. 保留最近几条原始消息
4. 把 summary 作为 synthetic system message 放回 session 最前面

这和 Claude Code 的思路是对齐的。

### 3. summary 不是普通日志，而是 continuation context

compact 后插入的 synthetic message 不是给用户看的，而是给模型下一轮继续工作的。

它包含三部分信息：

- 这是一个延续中的会话
- 早期上下文已经被压缩为 summary
- 继续当前任务，不要重新开场

这也是为什么它更像 runtime continuation instruction，而不只是“摘要记录”。

### 4. repeated compaction 会合并旧 summary

如果 session 已经 compact 过一次，再次 compact 时，lesson5 不会直接覆盖旧 summary，而是会把：

- Previously compacted context
- Newly compacted context

合并在一起。

这也是从 Claude Code 借来的设计味道。

### 5. compaction metadata 会落到 session 文件里

session 现在会记录：

- `count`
- `removedMessageCount`
- `summary`
- `updatedAt`

这样你在 `.sessions/*.json` 里就能直接看到：

- 这个 session 是否 compact 过
- compact 过几次
- 最近一次 compact 的 summary 是什么

### 6. session 现在会在运行过程中持续落盘

lesson5 当前已经不再是“整次 run 结束后才统一保存”。

现在这些关键时机会立即写回 `.sessions/*.json`：

- 用户消息进入 session
- 发生 auto compaction
- assistant 发起 tool request
- tool result 写回 session
- assistant 产出 final answer

这更接近 Claude Code 的方向，因为真实 agent 不能假设一次 run 一定会完整结束。

### 7. Anthropic 模式下，compact summary 会进入 `system`，不在 `messages` 数组里

这一点很容易在看 trace 时误判。

在 OpenAI-compatible 链路里，synthetic system summary 会作为 `role: "system"` message 发出。

但在 Anthropic Messages API 链路里，我们会把 session 里的 system messages 合并进请求体的 `system` 字段，而不是继续放在 `messages` 数组里。

所以如果你只看：

- `body.messages`

你会以为 compact summary 丢了。

实际上应该同时看：

- `body.system`
- trace debug 里的 `mergedSystemMessageCount`
- trace debug 里的 `mergedSystemMessages`

### 8. model adapter 现在开始区分“上下文窗口”和“最大输出”

lesson5 里我们还补了一层更接近 Claude Code 的 token budget 管理：

- `context window`
  模型一次请求能处理的总 token 上限
- `max output tokens`
  这次请求最多允许模型新生成多少 token

这两者不是一个概念。

当前做法是：

- `src/model/model-token-limits.js`
  维护教学版模型默认值
- adapter 在请求前会做一次粗略 preflight
- 支持通过 `LLM_MAX_OUTPUT_TOKENS` 覆盖默认值

这一步的目的不是把 token 管理做得完全精确，而是先学会像 Claude Code 一样，把“最大输出预算”当成正式配置，而不是随手写死一个常数。

## repeated compaction 是怎么发生的

这一点在 lesson5 里很关键，因为一旦 session 很长，compact 不会只发生一次。

### 第一次 compact

假设最初 session 有这些消息：

```text
1. user: A
2. assistant/tool: 处理 A
3. user: B
4. assistant/tool: 处理 B
5. user: C
6. assistant/tool: 处理 C
```

如果此时触发 compact，并且配置要求“保留最近 2 条消息”，那么 compact 后 session 会变成：

```text
1. system: summary(A, B)
2. user: C
3. assistant/tool: 处理 C
```

这里的 `summary(A, B)` 就是第一次 compact 生成的 synthetic continuation message。

### 第二次 compact

之后用户继续提问，又新增了 D、E：

```text
1. system: summary(A, B)
2. user: C
3. assistant/tool: 处理 C
4. user: D
5. assistant/tool: 处理 D
6. user: E
7. assistant/tool: 处理 E
```

再次触发 compact 时，lesson5 会先识别：

- 第 1 条已经不是普通消息
- 它是“旧 summary”

然后把中间这批较旧消息再压一轮，结果变成：

```text
1. system: mergedSummary(
     previous = summary(A, B),
     new = summary(C, D)
   )
2. user: E
3. assistant/tool: 处理 E
```

这就是 repeated compaction。

### 第三次 compact

如果后面又继续增长，session 可能进一步变成：

```text
1. system: mergedSummary(summary(A, B), summary(C, D))
2. user: E
3. assistant/tool: 处理 E
4. user: F
5. assistant/tool: 处理 F
6. user: G
7. assistant/tool: 处理 G
```

第三次 compact 后就会变成：

```text
1. system: mergedSummary(
     previous = mergedSummary(summary(A, B), summary(C, D)),
     new = summary(E, F)
   )
2. user: G
3. assistant/tool: 处理 G
```

### 这也是为什么 summary 会越来越膨胀

当前 lesson5 的 repeated compaction 是“文本级合并”：

- 把旧 summary 当作一大段文本
- 再把新 summary 拼进去

所以 compact 次数一多，就会出现：

```text
Previously compacted context:
  Conversation summary:
    Previously compacted context:
      Conversation summary:
        ...
```

这不是 compact 的概念有问题，而是 lesson5 现在的 merge 策略还比较粗。

### 你应该怎么理解它

repeated compaction 的目标其实非常合理：

- 不丢掉以前已经压缩出来的上下文
- 同时继续压缩新增长的旧消息

所以它本质上是在做：

```text
旧摘要 + 新摘要 -> 更大的延续摘要
```

Claude Code 也有 repeated compaction，只是它在 summary merge / compression 上做得更成熟，不会像 lesson5 这样膨胀得这么明显。

## lesson5 后续优化：更接近 Claude Code 的扁平 merge

在最初版本里，lesson5 的 repeated compaction 会把旧 summary 当成整段文本重新嵌套进去，容易变成：

```text
Previously compacted context:
  Conversation summary:
    Previously compacted context:
      Conversation summary:
        ...
```

这和 Claude Code 的方向不够接近。

现在我们已经把 merge 逻辑收敛成更扁平的版本：

1. 先从旧 summary 中提取 highlights
2. 再从新 summary 中提取 highlights
3. 新一轮只保留：
   - `Previously compacted context`
   - `Newly compacted context`
   - `Key timeline`
4. 最后做一轮轻量 compression：
   - 去重
   - 限行
   - 限制单行长度

这样 repeated compaction 仍然保留“旧摘要 + 新摘要 -> 更大的延续摘要”的核心思想，但不会那么快膨胀失控。

## lesson5 和 lesson4 的差别

lesson4 的重点是：

- session 可持久化
- resume 能恢复上下文
- provider adapter 分层

lesson5 的重点是：

- session 过长时如何自动瘦身
- compaction 如何不破坏连续工作
- runtime 如何在 compact 后继续正常驱动 LLM/tool loop

## 我们现在更接近 Claude Code 了吗

是，更接近了一步。

lesson5 至少补上了一个真实 coding agent 非常关键的能力：上下文增长之后，runtime 不再只能“硬扛”，而是开始主动管理 context budget。

但我们和 Claude Code 还有差距：

- 还没有 streaming-aware compaction
- 还没有更精确的 token accounting
- 还没有 JSONL append-only session persistence
- 还没有 provider contract tests 覆盖 compact 后上下文重建

## 推荐实验

先正常跑几轮：

```bash
cd agent-study/lesson5
npm start -- "请阅读 src/index.js 并解释入口流程"
```

然后降低 compact 阈值，强制更容易触发：

```bash
cd agent-study/lesson5
SESSION_AUTO_COMPACT_MAX_TOKENS=120 SESSION_COMPACT_PRESERVE_RECENT_MESSAGES=4 npm start -- --resume latest "继续刚才的任务，并观察 compact"
```

接着你可以去看：

- `.logs/run-summary-*.log`
- `.sessions/session-*.json`

重点观察：

- 有没有 `ITERATION N AUTO COMPACTION`
- session 最前面是否多出一条 synthetic system summary
- `compaction` metadata 是否被写回文件
