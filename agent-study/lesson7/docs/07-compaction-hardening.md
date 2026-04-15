# 第 7 课：Compaction Hardening

这一课专门处理一个在真实 agent 里很容易冒出来的问题：

- session 已经有基础 compaction 了
- 但真正跑长任务时，还是会遇到 context window、fallback、日志定位、阈值策略这些更细的问题

## 为什么 lesson5 之后还需要 lesson7

`lesson5` 已经做了 compaction，但那一课更像“先把机制搭起来”：

- 有阈值
- 会压缩旧消息
- 会保留最近消息
- 会把摘要写回 session

这已经足够理解 compaction 的架构位置。

但一旦开始跑真实模型、真实工具、真实 streaming，对话就会变得没那么理想化。

很快就会出现这些问题：

- 明明有 auto compact，为什么还是会报 context window exceeded
- 为什么 compact 触发得太频繁，最后回答质量反而下降
- 为什么有些 provider 会返回 `output_tokens`，但没有 `input_tokens`
- 为什么 compact 后 token 反而没有明显下降

这些都已经不属于“compaction 的基础概念”，而属于：

- 策略怎么定
- 日志怎么读
- 边界怎么处理
- 与真实 provider 怎么对接

这就是 lesson7 的职责。

## 这一课要解决什么

### 1. auto compact 何时触发

教学版 `lesson5` 的做法是：

- 用粗估 token 触发
- 保留最近若干消息
- 把更早历史压成 summary

这足够帮助理解架构，但离 Claude Code 还有距离。

更接近真实产品的问题是：

- provider 返回的 `input_tokens` 能不能直接用
- 如果 provider 不返回 `input_tokens` 怎么办
- 粗估阈值应该是主触发器还是 fallback

### 2. context window 报错后的恢复

即使有 auto compact，也可能遇到：

- 请求前估算没拦住
- provider 直接返回 context window exceeded

这一课会继续处理：

- 是否在报错后 forced compact 再重试
- forced compact 的边界和风险

### 3. 调试链路怎么对齐

当 compaction 参与进来后，我们要能从日志里看清：

- 本轮为什么 compact
- 是 usage 触发还是 fallback 估算触发
- compact 后上下文大概缩了多少
- 最终回答质量有没有被过度 compact 影响

### 4. lesson5 / lesson6 / lesson7 的边界怎么分

如果课程边界不清楚，后面很容易写着写着又混回去。

这里先固定下来：

- `lesson5`
  讲“基础 compaction 机制”
- `lesson6`
  讲“streaming runtime”
- `lesson7`
  讲“在真实 provider 和长任务下，把 compaction 变得更稳”

## 目标方向

这一课不会追求“永不超窗”，而是更贴近 Claude Code 的思路：

- 优先依赖真实 usage
- provider 没给 usage 时再 fallback
- compact 作为连续性机制，而不是每轮都触发的噪音

## 对照 Claude Code 我们要学什么

从当前仓库里的 Claude Code 实现看，最值得借鉴的是这几点：

### 1. auto compact 的主触发器更接近真实 usage

Claude Code 不把“粗估 token”当成唯一真相。

它更依赖：

- provider 返回的 `usage`
- runtime 内部的 `UsageTracker`
- `cumulative input tokens`

也就是说，它更像是在问：

> “真实跑下来，我们已经消耗了多少输入上下文？”

而不是只问：

> “按字符长度粗估，这一坨消息看起来大概有多长？”

### 2. 粗估不是消失了，而是换了位置

在 Claude Code 里，粗估依然存在，但更多用于：

- preflight context window 检查
- compaction 内部的目标预算

而不是所有地方都靠它做决策。

### 3. provider 没给 usage 时，也不会硬装作拿到了真实值

这一点很重要。

如果 provider 不返回 `input_tokens`，更稳的做法不是“凭感觉补一个差不多的真实值”，而是：

- 明确知道这里没有真实 usage
- 回退到 fallback 逻辑
- 在日志里说清楚当前走的是 fallback

lesson7 也应该沿着这个方向做，而不是把“估算值”伪装成“真实值”。

## 这节课最容易踩的坑

### 1. compact 触发太频繁

如果阈值太低，或者 trigger 太激进，就会出现：

- 每轮都 compact
- summary 越来越长
- 模型越来越依赖摘要而不是最近上下文
- 最终回答开始泛化、跑偏

也就是说，“有 compact”不代表“更稳”，有时候反而会让任务连续性变差。

### 2. compact 之后 token 不一定真的明显变小

这在教学版里尤其常见，因为：

- summary 自己也要占上下文
- 最近消息还要保留
- repeated compaction 会让摘要继续膨胀

所以 lesson7 不能只看“有没有 compact”，还要看：

- `beforeEstimatedTokens`
- `afterEstimatedTokens`
- `removedMessageCount`
- compact 后回答质量有没有提升

### 3. 请求前估算和请求后 usage 不是同一回事

这两个很容易混淆。

- 请求前估算
  主要是为了防止直接撞上 context window
- 请求后 usage
  主要是为了统计真实消耗，并驱动更合理的长期策略

lesson7 的一个重点，就是把这两条线分清楚。

### 4. 启发式 summary 会丢信息

当前教学版 `compactSession()` 不是单独再调一次 LLM 来总结历史消息，而是：

- 本地启发式提取 recent user requests
- 提取 tools mentioned
- 提取 current work
- 拼一段 key timeline

这有助于先把 compaction 机制讲清楚，但也有明显代价：

- 长工具结果会丢失全文
- assistant 的原始措辞会丢失
- 某些关键但不在 recent window 里的细节可能被 summary 漏掉

所以 lesson7 后续如果要进一步提高质量，就需要认真面对：

- 是否引入 LLM-based summary
- 如何控制 summary 本身的成本
- 如何避免 repeated compaction 让摘要越来越失真

## 当前已经验证到的结论

这节课到目前为止，我们已经通过真实 run 确认了下面这些点。

### 1. provider usage、request budget、fallback estimate 必须分开看

现在 lesson7 日志里已经把三条语义拆开：

- `providerUsageMode`
- `requestBudgetMode`
- `compactionMode`

这样可以明确区分：

- provider 有没有返回真实 input usage
- 请求前是否还有 preflight estimate 在工作
- 当前 compact 到底是被 provider usage 还是 session fallback 触发

### 2. 火山引擎 Anthropic-compatible 路径当前没有返回可用的 `input_tokens`

我们已经验证：

- Anthropic-compatible 路径下会返回 `output_tokens`
- 但当前实验链路里没有可用的 `input_tokens`

因此在 Anthropic-compatible 模式下，lesson7 目前仍然只能：

- 用 provider response 做输出 usage 统计
- 用 fallback/session estimate 决定 compact

这不是 runtime 不支持，而是 provider 响应能力本身的限制。

不过这里要补一个最新结论：

- 在 `run-2026-04-13T00-30-11-433Z-8ec582` 这次 minimax Anthropic-compatible 实验里
- `run-summary` 已明确记录每轮都有 `usage.input_tokens`
- `providerUsageMode` 与 `compactionMode` 也都已经进入 `"provider_usage"`

这说明“Anthropic-compatible 一定拿不到真实 input usage”已经不再是稳定结论。

更准确的说法应该改成：

- Anthropic-compatible 链路下，真实 `input_tokens` 的可用性取决于当前网关 / provider 实际返回
- 如果 provider 给了真实值，lesson7 现有 runtime 已经能直接接住并按 provider usage 驱动 compact
- 如果 provider 没给，再回退到 fallback/session estimate

### 3. 火山引擎 OpenAI-compatible 路径已经可以返回真实 `prompt_tokens`

切到 OpenAI-compatible 之后，我们已经拿到真实 usage：

- `prompt_tokens`
- `completion_tokens`

同时 runtime 也已经把它接进来了：

- `providerUsageMode: "provider_usage"`
- `compactionMode: "provider_usage"`

这说明 lesson7 现在已经能在 OpenAI-compatible 路径下，真正按真实 input token 驱动 compact。

### 3.1 当前 minimax Anthropic-compatible 实验也已经出现真实 `input_tokens`

最新一次真实 run：

- `Run ID: run-2026-04-13T00-30-11-433Z-8ec582`
- `Model mode: anthropic`
- `LLM stream: on`

在这次 run 里可以看到：

- Iteration 1: `input_tokens = 445`
- Iteration 2: `input_tokens = 663`
- Iteration 3: `input_tokens = 1072`
- Iteration 4: `input_tokens = 9069`
- 累计 `inputTokens = 11249`

同时日志语义也已经对齐：

- `providerUsageMode: "provider_usage"`
- `requestBudgetMode: "request_preflight_estimate"`
- `compactionMode: "provider_usage"`

这次 run 没有触发 compaction，原因也很清楚：

- 当前 auto compact input threshold 是 `100000`
- 累计 input usage 只有 `11249`

所以这次实验的价值不是“验证 compact 触发”，而是确认：

- Anthropic-compatible 路径下，当前至少已有一条真实可复现的 provider usage 主路径
- lesson7 的 usage 记录、日志拆分和 provider-usage 判定已经能在这条链路上正常工作

### 4. 只靠累计 input tokens 仍然会带来 repeated compaction

即使主信号切到了真实 usage，新的问题还是出现了：

- `cumulative input tokens` 一旦过阈值，就不会下降
- 如果阈值设得太低，后续轮次可能不断继续 compact

这说明“使用真实 usage”本身并不自动等于“compact 策略已经足够稳”。

lesson7 当前已经补了一层最小节流：

- 记录 `lastCompactionInputTokens`
- 记录 `inputTokensSinceLastCompaction`
- 只有当“距离上次 compact 又新增了足够多 input tokens”时，才允许下一次 compact

这一步的目标不是彻底解决所有 repeated compaction，而是先避免：

- 一旦过阈值就每轮都 compact

也就是说，当前 lesson7 已经从：

- `cumulative >= threshold => compact`

推进到：

- `cumulative >= threshold`
- 且 `cumulative - lastCompactionInputTokens >= minInputTokensDelta`
- 才 compact

### 5. provider-usage compact 现在会真正执行，不再只是“逻辑上触发”

在更早的实验里，我们出现过这种情况：

- `AUTO COMPACTION` 日志出现了
- 但 `removedMessageCount = 0`

这说明当时 runtime 虽然认为“应该 compact”，但真正进入 `compactSession()` 后又被旧的 `shouldCompact()` 逻辑提前挡回去了。

当前 lesson7 已经修正了这个问题：

- provider-usage 模式触发 compact 时，会强制执行 compact
- 如果确实存在可压缩的旧消息，`removedMessageCount` 应该大于 0

这一步非常重要，因为它让：

- “provider usage 驱动 compact”

从“日志语义成立”变成了“运行行为真的成立”。

## 当前还没有完全解决的 4 个问题

结合今天的实现和实验，lesson7 当前仍然有四个非常明确的未完成点。

### 1. LLM-based summary 还只是第一版

当前 lesson7 已经接入第一版 `LLM-based summary`：

- compact 时优先尝试让模型生成 `<summary>...</summary>`
- 如果模型总结失败、异常或超窗，会自动退回 heuristic summary
- `run-summary` 会记录：
  - `summaryMode: "llm"`
  - 或 `summaryMode: "heuristic_fallback"`
  - 以及 `summaryError`

这意味着：

- LLM-based summary 已经不再是空白项
- 但它还只是第一版工程化接入，不代表策略已经成熟

后续仍然需要继续验证：

- LLM summary 的额外成本是否值得
- repeated compaction 下摘要是否会漂移
- fallback 是否始终可靠
- OpenAI / Anthropic 两条路径下表现是否一致

### 2. Anthropic-compatible 下真实 `input_tokens` 还没有打通

现在 lesson7 已经确认：

- OpenAI-compatible 路径可行
- Anthropic-compatible 路径当前不行

所以这一课的文档和实现都要明确说明：

- “usage-driven compaction 已打通” 这句话当前只对 OpenAI-compatible 成立
- Anthropic-compatible 仍然需要 fallback 或 provider 能力改进

### 3. compaction 触发规则还比较粗

当前策略已经从“单纯粗估”进步到：

- provider usage 优先
- fallback 兜底

但还缺少更平滑的节流层，例如：

- compact cooldown
- watermark / min delta
- 更合理的 repeated compaction 限制

这里需要注意的是：

- lesson7 目前已经加入了一个最小 watermark / min delta 版本
- 但它仍然只是第一步，不代表触发规则已经足够成熟

后续仍然需要继续观察：

- 默认阈值是否合理
- min delta 应该和 threshold 相等，还是更保守
- 是否还需要额外的 turn-based cooldown

另外还有一个很现实的问题：

- 当前 compact 的收益不一定会直接体现在 `beforeEstimatedTokens -> afterEstimatedTokens` 上

因为：

- summary 本身也要占上下文
- 最近消息仍然会被保留

所以 lesson7 后续不能只看“compact 有没有触发”，还要继续看：

- compact 后是否真的减少了重要历史的重复重放
- compact 后 agent 是否保持了任务连续性
- compact 后是否减少了后续重复搜索/重复读取

### 4. model limits 还没有真正进入 compaction 决策主逻辑

现在我们已经有：

- `contextWindowTokens`
- `maxOutputTokens`
- `requestBudget`

但 compaction 主触发逻辑还没有真正把这些因素统一纳入策略。

更成熟的判断应该同时考虑：

- 当前模型的 context window
- 当前模型的输出预算
- 当前请求估算输入大小
- provider usage 是否可用
- 当前 session 是否已经进入长会话区间

这部分会直接影响：

- 什么时候该 compact
- compact 该有多激进
- forced compact 是否应该触发

## Deferred Backlog

还有一个已经确认存在、但暂时放到后续课程处理的问题：

- 搜索类工具和超大 tool result 的输出预算控制

我们已经遇到过一次真实案例：

- `grep_text("lesson7")` 命中过多运行产物与日志内容
- 巨大 tool result 被完整写回 session
- 下一轮请求在 preflight 阶段直接报：
  - `Estimated request exceeds model context window (...)`

这个问题当前不准备在 lesson7 里用目录级 hard code 快速修补，例如：

- 特判 `.logs`
- 特判 `.sessions`
- 只对某个 lesson 目录做排除

原因是我们希望尽量参考 Claude Code 的方向，把它作为一个更通用的系统能力处理。更合理的后续方案应该是：

- 给搜索工具增加通用的结果上限与 `truncated` 语义
- 给 tool result 写回 session 增加统一裁剪/压缩层
- 让“超大工具输出不会直接撑爆下一轮上下文”成为系统级能力，而不是特判某几个目录

因此，这个问题先明确记为后续 lesson backlog，不在当前 lesson7 里继续展开。

## 当前与 Claude Code 的差距评估

结合目前 lesson7 的实现状态，可以把与 Claude Code 的差距分成三档来看。

### 已对齐

- 已有真实 usage 驱动的 auto compact 主路径
- 已明确区分：
  - `provider usage`
  - `request budget`
  - `fallback estimate`
- 已有 compact summary + recent messages preserved 的基本结构
- 已有 resume / continued session 场景
- 已有 context window exceeded 后的 forced compaction 兜底
- OpenAI-compatible 路径已支持 SSE streaming，并能拿到真实 `input_tokens`

### 半对齐

- usage 已持久化，但当前是把累计 usage 聚合后存进 session；Claude Code 更接近 message-level usage 持久化，再从 session 重建 tracker
- 已有第一版 `LLM-based summary + heuristic fallback`，但还缺少足够多真实长会话验证
- repeated compaction 已加入最小 `watermark / min-delta` 节流，但还不能算产品级稳定
- request budget 已进入 compact 策略，但还没完全统一成一套成熟的 compact policy
- minimax 等 provider 的 model limits 已接入，但 provider-specific token counting 还没有实现

### 未对齐

- 还没有 provider-specific `count_tokens` 预检能力
- 还没有系统级的 tool-result budget control
- 还没有统一的超大 tool result 裁剪 / truncation 基础设施
- 还没有把 message usage、session usage、preflight budget 三者做成更自然的一体化模型
- compact summary 的质量、重复压缩漂移、成本控制，仍未达到产品级打磨程度

### 一句话判断

lesson7 现在已经很像 Claude Code 的 compaction 主骨架，但距离产品级完成度，仍然差在：

- token counting
- tool output budgeting
- usage persistence 粒度
- summary 长会话稳定性

## 预期新增关注点

- `src/core/agent-runtime.js`
- `src/core/session-compaction.js`
- `src/model/anthropic-messages-model.js`
- `src/model/openai-responses-model.js`

## 建议拆成的三个阶段

### 阶段 1：看清楚现在为什么会 compact

先不要急着改逻辑，先回答三个问题：

- compact 是被什么触发的
- compact 后有没有真的把上下文压下来
- 回答质量有没有因为 compact 变差

这一阶段主要靠：

- `run-summary`
- `llm-trace`
- `cli-run`

三份日志对照。

建议这一步先不要着急写代码，先拿一两个真实 run 去回答：

- compact 是哪一轮触发的
- 触发前 session 大概有多大
- compact 后是否马上又继续 compact
- 最终回答有没有明显跑偏

如果这些问题没看清，后面的策略很容易改着改着失焦。

### 阶段 2：把真实 usage 接进来

如果 provider 会返回：

- `input_tokens`
- `output_tokens`

那下一步就是：

- 每轮记录 usage
- 在 runtime 累积 usage
- 用真实 input token 作为 auto compact 主信号

如果 provider 不返回 `input_tokens`，就要明确进入 fallback 模式，而不是假装拿到了真实 usage。

这一阶段最关键的不是“字段接通了”，而是语义要清楚：

- 什么叫真实 usage 可用
- 什么叫 usage 缺失
- runtime 在这两种情况下分别怎么判断
- 日志里能不能一眼看出当前走的是哪条路径

这一阶段目前已经完成了一半：

- OpenAI-compatible 路径已经能拿到真实 `prompt_tokens`
- Anthropic-compatible 路径仍然拿不到真实 `input_tokens`

所以 lesson7 现在已经进入下一步：在“真实 usage 已可用”的前提下，把 compact trigger 做得更稳。

当前已经完成的增强包括：

- provider usage 可用时，auto compact 优先只认真实 input usage
- provider usage 缺失时，才回退到 session fallback estimate
- provider usage 模式下增加了最小 watermark / min delta 节流

### 阶段 3：处理极端超窗

即使有 auto compact，也可能发生：

- preflight 没拦住
- provider 直接返回 context window exceeded

这一阶段要继续决定：

- 是否 forced compact 再重试
- 最多重试几次
- 什么时候应该放弃并给用户明确报错

这里要特别小心一个边界：

- forced compact 是兜底机制
- 不是新的常态路径

如果系统总是依赖 forced compact 才能跑下去，那更大的问题通常不是“没加 forced compact”，而是：

- 前面的 trigger 不对
- preserve recent messages 太激进
- tool result 太长
- output budget 太大

## 这节课的完成标志

如果 lesson7 完成得比较顺，最终应该能看到：

- compact 不再每轮乱触发
- 日志里能清楚区分 usage-trigger 和 fallback-trigger
- context window 超限时有更合理的恢复路径
- 课程边界上，lesson5 / lesson6 / lesson7 的分工变得很清晰

## 推荐实验顺序

### 实验 1：先看基础 compact 行为

```bash
cd agent-study/lesson7
SESSION_AUTO_COMPACT_MAX_TOKENS=1200 npm start -- --resume latest "继续刚才的任务，并观察 compact"
```

这个实验主要看：

- compact 会不会频繁触发
- `run-summary` 里 `before/afterEstimatedTokens` 是怎么变化的

### 实验 2：看真实 provider usage 能拿到多少

```bash
cd agent-study/lesson7
LLM_TRACE=true npm start -- --resume latest "继续刚才的任务，并说明这次 usage 是如何记录的"
```

重点看：

- provider 原始返回里有没有 `input_tokens`
- 是只有 `output_tokens`，还是两者都有

### 实验 3：再看极端上下文

```bash
cd agent-study/lesson7
npm start -- --resume latest "继续刚才的任务，并尽量多读一些内容后再总结"
```

这个实验更适合验证：

- 长任务下 compact 是否真的稳定
- 最终回答质量是否还能保持

## 最后怎么判断 lesson7 写得好不好

一个简单标准是：

读完这节课后，你不只是知道“compact 是什么”，而是已经能回答这些问题：

- 为什么它会在这一轮触发
- 为什么这次触发是合理或不合理的
- 为什么有些 provider 下不能只靠真实 input token
- 为什么 forced compact 只是兜底，不是主策略
- 为什么课程上要把它单独拆成 lesson7

## 一句话定位

如果说 `lesson6` 解决的是“模型怎么流起来”，那 `lesson7` 解决的就是“流起来之后，长任务怎么稳住”。
