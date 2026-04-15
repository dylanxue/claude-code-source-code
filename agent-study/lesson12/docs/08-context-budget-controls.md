# 第 8 课：Context Budget Controls

这一课专门承接 lesson7 留下的一个系统级问题：

- compaction 已经有了
- 但超大工具输出仍然可能在 compact 之前就把下一轮上下文压满

换句话说，lesson7 主要解决的是：

- “上下文快不够了时，怎么压缩旧消息继续跑”

而 lesson8 要继续解决的是：

- “哪些内容根本不该毫无控制地进入上下文”

## 为什么这节课值得单独拆出来

如果继续把所有问题都往 compaction 里塞，会很快遇到两个误区：

### 1. 把 compaction 当成万能补丁

这会导致一种错误心态：

- 先让工具输出随便写回 session
- 等下一轮快超窗了，再靠 compact 去兜底

这样系统虽然“还能跑”，但成本很高，而且回答质量也容易变差。

更像 Claude Code 的思路应该是：

- 在进入 session 之前，就先控制工具结果体积
- 在请求前，再做 request budget 检查
- 最后才让 compaction 作为连续性机制兜底

### 2. 把目录级 hard code 当成长期方案

真实案例已经出现过：

- `grep_search("lesson7")` 命中大量日志和运行产物
- 巨大 tool result 被完整写回 session
- 下一轮 preflight 直接报 context window exceeded

最简单的修法当然是：

- 特判 `.logs`
- 特判 `.sessions`
- 特判某些 lesson 目录

但这不够通用，也不够像 Claude Code。

lesson8 更想解决的是：

- 搜索工具是否应该自带结果上限
- 工具结果是否应该带 `truncated` 元数据
- session 写回层是否应该统一做裁剪

## 这节课最重要的目标

### 1. 让 tool output budgeting 成为系统能力

不只是某一个工具自己随手裁几行，而是更明确地定义：

- 哪些工具可能产生超大输出
- 默认保留多少
- 超出后如何表示“有内容被省略”
- 省略后如何仍然保留足够的 continuation value

### 2. 让截断语义进入日志和 session

如果结果被裁掉了，系统不能装作什么都没发生。

至少应该能在日志里看清：

- 原始结果大概多大
- 最终写回 session 的结果大概多大
- 是否标记为 `truncated`
- 当前是哪种 budget 在起作用

### 3. 把 budget 分层

lesson8 最容易混的概念有三个：

- request budget
  用来判断“这次请求发出去会不会直接超窗”
- tool result budget
  用来判断“某个工具结果值不值得完整写回 session”
- summary budget
  用来控制 compact summary 本身不能无限膨胀

如果这三件事不拆开，后面会很难定位：

- 是搜索结果太大
- 是 summary 太胖
- 还是请求前 estimate 根本就不准

## 更接近 Claude Code 的方向

对照当前仓库里的 Claude Code，lesson8 最应该学习的是这几个方向：

### 1. 截断不只是 UI 行为，而是 runtime 行为

像 bash 输出过大时，Claude Code 不会无上限保留，而是直接在 runtime 层做截断。

这意味着：

- “超大输出处理”不是展示层补丁
- 而是 conversation state 的一部分

### 2. prompt budget 和 tool budget 都要是显式概念

如果 instruction file 都会被预算裁剪，那么 tool result 也不应该被当成无限免费内容。

也就是说，lesson8 要开始形成一个更完整的判断：

- 什么内容必须原样保留
- 什么内容可以压缩后保留
- 什么内容只需要留下摘要与截断标记

### 3. compaction 应该退回到“连续性机制”

lesson8 做得好的标志之一，是 compaction 不再承担太多本来不属于它的脏活：

- 不是每次大输出都要靠 compact 救火
- 不是一堆无价值巨型 tool result 先写回 session，再压缩掉

更理想的状态是：

- 先控制进入 session 的内容
- 再在长期历史过长时做 compact

## 当前建议先做的第一版

这节课如果按最稳的顺序推进，推荐先做：

1. 给 `grep_search` 增加通用结果上限
2. 让工具返回结果支持 `truncated` / `originalSize` 一类元数据
3. 在 runtime 写回 tool message 前，加一层统一裁剪入口
4. 在 `run-summary` 中记录裁剪信息

这一版现在已经不只停留在 `grep_search`：

- `grep_search`
  已支持 `totalMatchCount / returnedMatchCount / omittedMatchCount / truncated`
  并默认跳过 `.git / .logs / .sessions / node_modules` 这类高噪音目录
- `list_files`
  已支持 `totalEntryCount / returnedEntryCount / omittedEntryCount / truncated`
- `read_file`
  已支持 `totalCharCount / totalLineCount / omitted* / truncated`
  并在超大文件场景下返回 `reason: "file_too_large"`
- `bash`
  已支持 `stdoutMeta / stderrMeta`，把输出大小、行数和截断状态结构化返回
  对 `cat / head / tail / sed -n / node -e readFileSync` 这类明显的文件直出命令，也会在大文件场景下返回 guard metadata

并且这几类工具现在会尽量附带统一的 `continuation` metadata，包括：

- `reason`
- `summary`
- `suggestedTool`
- `suggestedActions`

这层信息的目标不是代替模型思考，而是让模型在看到 `truncated / file_too_large / guard` 时，更容易选出下一步的低成本动作。

另外这套思路现在也已经延伸到 runtime 的统一 `tool_result_budget`：

- 即使某个 tool result 在 session 写回前被 runtime 再次裁剪
- `budget` metadata 里也会带上统一的 `continuation`
- 这样就算最终 content 被压成极短字符串，模型仍然能从 `budget.continuation` 里知道下一步该怎么缩小查询范围

在继续往前推之后，runtime 里也开始记录更事实化的 continuation 观测：

- 每轮 `TOOL BATCH` summary 都会带 `continuationTrace`
- 它不再判断模型“是否听话”，而是记录：
  - 上一轮 hint 是什么
  - 下一轮真实调用了哪些 tool
  - 是否发生 same-input retry
  - 是否使用了 suggested tool
  - 是否发生 guardrail block

所以 lesson8 当前真正还在继续打磨的重点，已经变成：

- 裁剪后如何继续保留足够的 continuation value
- 哪些工具还需要专门语义，而不是只靠统一 budget 层最后兜底
- 如何把搜索过滤做得更通用，而不只是停留在默认噪音目录排除

当前已经拿到一条很有代表性的真实 run 验证：

- `run-2026-04-13T03-24-56-689Z-92d520`
- prompt: `搜索 lesson7，并总结命中的内容`
- 默认过滤开启后，`grep_search("lesson7")` 只扫描到 36 个文件、命中 51 处、命中 3 个文件
- 没有再被 `.logs / .sessions` 扩大到几百条结果
- 这次也没有触发统一 `tool_result_budget`，说明噪音过滤已经在更早一层起作用

另外现在还补了一条专门针对 `read_file` 大文件门槛的真实验证：

- `run-2026-04-13T03-30-03-359Z-f1468e`
- 通过 `READ_FILE_MAX_FILE_BYTES=100` 强制触发 `read_file` 的 `file_too_large`
- 模型能够正确读懂 `truncated / reason / fileBytes / maxFileBytes`
- 这条 run 暴露出：如果只限制 `read_file`，模型会自然尝试改用 `bash cat / head / tail / node readFileSync`

随后我们又补了一层 `bash` 侧协同 guard，并拿到了直接验证：

- 对大文件场景下的 `cat / head / tail / sed -n / node -e readFileSync`
- `bash` 现在会返回 `guard.reason = "file_too_large_for_direct_shell_dump"`
- 并附带 `filePath / fileBytes / maxFileBytes / suggestedTool`

以及一条新的真实 run 验证：

- `run-2026-04-13T03-36-02-113Z-ce6856`
- 同样使用 `READ_FILE_MAX_FILE_BYTES=100`
- 模型先后尝试了 `read_file`、`bash cat`、`bash head`
- 最终没有再拿到完整文件内容，而是基于 guard metadata 正确解释了为什么读取失败

在补上统一 `continuation` metadata 之后，又拿到了一条新的验证：

- `run-2026-04-13T03-40-35-750Z-48bb64`
- 同样使用 `READ_FILE_MAX_FILE_BYTES=100`
- 模型在 `read_file` 返回 `file_too_large + continuation` 后，直接基于元数据解释了限制原因
- 这次没有再继续试 `bash cat / head / tail`

同时也拿到了一条“故意诱导绕路”的反向验证：

- `run-2026-04-13T03-51-30-279Z-2a23ca`
- prompt: `先读取 src/tools/grep-text.js，如果读不全就继续尝试用 bash cat 完整读取`
- iteration 2 里模型确实去调用了 `bash cat`
- 这类验证后来已经继续收敛，不再给模型行为贴 `ignored` 这类解释性标签
- 当前更倾向于直接记录真实 tool 行为与 guardrail 事件

这条验证说明：

- `read_file` 的结构化大文件保护已经生效
- `bash` 与 `read_file` 之间已经补上了第一层协同，最常见的文件直出绕路已被拦住
- 统一 `continuation` metadata 已经开始提升 agent 的 continuation quality，而不只是让输出“更小”
- runtime 也已经开始把“模型是否遵循了这些 hint”记录成可观察信号
- 但 lesson8 仍然要继续推进“工具之间的 budget/retention 协同”，而不是把单个工具限制误当成完整防线

这一步先不把完整的 `pin message` 一起做掉。

## lesson8 当前边界与下一课切口

到这里为止，lesson8 已经把一条很关键的链路跑通了：

- tool 会返回 `truncated / guard / continuation`
- runtime 会把这些信号写进 session、trace 和 run summary
- 如果模型明显忽略 hint，runtime 还会加一层轻量 steering

这条线在当前内建工具集合里是有效的，但它也暴露出一个新的边界：

- 现在不少 continuation 判断仍然是 hard-coded 的
- runtime 里已经开始认识具体工具名、具体命令形状、具体绕路方式
- 如果后面继续扩更多工具、更多 MCP server、更多 skill，这套判断会越来越像一张不断变大的例外表

这也是 lesson8 不适合继续无上限往前堆的原因。

### 当前 hard-coded 设计的价值

lesson8 现在这套设计不是错的，反而非常适合教学和原型验证，因为它已经回答了几个关键问题：

- tool result 被截断后，系统是否还能保留 continuation value
- runtime 是否能观察模型有没有沿着 hint 继续工作
- hint 被忽略后，是否能通过 runtime steering 把下一步拉回更窄的路径

如果没有这一步，我们很难真正知道“continuation metadata”到底有没有用。

### 当前 hard-coded 设计的风险

但如果把这套设计直接当长期架构，会逐渐遇到这些问题：

- `agent-runtime` 会变成工具语义总表
- 工具知识会同时散落在 tool implementation、runtime 和 system prompt 里
- 新增工具时，往往不只是加一个 tool，还要补一段新的 continuation assessment
- MCP / plugin / skill 这类动态能力不适合继续走 `if toolName === ...` 风格的扩展

更像 Claude Code 的方向，不是完全没有 hard code，而是把 hard code 更多放在：

- 平台级 lifecycle
- tool metadata / deferred loading
- hooks / policy enforcement
- skills / subagents 这种可复用扩展机制

而不是把“每个工具被截断后下一步该怎么做”都长期写在主 runtime 的分支里。

### lesson9 更合适的主题

因此，lesson8 之后最自然的下一课，不是继续堆更多工具特判，而是：

- `lesson9: Declarative Continuation Policy`

它更适合解决的是：

1. continuation policy 如何从 hard-coded runtime 规则升级成声明式元数据
2. runtime 如何从“认识具体工具”升级成“认识 tool family / action family”
3. 哪些约束应该继续留给 prompt steering，哪些应该下沉到 deterministic policy / hook 风格层
4. skills / MCP / plugins 进入系统后，continuation 和 budget policy 如何继续复用，而不是每加一种能力就补一段特判

### lesson9 的设计目标

lesson9 不必一上来就追求完整 Claude Code parity，更现实的第一版目标是：

- 统一 continuation policy schema
- 给工具声明 `family / follow_up_policy / bypass_policy`
- runtime 只解释少量通用动作词，而不是认识所有工具细节
- 把“明显不该重试的 broad request”从 prompt hint 进一步沉到 policy 层

可以先把动作词收敛成少数几类：

- `narrow_path`
- `narrow_pattern`
- `narrow_region`
- `use_metadata_only`
- `avoid_tool_family`
- `answer_from_available_evidence`

这样做的好处是：

- tool 可以继续扩
- skill 可以继续扩
- MCP server 可以继续扩
- runtime 不需要同步长成一个越来越大的“工具语义解释器”

如果用一句话总结 lesson8 和 lesson9 的分工：

- lesson8 证明 `continuation metadata + runtime observation + lightweight steering` 这条线是有用的
- lesson9 则要把这条线从“能工作”推进到“能扩展”

原因不是它不重要，而是它解决的是另一层问题：

- lesson8 更核心的是“什么内容不该无上限进入 session”
- `pin message` 更像是在解决“哪些关键内容即使进入 compact 流程也必须保留”

如果两条线一起做，课程边界会很容易重新混掉。

这样做的好处是：

- 改动面可控
- 能立刻复现真实收益
- 不需要一上来就重写整个 compaction 架构

## lesson8 对 pin 的处理原则

lesson8 对 `pin message` 的建议是：

- 不在这一课里做完整的 `/pin` / `/unpin` 产品能力
- 但在数据结构和 runtime 接口上，为它预留自然的演进空间

更具体地说，lesson8 可以顺手为后续留出这些位置：

- session / message metadata 的扩展位
- compaction 时“除了 recent messages 之外，还要额外保留一组特殊消息”的接口形状
- runtime 里 tool budget、summary budget、retention policy 的职责边界

这样后面如果单独开一课做 pin，就不用再推翻 lesson8 的设计。

## lesson8 和 lesson7 的边界

- `lesson7`
  重点是 compaction 触发、forced compact、usage-driven policy
- `lesson8`
  重点是 context budget 在 tool/session/runtime 各层的控制

而 `pin message` 更适合作为下一阶段单独展开：

- lesson8
  先解决预算控制与截断
- lesson9
  再正式解决 pinned context / retained context

如果说 lesson7 解决的是：

- “长会话怎么继续”

那 lesson8 更像是在解决：

- “什么内容值得继续带着走”

## 最后怎么判断 lesson8 写得好不好

如果 lesson8 写得比较顺，最终应该能看到：

- 搜索类工具不再轻易把 session 撑爆
- `run-summary` 可以明确说明某次工具结果是否被裁剪
- compaction 触发频率下降，但连续性没有明显变差
- 课程边界上，lesson7 和 lesson8 的职责分工很清楚

如果 lesson8 做完后仍然觉得“关键信息可能在 compact 中丢掉”，那就说明下一课非常适合继续进入：

- pinned context
- retained messages
- 跨 compaction 的显式保留策略
