# Lesson 8: Context Budget Controls

这一课承接 `lesson7`，重点不再是“compact 什么时候触发”，而是继续把上下文预算控制做成更像 Claude Code 的系统能力。

重点会放在：

- 搜索 / 工具结果的输出预算控制
- tool result 写回 session 前的统一 truncation / compression
- request budget、summary budget、tool budget 的职责边界
- 为 pinned / persisted context 预留更自然的演进空间，但不在这一课里把完整 pin 能力做完

## 为什么 lesson7 之后还需要 lesson8

`lesson7` 已经把 compaction 主骨架补起来了：

- usage-driven auto compaction
- forced compaction on context-limit
- `LLM-based summary + heuristic fallback`
- `providerUsageMode / requestBudgetMode / compactionMode`

但这还没有真正解决一个更靠近产品现实的问题：

- 为什么一次超大的搜索结果，明明工具调用成功了，下一轮却直接撞上 context window
- 为什么 compact 已经存在，但长工具输出还是会把 session 撑得很难继续
- 为什么“预算控制”现在仍然主要发生在请求前，而不是贯穿 tool output、summary、prompt 注入全过程

这就是 lesson8 要承接的部分。

## 当前起点

- `lesson8` 目录从 `lesson7` 复制而来，作为下一课起点
- `lesson7` 负责把 compaction hardening 主路径跑通
- `lesson8` 负责继续解决：
  - 超大 tool result
  - 搜索结果截断
  - session 写回预算
  - 更统一的 context budget policy

## 这节课准备先对齐什么

当前最值得优先对齐 Claude Code 的，是这三块：

1. 工具输出不能无限写回 session
2. 截断语义要进入工具层和 session 层，而不是只在 summary 时补救
3. budget control 不能只靠 compaction，需要变成 runtime 的一等能力

## lesson8 的建议主线

1. 先把 lesson7 里记录过的“超大 tool result 撑爆上下文”案例重新复盘
2. 给搜索工具和高输出工具增加统一的结果上限与 `truncated` 语义
3. 在 tool result 写回 session 前增加统一预算控制层
4. 让 `run-summary` 能清楚记录：
   - 结果是否被截断
   - 截断前后大概大小
   - 当前走的是 tool budget 还是 compaction budget
5. 再评估后续是否继续进入 pinned context / persisted context

当前已经落地到代码里的第一批工具包括：

- `grep_text`
  返回 `totalMatchCount / returnedMatchCount / omittedMatchCount / truncated`
  并默认跳过 `.git / .logs / .sessions / node_modules` 这类运行时噪音目录
- `list_files`
  返回 `totalEntryCount / returnedEntryCount / omittedEntryCount / truncated`
- `read_file`
  返回 `totalCharCount / totalLineCount / omitted* / truncated`
  超大文件会直接返回 `reason: "file_too_large"`
- `bash`
  返回 `stdoutMeta / stderrMeta`，保留 `charCount / lineCount / omittedLineCount / truncated`

这些工具现在还会尽量返回统一的 `continuation` metadata，告诉模型：

- 为什么结果被截断或被 guard
- 下一步更适合缩小路径、缩小 pattern，还是改用更针对性的查询

这里的边界先固定一下：

- lesson8 不把完整 `pin message` 一起做掉
- lesson8 只预留数据结构和 retention policy 的扩展空间
- 如果这条线要正式做，最好单独进入下一课

## 推荐实验

```bash
cd agent-study/lesson8
npm start -- "搜索 lesson7 里关于 Claude Code 差距的记录，并总结 lesson8 应先补哪一块"
```

```bash
cd agent-study/lesson8
npm start -- "搜索 lesson7，然后观察 grep_text 的输出是否过大"
```

```bash
cd agent-study/lesson8
LLM_TRACE=true npm start -- "搜索 lesson7，然后解释这次 run 里上下文预算主要消耗在什么地方"
```

```bash
cd agent-study/lesson8
npm run smoke
```

## 预期结果怎么判断

- 如果 tool budget 生效，超大工具输出不应该再原样冲进下一轮上下文
- 如果 truncation 语义清楚，日志里应该能看出：
  - 哪个工具结果被截断
  - 截断前后大概规模
  - session 写回时保留了什么
- 如果 budget policy 设计合理，compaction 应该从“唯一防线”变成“最后一道连续性机制”
- 在默认搜索过滤下，像 `grep_text("lesson7")` 这类案例不应再被 `.logs / .sessions` 放大到几百条命中
- `npm run smoke` 应该能一次性验证 `read_file / grep_text / list_files / bash / tool_result_budget`

## 建议阅读顺序

- 先看 [docs/07-compaction-hardening.md](/Users/ke.xue/work/claude-code-source-code/agent-study/lesson8/docs/07-compaction-hardening.md)
- 再看 [docs/08-context-budget-controls.md](/Users/ke.xue/work/claude-code-source-code/agent-study/lesson8/docs/08-context-budget-controls.md)
